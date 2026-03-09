// ─── Fog of War System ──────────────────────────────────────────────────────
// Three-state fog of war (AoE2-style):
//   0 = Unexplored: solid black, never been seen
//   1 = Explored:   dark overlay, terrain/buildings visible but dimmed, units hidden
//   2 = Visible:    no overlay, everything fully visible (within sight range)
//
// Renders a world-space Graphics overlay that covers unexplored/explored tiles.
// Only processes tiles visible on-screen for performance.

import Phaser from 'phaser';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from '../data/config';
import { Squad } from '../entities/Squad';
import { Building } from '../entities/Building';
import { tileToWorld, worldToTile } from '../utils/IsometricUtils';

// Default sight range for buildings (BuildingStats doesn't include sightRange)
const DEFAULT_BUILDING_SIGHT_RANGE = 6;

export class FogOfWarSystem {
  private scene: Phaser.Scene;

  // Per-player visibility grid (0=unexplored, 1=explored, 2=visible)
  /** Per-player visibility grids. Public so the minimap can read fog state. */
  visibility: Uint8Array[];
  private playerCount: number;

  // Fog overlay (world-space Graphics drawn on top of the game)
  private fogGraphics!: Phaser.GameObjects.Graphics;

  // Static mask that blacks out the void beyond the isometric map diamond
  private borderMask!: Phaser.GameObjects.Graphics;

  // Performance: only recalculate visibility every N ms
  private updateInterval: number = 200; // ms
  private lastUpdate: number = 0;

  // Pre-computed sight stamps: for a given radius, a list of tile offsets
  // that form a filled circle
  private sightStamps: Map<number, { dx: number; dy: number }[]> = new Map();

  constructor(scene: Phaser.Scene, playerCount: number = 2) {
    this.scene = scene;
    this.playerCount = playerCount;

    // Initialize visibility grids (all tiles start unexplored)
    this.visibility = [];
    for (let p = 0; p < playerCount; p++) {
      this.visibility.push(new Uint8Array(MAP_WIDTH * MAP_HEIGHT));
    }

    // Pre-compute sight stamps for radii 1..15 (covers all unit sightRange values)
    for (let r = 1; r <= 15; r++) {
      this.sightStamps.set(r, this.computeSightStamp(r));
    }

    this.createFogOverlay();
  }

  // ─── Initial Reveal ──────────────────────────────────────────────────────────

  /**
   * Reveal a circular area around (centerTileX, centerTileY) for a player.
   * Sets tiles to "visible" (2). Call this at game start to reveal the
   * starting neighborhood so the player can see their compound and
   * nearby buildings immediately.
   */
  revealArea(player: number, centerTileX: number, centerTileY: number, radius: number): void {
    const grid = this.visibility[player];
    const stamp = this.getSightStamp(radius);
    this.applySightStamp(grid, centerTileX, centerTileY, stamp);
  }

  /**
   * Reveal a rectangular area for a player. Sets all tiles within the
   * rectangle to "visible" (2).
   */
  revealRect(player: number, x: number, y: number, w: number, h: number): void {
    const grid = this.visibility[player];
    for (let ty = y; ty < y + h && ty < MAP_HEIGHT; ty++) {
      for (let tx = x; tx < x + w && tx < MAP_WIDTH; tx++) {
        if (tx < 0 || ty < 0) continue;
        grid[ty * MAP_WIDTH + tx] = 2;
      }
    }
  }

  /**
   * Run an immediate visibility update for a player. Call after revealArea/revealRect
   * to ensure entity visibility is correct on the very first frame.
   */
  immediateUpdate(
    player: number,
    squads: Squad[],
    buildings: Building[],
  ): void {
    this.updateVisibility(player, squads, buildings);
    this.updateEntityVisibility(player, squads, buildings);
  }

  // ─── Sight Stamp Computation ────────────────────────────────────────────────

  /**
   * Pre-compute a filled circle of tile offsets for a given radius.
   * Uses the simple dx*dx + dy*dy <= r*r test.
   */
  private computeSightStamp(radius: number): { dx: number; dy: number }[] {
    const offsets: { dx: number; dy: number }[] = [];
    const r2 = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          offsets.push({ dx, dy });
        }
      }
    }

    return offsets;
  }

  /**
   * Get (or compute on-demand) the sight stamp for a given radius.
   */
  private getSightStamp(radius: number): { dx: number; dy: number }[] {
    let stamp = this.sightStamps.get(radius);
    if (!stamp) {
      stamp = this.computeSightStamp(radius);
      this.sightStamps.set(radius, stamp);
    }
    return stamp;
  }

  // ─── Fog Overlay Creation ──────────────────────────────────────────────────

  /**
   * Create the Graphics object used to render the fog overlay.
   * It lives in world space, at a high depth (above units, below UI).
   */
  private createFogOverlay(): void {
    this.fogGraphics = this.scene.add.graphics();
    this.fogGraphics.setDepth(45); // Above units (~10) but below UI elements (100)

    this.createBorderMask();
  }

  /**
   * Create a static Graphics overlay that fills the void outside the isometric
   * map diamond with solid black. Rendered once at depth 46 (above fog).
   *
   * The isometric diamond has four corner points in world space:
   *   Top:    tileToWorld(0, 0)
   *   Right:  tileToWorld(MAP_WIDTH-1, 0)
   *   Bottom: tileToWorld(MAP_WIDTH-1, MAP_HEIGHT-1)
   *   Left:   tileToWorld(0, MAP_HEIGHT-1)
   *
   * We fill four triangular regions between the diamond edges and a large
   * bounding rectangle that extends well beyond the world bounds.
   */
  private createBorderMask(): void {
    this.borderMask = this.scene.add.graphics();
    this.borderMask.setDepth(46); // Above fog (45)

    // Compute the four diamond corner positions in world space.
    // Add half-tile offsets so the mask aligns with the outer edges of the
    // corner tiles rather than their centers.
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;

    const topCenter = tileToWorld(0, 0);
    const rightCenter = tileToWorld(MAP_WIDTH - 1, 0);
    const bottomCenter = tileToWorld(MAP_WIDTH - 1, MAP_HEIGHT - 1);
    const leftCenter = tileToWorld(0, MAP_HEIGHT - 1);

    // Diamond outer edge points (the outermost pixel of each corner tile)
    const dTop = { x: topCenter.x, y: topCenter.y - halfH };
    const dRight = { x: rightCenter.x + halfW, y: rightCenter.y };
    const dBottom = { x: bottomCenter.x, y: bottomCenter.y + halfH };
    const dLeft = { x: leftCenter.x - halfW, y: leftCenter.y };

    // Large bounding rectangle with generous padding beyond the world
    const pad = 2000;
    const rectLeft = -pad;
    const rectTop = -pad;
    const rectRight = WORLD_WIDTH + pad;
    const rectBottom = WORLD_HEIGHT + pad;

    this.borderMask.fillStyle(0x000000, 1.0);

    // Top region: rect top-left -> rect top-right -> diamond Right -> diamond Top
    this.borderMask.beginPath();
    this.borderMask.moveTo(rectLeft, rectTop);
    this.borderMask.lineTo(rectRight, rectTop);
    this.borderMask.lineTo(dRight.x, dRight.y);
    this.borderMask.lineTo(dTop.x, dTop.y);
    this.borderMask.closePath();
    this.borderMask.fillPath();

    // Right region: rect top-right -> rect bottom-right -> diamond Bottom -> diamond Right
    this.borderMask.beginPath();
    this.borderMask.moveTo(rectRight, rectTop);
    this.borderMask.lineTo(rectRight, rectBottom);
    this.borderMask.lineTo(dBottom.x, dBottom.y);
    this.borderMask.lineTo(dRight.x, dRight.y);
    this.borderMask.closePath();
    this.borderMask.fillPath();

    // Bottom region: rect bottom-right -> rect bottom-left -> diamond Left -> diamond Bottom
    this.borderMask.beginPath();
    this.borderMask.moveTo(rectRight, rectBottom);
    this.borderMask.lineTo(rectLeft, rectBottom);
    this.borderMask.lineTo(dLeft.x, dLeft.y);
    this.borderMask.lineTo(dBottom.x, dBottom.y);
    this.borderMask.closePath();
    this.borderMask.fillPath();

    // Left region: rect bottom-left -> rect top-left -> diamond Top -> diamond Left
    this.borderMask.beginPath();
    this.borderMask.moveTo(rectLeft, rectBottom);
    this.borderMask.lineTo(rectLeft, rectTop);
    this.borderMask.lineTo(dTop.x, dTop.y);
    this.borderMask.lineTo(dLeft.x, dLeft.y);
    this.borderMask.closePath();
    this.borderMask.fillPath();
  }

  // ─── Visibility Updates ───────────────────────────────────────────────────

  /**
   * Recalculate visibility for a given player based on their units and buildings.
   *
   * Steps:
   * 1. Downgrade all "visible" (2) cells to "explored" (1)
   * 2. Apply sight stamps from each owned unit
   * 3. Apply sight stamps from each owned building
   */
  private updateVisibility(
    player: number,
    squads: Squad[],
    buildings: Building[],
  ): void {
    const grid = this.visibility[player];

    // Step 1: Downgrade visible -> explored
    for (let i = 0, len = grid.length; i < len; i++) {
      if (grid[i] === 2) {
        grid[i] = 1;
      }
    }

    // Step 2: Apply sight from owned units
    for (const squad of squads) {
      if (squad.owner !== player) continue;
      if (squad.hp <= 0) continue;

      const stamp = this.getSightStamp(squad.stats.sightRange);
      this.applySightStamp(grid, squad.tileX, squad.tileY, stamp);
    }

    // Step 3: Apply sight from owned buildings
    for (const building of buildings) {
      if (building.owner !== player) continue;

      // Use center tile of the building footprint
      const centerTileX = building.tileX + Math.floor(building.stats.widthTiles / 2);
      const centerTileY = building.tileY + Math.floor(building.stats.heightTiles / 2);

      const stamp = this.getSightStamp(DEFAULT_BUILDING_SIGHT_RANGE);
      this.applySightStamp(grid, centerTileX, centerTileY, stamp);
    }
  }

  /**
   * Apply a pre-computed sight stamp to the visibility grid, centered on (cx, cy).
   * Sets all affected tiles to "visible" (2).
   */
  private applySightStamp(
    grid: Uint8Array,
    cx: number,
    cy: number,
    stamp: { dx: number; dy: number }[],
  ): void {
    for (const offset of stamp) {
      const tx = cx + offset.dx;
      const ty = cy + offset.dy;

      // Bounds check
      if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) continue;

      grid[ty * MAP_WIDTH + tx] = 2;
    }
  }

  // ─── Fog Rendering ────────────────────────────────────────────────────────

  /**
   * Render the fog overlay for a given player, drawing isometric diamond tiles
   * within the camera's viewport.
   */
  private renderFog(
    player: number,
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    this.fogGraphics.clear();

    const grid = this.visibility[player];
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;

    // Convert camera viewport corners to tile coords for culling
    const vx = camera.worldView.x;
    const vy = camera.worldView.y;
    const vw = camera.worldView.width;
    const vh = camera.worldView.height;

    const topLeft = worldToTile(vx, vy);
    const topRight = worldToTile(vx + vw, vy);
    const bottomLeft = worldToTile(vx, vy + vh);
    const bottomRight = worldToTile(vx + vw, vy + vh);

    // In isometric projection, the visible tile range doesn't map to a simple
    // rectangle. Use the extremes from all four corners with generous margin.
    const margin = 10;
    const startTileX = Math.max(
      0,
      Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x) - margin,
    );
    const startTileY = Math.max(
      0,
      Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y) - margin,
    );
    const endTileX = Math.min(
      MAP_WIDTH - 1,
      Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x) + margin,
    );
    const endTileY = Math.min(
      MAP_HEIGHT - 1,
      Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y) + margin,
    );

    // Helper to draw an isometric diamond at the given tile position.
    // Each vertex is expanded outward by 0.5px to eliminate sub-pixel gaps
    // between adjacent diamonds that cause terrain bleed-through artifacts.
    const expand = 0.5;
    const drawDiamond = (tx: number, ty: number): void => {
      const center = tileToWorld(tx, ty);
      this.fogGraphics.beginPath();
      this.fogGraphics.moveTo(center.x, center.y - halfH - expand); // top
      this.fogGraphics.lineTo(center.x + halfW + expand, center.y); // right
      this.fogGraphics.lineTo(center.x, center.y + halfH + expand); // bottom
      this.fogGraphics.lineTo(center.x - halfW - expand, center.y); // left
      this.fogGraphics.closePath();
      this.fogGraphics.fillPath();
    };

    // Batch unexplored and explored fills separately for fewer style switches
    // Draw unexplored tiles (solid black)
    this.fogGraphics.fillStyle(0x000000, 0.95);
    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        const vis = grid[ty * MAP_WIDTH + tx];
        if (vis === 0) {
          drawDiamond(tx, ty);
        }
      }
    }

    // Draw explored tiles (semi-transparent dark)
    this.fogGraphics.fillStyle(0x000000, 0.55);
    for (let ty = startTileY; ty <= endTileY; ty++) {
      for (let tx = startTileX; tx <= endTileX; tx++) {
        const vis = grid[ty * MAP_WIDTH + tx];
        if (vis === 1) {
          drawDiamond(tx, ty);
        }
      }
    }
    // vis === 2: fully visible, draw nothing
  }

  // ─── Entity Visibility ───────────────────────────────────────────────────

  /**
   * Hide/show enemy units based on fog of war visibility for the given player.
   * - Enemy units in visible (2) tiles: show
   * - Enemy units in explored (1) or unexplored (0) tiles: hide
   * - Neutral/gang buildings: always visible once explored (AoE2 behavior)
   */
  private updateEntityVisibility(
    player: number,
    squads: Squad[],
    buildings: Building[],
  ): void {
    const grid = this.visibility[player];

    // Handle enemy squads
    for (const squad of squads) {
      // Don't touch the player's own units
      if (squad.owner === player) continue;
      if (squad.hp <= 0) continue;

      const vis = this.getVisibility(squad.tileX, squad.tileY, player);

      if (vis === 2) {
        // Visible: show enemy unit
        squad.sprite.setVisible(true);
        squad.healthBar.setVisible(true);
        squad.selectionCircle.setVisible(squad.isSelected);
      } else {
        // Not visible: hide enemy unit
        squad.sprite.setVisible(false);
        squad.healthBar.setVisible(false);
        squad.selectionCircle.setVisible(false);
      }
    }

    // Handle buildings visibility
    for (const building of buildings) {
      // Player's own buildings: always visible
      if (building.owner === player) continue;

      // Check if any tile of the building footprint is explored or visible
      let maxVis = 0;
      for (let dy = 0; dy < building.stats.heightTiles; dy++) {
        for (let dx = 0; dx < building.stats.widthTiles; dx++) {
          const tx = building.tileX + dx;
          const ty = building.tileY + dy;
          if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
            const v = grid[ty * MAP_WIDTH + tx];
            if (v > maxVis) maxVis = v;
          }
        }
      }

      if (maxVis === 0) {
        // Unexplored: hide completely
        building.sprite.setVisible(false);
        building.borderGraphics.setVisible(false);
        building.label.setVisible(false);
        building.healthBar.setVisible(false);
        building.captureBar.setVisible(false);
      } else {
        // Explored or visible: show (neutral/gang buildings remain visible
        // once discovered, matching AoE2 behavior)
        building.sprite.setVisible(true);
        building.borderGraphics.setVisible(true);
        building.label.setVisible(true);
        // Health bar and capture bar manage their own visibility internally,
        // so we just ensure the building itself is visible
      }
    }
  }

  // ─── Public Query Methods ─────────────────────────────────────────────────

  /** Returns true if the tile is currently visible (state 2) for the player. */
  isVisible(tileX: number, tileY: number, player: number): boolean {
    if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) {
      return false;
    }
    return this.visibility[player][tileY * MAP_WIDTH + tileX] === 2;
  }

  /** Returns true if the tile has been explored (state >= 1) for the player. */
  isExplored(tileX: number, tileY: number, player: number): boolean {
    if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) {
      return false;
    }
    return this.visibility[player][tileY * MAP_WIDTH + tileX] >= 1;
  }

  /** Returns the raw visibility state (0, 1, or 2) for the tile. */
  getVisibility(tileX: number, tileY: number, player: number): number {
    if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) {
      return 0;
    }
    return this.visibility[player][tileY * MAP_WIDTH + tileX];
  }

  // ─── Main Update ──────────────────────────────────────────────────────────

  /**
   * Called every frame from GameScene.update().
   * Throttles visibility recalculation to updateInterval ms,
   * but always re-renders the fog overlay (since the camera may have moved).
   *
   * @param delta     Frame delta in ms
   * @param player    The player index whose fog to manage (0 = human)
   * @param squads    All squads in the game
   * @param buildings All buildings in the game
   * @param camera    The main camera (for viewport culling)
   */
  update(
    delta: number,
    player: number,
    squads: Squad[],
    buildings: Building[],
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    this.lastUpdate += delta;

    // Recalculate visibility grid at the throttled interval
    if (this.lastUpdate >= this.updateInterval) {
      this.lastUpdate = 0;
      this.updateVisibility(player, squads, buildings);
      this.updateEntityVisibility(player, squads, buildings);
    }

    // Always re-render the fog overlay since the camera may have scrolled
    this.renderFog(player, camera);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /** Destroy the fog overlay graphics object and border mask. */
  destroy(): void {
    if (this.fogGraphics) {
      this.fogGraphics.destroy();
    }
    if (this.borderMask) {
      this.borderMask.destroy();
    }
  }
}
