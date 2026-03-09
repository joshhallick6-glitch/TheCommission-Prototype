// ─── Territory System ────────────────────────────────────────────────────────
// Manages street corner control points and per-neighborhood influence.
// Each street corner is a small capture zone on the map. Presence of a
// player's squads within the radius claims the corner; influence across a
// neighborhood is derived from the fraction of its corners controlled.

import Phaser from 'phaser';
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  STREET_CORNER_RADIUS,
  PLAYER_COLORS,
} from '../data/config';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld } from '../utils/IsometricUtils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StreetCorner {
  id: number;
  tileX: number;
  tileY: number;
  neighborhood: string;
  owner: number; // -1 = uncontrolled, 0 = P1, 1 = P2
  marker: Phaser.GameObjects.Graphics;
  radius: number; // tile radius of control
}

// ─── Influence Multiplier Breakpoints ───────────────────────────────────────
// Maps influence (0-100) to an income multiplier using linear interpolation.

const INFLUENCE_BREAKPOINTS: Array<{ influence: number; multiplier: number }> = [
  { influence: 0, multiplier: 0.7 },
  { influence: 20, multiplier: 0.85 },
  { influence: 40, multiplier: 1.0 },
  { influence: 60, multiplier: 1.15 },
  { influence: 80, multiplier: 1.3 },
  { influence: 100, multiplier: 1.5 },
];

// ─── Constants ──────────────────────────────────────────────────────────────

const INFLUENCE_RECALC_INTERVAL_MS = 2000; // Recalculate neighborhood influence every 2s
const CORNER_MARKER_SIZE = 12; // px -- small diamond
const ZONE_ALPHA = 0.06; // Very faint control zone circle

// ─── System ─────────────────────────────────────────────────────────────────

export class TerritorySystem {
  scene: Phaser.Scene;
  streetCorners: StreetCorner[] = [];
  neighborhoodInfluence: Map<string, Map<number, number>> = new Map();

  private influenceTimer: number = 0;
  private contestedTimers: Map<number, Phaser.Tweens.Tween> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Create StreetCorner objects for each placement and draw their initial
   * visual markers on the map.
   */
  initializeCorners(
    placements: Array<{
      id: number;
      tileX: number;
      tileY: number;
      neighborhood: string;
    }>,
  ): void {
    for (const p of placements) {
      const marker = this.scene.add.graphics();
      marker.setDepth(50);

      const corner: StreetCorner = {
        id: p.id,
        tileX: p.tileX,
        tileY: p.tileY,
        neighborhood: p.neighborhood,
        owner: -1,
        marker,
        radius: STREET_CORNER_RADIUS,
      };

      this.streetCorners.push(corner);

      // Initialize neighborhood influence entry if needed
      if (!this.neighborhoodInfluence.has(p.neighborhood)) {
        this.neighborhoodInfluence.set(p.neighborhood, new Map());
      }
    }

    this.drawCornerMarkers();
  }

  // ── Update Loop ─────────────────────────────────────────────────────────────

  /**
   * Called every frame. Checks each street corner for nearby squads and
   * updates ownership. Recalculates neighborhood influence every 2 seconds.
   *
   * @param delta  Frame delta in ms
   * @param getSquadsNearTile  Callback provided by the game scene that returns
   *   all squad objects within `radius` tiles of a given tile coordinate.
   *   Each returned squad must have at minimum: `{ owner: number }`.
   */
  update(
    delta: number,
    getSquadsNearTile: (x: number, y: number, radius: number) => any[],
  ): void {
    let markersNeedRedraw = false;

    for (const corner of this.streetCorners) {
      const nearbySquads = getSquadsNearTile(
        corner.tileX,
        corner.tileY,
        corner.radius,
      );

      // Count squads per player
      const playerPresence = new Map<number, number>();
      for (const squad of nearbySquads) {
        const p = squad.owner ?? squad.player ?? -1;
        if (p >= 0) {
          playerPresence.set(p, (playerPresence.get(p) ?? 0) + 1);
        }
      }

      const playersPresent = Array.from(playerPresence.keys());

      if (playersPresent.length === 1) {
        // ── Uncontested: single player claims the corner ──────────────
        const claimant = playersPresent[0];
        if (corner.owner !== claimant) {
          const previousOwner = corner.owner;
          corner.owner = claimant;
          markersNeedRedraw = true;

          // Stop any contested pulsing
          this.stopContestedPulse(corner.id);

          // Emit events
          EventBus.emit(
            GameEvents.CORNER_CAPTURED,
            corner.id,
            claimant,
            corner.neighborhood,
          );
          if (previousOwner >= 0) {
            EventBus.emit(
              GameEvents.CORNER_LOST,
              corner.id,
              previousOwner,
              corner.neighborhood,
            );
          }
        } else {
          // Owner unchanged -- make sure contested pulse is off
          this.stopContestedPulse(corner.id);
        }
      } else if (playersPresent.length > 1) {
        // ── Contested: multiple players present ───────────────────────
        this.startContestedPulse(corner);
      } else {
        // ── No units: sticky control (owner does not change) ──────────
        this.stopContestedPulse(corner.id);
      }
    }

    if (markersNeedRedraw) {
      this.drawCornerMarkers();
    }

    // ── Periodic influence recalculation ──────────────────────────────
    this.influenceTimer += delta;
    if (this.influenceTimer >= INFLUENCE_RECALC_INTERVAL_MS) {
      this.influenceTimer -= INFLUENCE_RECALC_INTERVAL_MS;
      this.recalculateInfluence();
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** Get the owner of a specific corner (-1 if uncontrolled). */
  getCornerOwner(cornerId: number): number {
    const corner = this.streetCorners.find((c) => c.id === cornerId);
    return corner ? corner.owner : -1;
  }

  /** Get influence score (0-100) for a player in a neighborhood. */
  getNeighborhoodInfluence(neighborhood: string, player: number): number {
    const inf = this.neighborhoodInfluence.get(neighborhood);
    if (!inf) return 0;
    return inf.get(player) ?? 0;
  }

  /**
   * Convert influence (0-100) to an income multiplier by linearly
   * interpolating between the defined breakpoints.
   *
   *   0  -> 0.70x
   *  20  -> 0.85x
   *  40  -> 1.00x
   *  60  -> 1.15x
   *  80  -> 1.30x
   * 100  -> 1.50x
   */
  getInfluenceMultiplier(neighborhood: string, player: number): number {
    const influence = this.getNeighborhoodInfluence(neighborhood, player);
    return TerritorySystem.interpolateMultiplier(influence);
  }

  /** Count corners controlled by a specific player. */
  getPlayerCornerCount(player: number): number {
    let count = 0;
    for (const c of this.streetCorners) {
      if (c.owner === player) count++;
    }
    return count;
  }

  // ── Visual Markers ──────────────────────────────────────────────────────────

  /** Redraw all corner markers to reflect current ownership. */
  drawCornerMarkers(): void {
    for (const corner of this.streetCorners) {
      const gfx = corner.marker;
      gfx.clear();

      const worldPos = tileToWorld(corner.tileX, corner.tileY);
      const worldX = worldPos.x;
      const worldY = worldPos.y;

      // ── Control zone ellipse (isometric, very faint) ──────────────
      const zoneWidth = corner.radius * TILE_WIDTH * 2;
      const zoneHeight = corner.radius * TILE_HEIGHT * 2;
      const zoneColor = this.getOwnerColor(corner.owner);
      gfx.lineStyle(1, zoneColor, 0.15);
      gfx.strokeEllipse(worldX, worldY, zoneWidth, zoneHeight);
      gfx.fillStyle(zoneColor, ZONE_ALPHA);
      gfx.fillEllipse(worldX, worldY, zoneWidth, zoneHeight);

      // ── Diamond marker (rotated square) ───────────────────────────
      const half = CORNER_MARKER_SIZE / 2;
      const fillColor = this.getOwnerColor(corner.owner);
      const fillAlpha = corner.owner === -1 ? 0.5 : 0.85;

      gfx.fillStyle(fillColor, fillAlpha);
      gfx.beginPath();
      gfx.moveTo(worldX, worldY - half); // top
      gfx.lineTo(worldX + half, worldY); // right
      gfx.lineTo(worldX, worldY + half); // bottom
      gfx.lineTo(worldX - half, worldY); // left
      gfx.closePath();
      gfx.fillPath();

      // Outline
      gfx.lineStyle(1, 0xffffff, 0.4);
      gfx.beginPath();
      gfx.moveTo(worldX, worldY - half);
      gfx.lineTo(worldX + half, worldY);
      gfx.lineTo(worldX, worldY + half);
      gfx.lineTo(worldX - half, worldY);
      gfx.closePath();
      gfx.strokePath();
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Recalculate influence for every neighborhood based on corner ownership.
   * Influence = (corners owned by player / total corners in neighborhood) * 100
   */
  private recalculateInfluence(): void {
    // Group corners by neighborhood
    const byNeighborhood = new Map<string, StreetCorner[]>();
    for (const c of this.streetCorners) {
      if (!byNeighborhood.has(c.neighborhood)) {
        byNeighborhood.set(c.neighborhood, []);
      }
      byNeighborhood.get(c.neighborhood)!.push(c);
    }

    for (const [neighborhood, corners] of byNeighborhood) {
      const total = corners.length;
      if (total === 0) continue;

      const playerCounts = new Map<number, number>();
      for (const c of corners) {
        if (c.owner >= 0) {
          playerCounts.set(c.owner, (playerCounts.get(c.owner) ?? 0) + 1);
        }
      }

      const infMap = this.neighborhoodInfluence.get(neighborhood) ?? new Map();

      // Update each known player
      // Reset all to 0 first, then set actual values
      for (const key of infMap.keys()) {
        infMap.set(key, 0);
      }
      for (const [player, count] of playerCounts) {
        const influence = Math.round((count / total) * 100);
        infMap.set(player, influence);
      }

      this.neighborhoodInfluence.set(neighborhood, infMap);
    }

    EventBus.emit(GameEvents.INFLUENCE_UPDATED);
  }

  /** Get the display color for a corner owner. */
  private getOwnerColor(owner: number): number {
    if (owner === 0) return PLAYER_COLORS[0];
    if (owner === 1) return PLAYER_COLORS[1];
    return PLAYER_COLORS.neutral;
  }

  /** Start a pulsing white tween on a contested corner's marker. */
  private startContestedPulse(corner: StreetCorner): void {
    if (this.contestedTimers.has(corner.id)) return; // already pulsing

    const tween = this.scene.tweens.add({
      targets: corner.marker,
      alpha: { from: 1, to: 0.3 },
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.contestedTimers.set(corner.id, tween);
  }

  /** Stop the contested pulse tween if one exists. */
  private stopContestedPulse(cornerId: number): void {
    const tween = this.contestedTimers.get(cornerId);
    if (tween) {
      tween.stop();
      tween.destroy();
      this.contestedTimers.delete(cornerId);

      // Reset alpha
      const corner = this.streetCorners.find((c) => c.id === cornerId);
      if (corner) {
        corner.marker.setAlpha(1);
      }
    }
  }

  // ── Static Utility ──────────────────────────────────────────────────────────

  /**
   * Linearly interpolate the income multiplier from the influence breakpoint
   * table. Clamps input to [0, 100].
   */
  static interpolateMultiplier(influence: number): number {
    const clamped = Math.max(0, Math.min(100, influence));

    // Find surrounding breakpoints
    for (let i = 0; i < INFLUENCE_BREAKPOINTS.length - 1; i++) {
      const lo = INFLUENCE_BREAKPOINTS[i];
      const hi = INFLUENCE_BREAKPOINTS[i + 1];

      if (clamped >= lo.influence && clamped <= hi.influence) {
        const t =
          (clamped - lo.influence) / (hi.influence - lo.influence);
        return lo.multiplier + t * (hi.multiplier - lo.multiplier);
      }
    }

    // Edge case: exactly at the last breakpoint
    return INFLUENCE_BREAKPOINTS[INFLUENCE_BREAKPOINTS.length - 1].multiplier;
  }

  /** Clean up graphics, tweens, and state on scene teardown. */
  destroy(): void {
    // Kill all contested pulse tweens
    for (const tween of this.contestedTimers.values()) {
      tween.destroy();
    }
    this.contestedTimers.clear();

    // Destroy corner marker graphics
    for (const corner of this.streetCorners) {
      if (corner.marker) {
        corner.marker.destroy();
      }
    }
    this.streetCorners = [];
  }
}
