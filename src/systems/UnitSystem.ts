// ─── Unit System ─────────────────────────────────────────────────────────────
// Manages all squads: spawning, removal, selection, group commands, and updates.
// Listens to EventBus for move/attack orders from the input layer.

import Phaser from 'phaser';
import { TILE_WIDTH, TILE_HEIGHT } from '../data/config';
import { UnitType } from '../data/units';
import { Squad, setEnemyScanCallback } from '../entities/Squad';
import { pathfinding } from '../utils/Pathfinding';
import { EventBus, GameEvents } from '../utils/EventBus';

export class UnitSystem {
  public squads: Map<string, Squad> = new Map();
  public selectedSquads: Squad[] = [];
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Listen for commands from input / UI
    EventBus.on(GameEvents.MOVE_ORDER, this.onMoveOrder);
    EventBus.on(GameEvents.ATTACK_ORDER, this.onAttackOrder);

    // Clean up dead squads
    EventBus.on(GameEvents.SQUAD_WIPED, this.onSquadWiped);

    // Provide squads with a way to scan for nearby enemies (for attack-move)
    setEnemyScanCallback((squad: Squad, range: number) => this.getEnemiesInRange(squad, range));
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  spawnSquad(type: UnitType, owner: number, tileX: number, tileY: number): Squad {
    const squad = new Squad(this.scene, type, owner, tileX, tileY);
    this.squads.set(squad.id, squad);
    return squad;
  }

  removeSquad(id: string): void {
    const squad = this.squads.get(id);
    if (!squad) return;

    // Remove from selection if present
    const selIdx = this.selectedSquads.indexOf(squad);
    if (selIdx !== -1) {
      this.selectedSquads.splice(selIdx, 1);
    }

    squad.destroy();
    this.squads.delete(id);
  }

  update(delta: number): void {
    // Advance pathfinding calculations
    pathfinding.update();

    // Update every living squad
    for (const squad of this.squads.values()) {
      squad.update(delta);
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────────

  getSquadsAt(tileX: number, tileY: number, radius: number): Squad[] {
    const results: Squad[] = [];
    for (const squad of this.squads.values()) {
      const dx = squad.tileX - tileX;
      const dy = squad.tileY - tileY;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        results.push(squad);
      }
    }
    return results;
  }

  /** Return all enemy squads within a tile distance of the given squad. */
  getEnemiesInRange(squad: Squad, range: number): Squad[] {
    const results: Squad[] = [];
    for (const other of this.squads.values()) {
      if (other.owner === squad.owner) continue;
      if (other.hp <= 0) continue;
      if (squad.distanceTo(other) <= range) {
        results.push(other);
      }
    }
    return results;
  }

  getSquadsByOwner(owner: number): Squad[] {
    const results: Squad[] = [];
    for (const squad of this.squads.values()) {
      if (squad.owner === owner) {
        results.push(squad);
      }
    }
    return results;
  }

  /**
   * Find the squad whose sprite overlaps the given pixel coordinate.
   * Returns the first match or null.
   */
  getSquadAtPixel(x: number, y: number): Squad | null {
    const halfW = TILE_WIDTH / 2;  // 32px — matches isometric tile width
    const halfH = TILE_HEIGHT / 2; // 16px — matches isometric tile height
    for (const squad of this.squads.values()) {
      const sx = squad.getPixelX();
      const sy = squad.getPixelY();
      if (
        x >= sx - halfW &&
        x <= sx + halfW &&
        y >= sy - halfH &&
        y <= sy + halfH
      ) {
        return squad;
      }
    }
    return null;
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  selectSquad(squad: Squad): void {
    // Only allow selecting player 0 squads for now
    if (squad.owner !== 0) return;

    this.deselectAll();
    squad.select();
    this.selectedSquads.push(squad);
  }

  addToSelection(squad: Squad): void {
    if (squad.owner !== 0) return;
    if (this.selectedSquads.includes(squad)) return;

    squad.select();
    this.selectedSquads.push(squad);
  }

  /**
   * Box-select all player 0 squads whose pixel position falls within the rectangle.
   * Coordinates are in world-space pixels.
   */
  selectInBox(x1: number, y1: number, x2: number, y2: number): void {
    this.deselectAll();

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    for (const squad of this.squads.values()) {
      if (squad.owner !== 0) continue;

      const px = squad.getPixelX();
      const py = squad.getPixelY();
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        squad.select();
        this.selectedSquads.push(squad);
      }
    }
  }

  deselectAll(): void {
    for (const squad of this.selectedSquads) {
      squad.deselect();
    }
    this.selectedSquads = [];
    EventBus.emit(GameEvents.SELECTION_CLEARED);
  }

  // ─── Advanced Selection ────────────────────────────────────────────────────

  /** Select squads by their IDs. Deselects all first. */
  selectSquadsById(ids: string[]): void {
    this.deselectAll();
    for (const id of ids) {
      const squad = this.squads.get(id);
      if (squad && squad.owner === 0) {
        squad.select();
        this.selectedSquads.push(squad);
      }
    }
  }

  /** Select all squads of a given unitType within camera bounds, owned by the given player. */
  selectAllOfType(unitType: string, cameraBounds: Phaser.Geom.Rectangle, owner: number): void {
    this.deselectAll();
    for (const squad of this.squads.values()) {
      if (squad.owner !== owner) continue;
      if (squad.stats.type !== unitType) continue;

      const px = squad.getPixelX();
      const py = squad.getPixelY();
      if (cameraBounds.contains(px, py)) {
        squad.select();
        this.selectedSquads.push(squad);
      }
    }
  }

  /** Get all idle squads for the given owner. */
  getIdleSquads(owner: number): Squad[] {
    const results: Squad[] = [];
    for (const squad of this.squads.values()) {
      if (squad.owner === owner && squad.state === 'idle') {
        results.push(squad);
      }
    }
    return results;
  }

  // ─── Group Commands ─────────────────────────────────────────────────────────

  /**
   * Move all selected squads toward the target tile.
   * When multiple squads are selected, offset their targets in a grid pattern
   * so they don't all stack on the same tile.
   */
  moveSelectedTo(tileX: number, tileY: number): void {
    const count = this.selectedSquads.length;
    if (count === 0) return;

    if (count === 1) {
      this.selectedSquads[0].moveTo(tileX, tileY);
      return;
    }

    // Arrange squads in a rough grid around the target
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Center the grid on the target tile
      const offsetX = col - Math.floor(cols / 2);
      const offsetY = row - Math.floor(cols / 2);
      const destX = tileX + offsetX;
      const destY = tileY + offsetY;
      this.selectedSquads[i].moveTo(destX, destY);
    }
  }

  attackWithSelected(target: Squad): void {
    for (const squad of this.selectedSquads) {
      squad.attackTarget = target;
      squad.state = 'attacking';

      // If not in range, move toward the target first
      if (!squad.isInRange(target)) {
        squad.moveTo(target.tileX, target.tileY);
      }
    }
    EventBus.emit(GameEvents.COMBAT_STARTED, this.selectedSquads, target);
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  private onMoveOrder = (tileX: number, tileY: number): void => {
    this.moveSelectedTo(tileX, tileY);
  };

  private onAttackOrder = (target: Squad): void => {
    this.attackWithSelected(target);
  };

  private onSquadWiped = (squad: Squad): void => {
    this.removeSquad(squad.id);
  };

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  destroy(): void {
    EventBus.off(GameEvents.MOVE_ORDER, this.onMoveOrder);
    EventBus.off(GameEvents.ATTACK_ORDER, this.onAttackOrder);
    EventBus.off(GameEvents.SQUAD_WIPED, this.onSquadWiped);

    for (const squad of this.squads.values()) {
      squad.destroy();
    }
    this.squads.clear();
    this.selectedSquads = [];
  }
}
