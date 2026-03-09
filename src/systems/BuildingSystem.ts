// ─── Building System ─────────────────────────────────────────────────────────
// Manages the lifecycle of all buildings: creation, capture logic, spatial
// queries, and per-frame updates.

import Phaser from 'phaser';
import { BuildingType } from '../data/buildings';
import { Building } from '../entities/Building';
import { EventBus, GameEvents } from '../utils/EventBus';

export interface BuildingPlacement {
  type: BuildingType;
  tileX: number;
  tileY: number;
  owner: number;
}

export class BuildingSystem {
  buildings: Map<string, Building> = new Map();
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Listen for building destruction so we can clean up our registry
    EventBus.on(GameEvents.BUILDING_DESTROYED, this.onBuildingDestroyed);
  }

  // ─── Creation ──────────────────────────────────────────────────────────────

  /** Create a single building and register it. */
  createBuilding(
    type: BuildingType,
    owner: number,
    tileX: number,
    tileY: number,
  ): Building {
    const building = new Building(this.scene, type, owner, tileX, tileY);
    this.buildings.set(building.id, building);
    return building;
  }

  /** Batch-create buildings from map generation output. */
  initializeFromPlacements(placements: BuildingPlacement[]): void {
    for (const p of placements) {
      this.createBuilding(p.type, p.owner, p.tileX, p.tileY);
    }
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  /** Called every frame. Advances capture timers and refreshes visuals. */
  update(delta: number): void {
    for (const building of this.buildings.values()) {
      building.update(delta);
    }
  }

  // ─── Spatial Queries ───────────────────────────────────────────────────────

  /** Find a building whose pixel bounds contain the given point. */
  getBuildingAt(pixelX: number, pixelY: number): Building | null {
    for (const building of this.buildings.values()) {
      if (building.containsPoint(pixelX, pixelY)) {
        return building;
      }
    }
    return null;
  }

  /**
   * Find a building whose tile footprint contains the given tile coordinate.
   * A building occupies tiles from (tileX, tileY) to
   * (tileX + widthTiles - 1, tileY + heightTiles - 1).
   */
  getBuildingAtTile(tileX: number, tileY: number): Building | null {
    for (const building of this.buildings.values()) {
      const bx = building.tileX;
      const by = building.tileY;
      const bw = building.stats.widthTiles;
      const bh = building.stats.heightTiles;

      if (
        tileX >= bx &&
        tileX < bx + bw &&
        tileY >= by &&
        tileY < by + bh
      ) {
        return building;
      }
    }
    return null;
  }

  // ─── Ownership Queries ─────────────────────────────────────────────────────

  /** Get all buildings owned by a specific player (or neutral with -1). */
  getBuildingsByOwner(owner: number): Building[] {
    const result: Building[] = [];
    for (const building of this.buildings.values()) {
      if (building.owner === owner) {
        result.push(building);
      }
    }
    return result;
  }

  /** Get all neutral (unowned) buildings. */
  getNeutralBuildings(): Building[] {
    return this.getBuildingsByOwner(-1);
  }

  /** Get a player's compound building, or null if they don't have one. */
  getCompound(owner: number): Building | null {
    for (const building of this.buildings.values()) {
      if (
        building.type === BuildingType.COMPOUND &&
        building.owner === owner
      ) {
        return building;
      }
    }
    return null;
  }

  // ─── Capture Logic ─────────────────────────────────────────────────────────

  /**
   * Start or continue a capture attempt on a building.
   *
   * @param buildingId  The building to capture
   * @param playerIndex The player attempting capture
   * @param squadCount  Number of squads near the building (affects speed)
   */
  tryCapture(
    buildingId: string,
    playerIndex: number,
    squadCount: number,
  ): void {
    const building = this.buildings.get(buildingId);
    if (!building) return;

    // Can't capture your own building
    if (building.owner === playerIndex) return;

    if (!building.isBeingCaptured) {
      building.startCapture(playerIndex);
    }

    // If a different player is trying to capture, restart for the new player
    if (
      building.isBeingCaptured &&
      building.capturingPlayer !== playerIndex
    ) {
      building.cancelCapture();
      building.startCapture(playerIndex);
    }

    // Feed squad count into the capture update so speed scales correctly.
    // The actual advancement happens in building.update() each frame, but
    // we store the squad count so it can be used there. Since the Building
    // entity's update() calls updateCapture with a default squadCount of 1,
    // we override by calling updateCapture directly during the system update
    // when we have squad proximity data. For now, we just ensure capture has
    // started -- the system update loop (or a future proximity check) will
    // supply the real squad count.
  }

  /** Cancel an in-progress capture on a building. */
  cancelCapture(buildingId: string): void {
    const building = this.buildings.get(buildingId);
    if (building) {
      building.cancelCapture();
    }
  }

  /**
   * Check whether capturing players still have units within range.
   * Call this each frame with a function that counts squads near a building.
   *
   * @param getSquadCountNear A callback that returns the number of squads
   *   belonging to `playerIndex` within `radius` tiles of the building.
   *   The building system doesn't own unit data, so this is injected.
   */
  /**
   * Validate and advance captures. Building.update() no longer advances capture;
   * this method is the sole driver, using the real squad count for speed scaling.
   */
  validateCaptures(
    delta: number,
    getSquadCountNear: (
      buildingId: string,
      playerIndex: number,
      radiusTiles: number,
    ) => number,
  ): void {
    const captureRadius = 2; // tiles

    for (const building of this.buildings.values()) {
      if (!building.isBeingCaptured) continue;

      const nearbySquads = getSquadCountNear(
        building.id,
        building.capturingPlayer,
        captureRadius,
      );

      if (nearbySquads <= 0) {
        building.cancelCapture();
      } else {
        building.updateCapture(delta, nearbySquads);
      }
    }
  }

  // ─── Removal ───────────────────────────────────────────────────────────────

  /** Remove a building from the registry. Does NOT call building.destroy(). */
  removeBuilding(id: string): void {
    this.buildings.delete(id);
  }

  // ─── Internal Handlers ─────────────────────────────────────────────────────

  /** Auto-remove buildings from registry when they're destroyed. */
  private onBuildingDestroyed = (data: { buildingId: string }): void => {
    this.buildings.delete(data.buildingId);
  };

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /** Tear down the system and all managed buildings. */
  destroy(): void {
    EventBus.off(GameEvents.BUILDING_DESTROYED, this.onBuildingDestroyed);

    for (const building of this.buildings.values()) {
      building.destroy();
    }
    this.buildings.clear();
  }
}
