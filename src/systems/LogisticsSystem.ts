// ─── Logistics System ────────────────────────────────────────────────────────
// Manages goods transport — the game's signature mechanic. Trucks carry goods
// from production buildings to compounds/warehouses. Goods that are produced
// accumulate at the building and must be physically picked up and delivered.
// If a truck is destroyed, 40% of its cargo drops on the ground as a pickup.

import Phaser from 'phaser';
import { TILE_SIZE } from '../data/config';
import { EventBus, GameEvents } from '../utils/EventBus';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface TruckRoute {
  id: string;
  squadId: string; // The truck/runner squad ID
  sourceBuilding: string; // Building ID (goods producer)
  destBuilding: string; // Building ID (compound or warehouse)
  owner: number;
  state: 'loading' | 'enroute_dest' | 'unloading' | 'enroute_source' | 'idle';
  autoRepeat: boolean; // Keep running this route
}

export interface DroppedGoods {
  id: string;
  tileX: number;
  tileY: number;
  amount: number;
  expireTime: number; // game time (ms) when these despawn
  sprite: Phaser.GameObjects.Graphics; // Visual marker
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** How long dropped goods remain on the ground before despawning (ms). */
const DROPPED_GOODS_EXPIRE_MS = 45000;

/** Fraction of truck cargo that drops on destruction (40% = insurance loss). */
const GOODS_DROP_FRACTION = 0.4;

/** Tile distance within which a squad auto-picks up dropped goods. */
const PICKUP_RADIUS_TILES = 1;

/** Tile distance threshold to consider a unit "arrived" at a building. */
const ARRIVAL_RADIUS_TILES = 1.5;

// ─── LogisticsSystem ─────────────────────────────────────────────────────────

export class LogisticsSystem {
  public scene: Phaser.Scene;
  public truckRoutes: TruckRoute[];
  public droppedGoods: DroppedGoods[];

  private routeCounter: number;
  private droppedGoodsCounter: number;
  private pulseTimer: number; // For the pulsing glow animation on dropped goods

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.truckRoutes = [];
    this.droppedGoods = [];
    this.routeCounter = 0;
    this.droppedGoodsCounter = 0;
    this.pulseTimer = 0;
  }

  // ─── Route Management ─────────────────────────────────────────────────────

  /** Set up a new transport route for a truck/runner squad. */
  createRoute(
    squadId: string,
    sourceBuildingId: string,
    destBuildingId: string,
    owner: number,
    autoRepeat: boolean,
  ): TruckRoute {
    const route: TruckRoute = {
      id: `route_${owner}_${this.routeCounter++}`,
      squadId,
      sourceBuilding: sourceBuildingId,
      destBuilding: destBuildingId,
      owner,
      state: 'loading',
      autoRepeat,
    };

    this.truckRoutes.push(route);
    return route;
  }

  /** Cancel a route. The truck becomes idle. */
  cancelRoute(routeId: string): void {
    const idx = this.truckRoutes.findIndex((r) => r.id === routeId);
    if (idx !== -1) {
      this.truckRoutes[idx].state = 'idle';
      this.truckRoutes.splice(idx, 1);
    }
  }

  /** Find the route assigned to a specific truck/runner squad. */
  getRouteForSquad(squadId: string): TruckRoute | null {
    return this.truckRoutes.find((r) => r.squadId === squadId) ?? null;
  }

  /** Get all active routes for a specific player. */
  getActiveRoutes(owner: number): TruckRoute[] {
    return this.truckRoutes.filter((r) => r.owner === owner);
  }

  // ─── Main Update Loop ─────────────────────────────────────────────────────

  /**
   * Called each frame. Updates truck routes, building goods production,
   * and dropped goods pickups.
   *
   * @param delta - Frame delta in milliseconds
   * @param getSquad - Lookup a squad by ID (returns null if destroyed)
   * @param getBuilding - Lookup a building by ID (returns null if destroyed)
   * @param addGoods - Callback to add goods to a player's stockpile
   * @param getAllSquads - Returns all active squads (for dropped goods proximity)
   * @param getAllBuildings - Returns all buildings (for goods production)
   * @param gameTime - Current game elapsed time in ms (for expiry tracking)
   */
  update(
    delta: number,
    getSquad: (id: string) => any | null,
    getBuilding: (id: string) => any | null,
    addGoods: (player: number, amount: number) => void,
    getAllSquads?: () => any[],
    getAllBuildings?: () => any[],
    gameTime?: number,
  ): void {
    // ── Update truck routes ───────────────────────────────────────────────
    this.updateRoutes(delta, getSquad, getBuilding, addGoods);

    // ── Accumulate goods at production buildings ──────────────────────────
    if (getAllBuildings) {
      this.updateBuildingProduction(delta, getAllBuildings());
    }

    // ── Update dropped goods (expiry, proximity pickup, visual pulse) ────
    this.updateDroppedGoods(
      delta,
      getAllSquads ? getAllSquads() : [],
      addGoods,
      getBuilding,
      gameTime ?? 0,
    );
  }

  // ─── Route State Machine ──────────────────────────────────────────────────

  private updateRoutes(
    _delta: number,
    getSquad: (id: string) => any | null,
    getBuilding: (id: string) => any | null,
    addGoods: (player: number, amount: number) => void,
  ): void {
    // Process routes in reverse so we can safely remove while iterating
    for (let i = this.truckRoutes.length - 1; i >= 0; i--) {
      const route = this.truckRoutes[i];
      const squad = getSquad(route.squadId);

      // If the truck no longer exists, clean up the route
      if (!squad) {
        this.truckRoutes.splice(i, 1);
        continue;
      }

      const sourceBuilding = getBuilding(route.sourceBuilding);
      const destBuilding = getBuilding(route.destBuilding);

      // If either building was destroyed, cancel the route
      if (!sourceBuilding || !destBuilding) {
        route.state = 'idle';
        this.truckRoutes.splice(i, 1);
        continue;
      }

      switch (route.state) {
        case 'loading':
          this.handleLoading(route, squad, sourceBuilding, destBuilding);
          break;

        case 'enroute_dest':
          this.handleEnrouteDest(route, squad, destBuilding);
          break;

        case 'unloading':
          this.handleUnloading(route, squad, sourceBuilding, addGoods);
          break;

        case 'enroute_source':
          this.handleEnrouteSource(route, squad, sourceBuilding);
          break;

        case 'idle':
          // Do nothing — route is paused or truck is waiting for orders
          break;
      }
    }
  }

  /**
   * Loading state: truck is at the source building.
   * Load goods from building storage onto the truck, then pathfind to dest.
   */
  private handleLoading(
    route: TruckRoute,
    squad: any,
    sourceBuilding: any,
    destBuilding: any,
  ): void {
    // Check the truck is actually near the source building
    if (!this.isSquadAtBuilding(squad, sourceBuilding)) {
      // Move toward the source building if not there yet
      squad.moveTo(sourceBuilding.tileX, sourceBuilding.tileY);
      return;
    }

    // Load goods from the building's stored goods into the truck
    const capacity = squad.stats.goodsCapacity ?? 0;
    const currentlyCarrying = squad.carryingGoods ?? 0;
    const spaceAvailable = capacity - currentlyCarrying;

    if (spaceAvailable <= 0 || sourceBuilding.goodsStored <= 0) {
      // If the building has no goods and the truck is empty, wait
      if (currentlyCarrying <= 0 && sourceBuilding.goodsStored <= 0) {
        return; // Stay in loading state, waiting for goods to accumulate
      }

      // If the truck has some goods already (partial load), proceed to deliver
      if (currentlyCarrying > 0) {
        squad.moveTo(destBuilding.tileX, destBuilding.tileY);
        route.state = 'enroute_dest';
      }
      return;
    }

    // Transfer goods from building to truck
    const loadAmount = Math.min(spaceAvailable, sourceBuilding.goodsStored);
    sourceBuilding.goodsStored -= loadAmount;
    squad.carryingGoods = currentlyCarrying + loadAmount;

    // Once loaded, pathfind to destination
    squad.moveTo(destBuilding.tileX, destBuilding.tileY);
    route.state = 'enroute_dest';
  }

  /**
   * Enroute to destination: truck is moving (handled by UnitSystem).
   * Check if it has arrived at the destination building.
   */
  private handleEnrouteDest(
    route: TruckRoute,
    squad: any,
    destBuilding: any,
  ): void {
    if (this.isSquadAtBuilding(squad, destBuilding)) {
      route.state = 'unloading';
    }
  }

  /**
   * Unloading state: transfer goods from truck to player stockpile.
   * If autoRepeat, pathfind back to source.
   */
  private handleUnloading(
    route: TruckRoute,
    squad: any,
    sourceBuilding: any,
    addGoods: (player: number, amount: number) => void,
  ): void {
    const goodsToDeliver = squad.carryingGoods ?? 0;

    if (goodsToDeliver > 0) {
      addGoods(route.owner, goodsToDeliver);
      squad.carryingGoods = 0;

      EventBus.emit(GameEvents.GOODS_DELIVERED, {
        player: route.owner,
        amount: goodsToDeliver,
        routeId: route.id,
        squadId: route.squadId,
      });
    }

    if (route.autoRepeat) {
      // Head back to source for another load
      squad.moveTo(sourceBuilding.tileX, sourceBuilding.tileY);
      route.state = 'enroute_source';
    } else {
      route.state = 'idle';
    }
  }

  /**
   * Enroute back to source: truck is returning.
   * Check if it has arrived at the source building.
   */
  private handleEnrouteSource(
    route: TruckRoute,
    squad: any,
    sourceBuilding: any,
  ): void {
    if (this.isSquadAtBuilding(squad, sourceBuilding)) {
      route.state = 'loading';
    }
  }

  // ─── Truck Destruction ────────────────────────────────────────────────────

  /**
   * Called when a truck/runner is destroyed. Drops a fraction of its cargo
   * as a pickup on the ground and emits the TRUCK_DESTROYED event.
   */
  onTruckDestroyed(squadId: string, squad: any): void {
    const route = this.getRouteForSquad(squadId);
    const carryingGoods = squad?.carryingGoods ?? 0;

    // Calculate goods lost vs dropped
    // 60% is lost (insurance), 40% drops on the ground as a pickup
    const droppedAmount = Math.floor(carryingGoods * GOODS_DROP_FRACTION);

    // Get the truck's last known position
    const tileX = squad?.tileX ?? 0;
    const tileY = squad?.tileY ?? 0;

    // Create a dropped goods pickup if there are goods to drop
    if (droppedAmount > 0) {
      this.createDroppedGoods(tileX, tileY, droppedAmount);
    }

    // Emit the truck destroyed event
    EventBus.emit(GameEvents.TRUCK_DESTROYED, {
      squadId,
      routeId: route?.id ?? null,
      owner: route?.owner ?? squad?.owner ?? -1,
      tileX,
      tileY,
      goodsCarried: carryingGoods,
      goodsDropped: droppedAmount,
      goodsLost: carryingGoods - droppedAmount,
    });

    // Remove the route
    if (route) {
      const routeIdx = this.truckRoutes.indexOf(route);
      if (routeIdx !== -1) {
        this.truckRoutes.splice(routeIdx, 1);
      }
    }
  }

  // ─── Dropped Goods ────────────────────────────────────────────────────────

  /** Create a dropped goods pickup at the given tile location. */
  private createDroppedGoods(
    tileX: number,
    tileY: number,
    amount: number,
  ): void {
    const pixelX = tileX * TILE_SIZE + TILE_SIZE / 2;
    const pixelY = tileY * TILE_SIZE + TILE_SIZE / 2;

    // Create visual: a small glowing crate marker
    const sprite = this.scene.add.graphics();
    sprite.setDepth(8);
    this.drawDroppedGoodsSprite(sprite, pixelX, pixelY, 1.0);

    const dropped: DroppedGoods = {
      id: `dropped_${this.droppedGoodsCounter++}`,
      tileX,
      tileY,
      amount,
      expireTime: this.scene.time.now + DROPPED_GOODS_EXPIRE_MS,
      sprite,
    };

    this.droppedGoods.push(dropped);

    EventBus.emit(GameEvents.GOODS_DROPPED, {
      id: dropped.id,
      tileX,
      tileY,
      amount,
    });
  }

  /**
   * Draw the dropped goods visual: a small crate with pulsing golden glow.
   * @param alpha - Pulse alpha for the glow (0..1 oscillating)
   */
  private drawDroppedGoodsSprite(
    graphics: Phaser.GameObjects.Graphics,
    pixelX: number,
    pixelY: number,
    alpha: number,
  ): void {
    graphics.clear();

    // Outer glow (pulsing)
    const glowRadius = TILE_SIZE * 0.6;
    graphics.fillStyle(0xffaa00, 0.15 * alpha);
    graphics.fillCircle(pixelX, pixelY, glowRadius);

    // Inner glow
    graphics.fillStyle(0xffcc00, 0.3 * alpha);
    graphics.fillCircle(pixelX, pixelY, glowRadius * 0.6);

    // Crate body (small brown rectangle)
    const crateSize = TILE_SIZE * 0.4;
    graphics.fillStyle(0x8b4513, 0.9);
    graphics.fillRect(
      pixelX - crateSize / 2,
      pixelY - crateSize / 2,
      crateSize,
      crateSize,
    );

    // Crate cross-bands (lighter)
    const bandWidth = 2;
    graphics.fillStyle(0xdaa520, 0.8);
    // Horizontal band
    graphics.fillRect(
      pixelX - crateSize / 2,
      pixelY - bandWidth / 2,
      crateSize,
      bandWidth,
    );
    // Vertical band
    graphics.fillRect(
      pixelX - bandWidth / 2,
      pixelY - crateSize / 2,
      bandWidth,
      crateSize,
    );

    // Border
    graphics.lineStyle(1, 0xffd700, 0.7);
    graphics.strokeRect(
      pixelX - crateSize / 2,
      pixelY - crateSize / 2,
      crateSize,
      crateSize,
    );
  }

  /**
   * Update dropped goods each frame:
   * - Pulse the glow animation
   * - Check expiry and despawn
   * - Check proximity to squads for auto-pickup
   */
  private updateDroppedGoods(
    delta: number,
    allSquads: any[],
    addGoods: (player: number, amount: number) => void,
    getBuilding: (id: string) => any | null,
    gameTime: number,
  ): void {
    // Update pulse animation timer
    this.pulseTimer += delta;

    // Oscillating alpha for the glow (0.4 .. 1.0 range)
    const pulseAlpha = 0.7 + 0.3 * Math.sin(this.pulseTimer / 400);

    for (let i = this.droppedGoods.length - 1; i >= 0; i--) {
      const dropped = this.droppedGoods[i];

      // ── Check expiry ────────────────────────────────────────────────────
      if (gameTime >= dropped.expireTime) {
        dropped.sprite.destroy();
        this.droppedGoods.splice(i, 1);
        continue;
      }

      // ── Redraw with current pulse alpha ─────────────────────────────────
      const pixelX = dropped.tileX * TILE_SIZE + TILE_SIZE / 2;
      const pixelY = dropped.tileY * TILE_SIZE + TILE_SIZE / 2;
      this.drawDroppedGoodsSprite(dropped.sprite, pixelX, pixelY, pulseAlpha);

      // ── Check proximity to squads for auto-pickup ───────────────────────
      for (const squad of allSquads) {
        const dx = squad.tileX - dropped.tileX;
        const dy = squad.tileY - dropped.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= PICKUP_RADIUS_TILES) {
          this.pickUpDroppedGoods(dropped, squad, addGoods, getBuilding);
          dropped.sprite.destroy();
          this.droppedGoods.splice(i, 1);
          break; // This dropped goods has been picked up, move to next
        }
      }
    }
  }

  /**
   * Handle a squad picking up dropped goods.
   * - If the squad can carry goods, add to its cargo
   * - If not (and it's near a friendly building), add directly to player stockpile
   */
  private pickUpDroppedGoods(
    dropped: DroppedGoods,
    squad: any,
    addGoods: (player: number, amount: number) => void,
    _getBuilding: (id: string) => any | null,
  ): void {
    const canCarry = squad.stats?.canCarryGoods ?? false;

    if (canCarry) {
      // Add to the squad's carried goods (up to capacity)
      const capacity = squad.stats.goodsCapacity ?? 0;
      const current = squad.carryingGoods ?? 0;
      const space = capacity - current;
      const pickupAmount = Math.min(space, dropped.amount);

      squad.carryingGoods = current + pickupAmount;

      // If there's leftover that doesn't fit, add directly to player stockpile
      const leftover = dropped.amount - pickupAmount;
      if (leftover > 0) {
        addGoods(squad.owner, leftover);
      }
    } else {
      // Non-carrying unit: add directly to player's stockpile
      addGoods(squad.owner, dropped.amount);
    }

    EventBus.emit(GameEvents.GOODS_PICKED_UP, {
      droppedId: dropped.id,
      squadId: squad.id,
      player: squad.owner,
      amount: dropped.amount,
      tileX: dropped.tileX,
      tileY: dropped.tileY,
    });
  }

  // ─── Building Goods Production ────────────────────────────────────────────

  /**
   * Accumulate goods at production buildings each frame. Goods sit at the
   * building until a truck picks them up — they are NOT added to the player
   * stockpile directly.
   */
  private updateBuildingProduction(delta: number, allBuildings: any[]): void {
    const deltaSeconds = delta / 1000;

    for (const building of allBuildings) {
      // Only process owned buildings with goods production
      if (building.owner < 0) continue;

      const goodsPerMin = building.stats?.goodsPerMin ?? 0;
      if (goodsPerMin <= 0) continue;

      const maxStorage = building.stats?.goodsStorage ?? 0;
      if (maxStorage <= 0) continue; // Can't store goods = can't produce

      // Add goods based on production rate: (goodsPerMin / 60) * deltaSeconds
      const goodsProduced = (goodsPerMin / 60) * deltaSeconds;
      building.goodsStored = Math.min(
        maxStorage,
        (building.goodsStored ?? 0) + goodsProduced,
      );
    }
  }

  // ─── Spatial Helpers ──────────────────────────────────────────────────────

  /**
   * Check if a squad is within arrival distance of a building.
   * Uses the building's center tile for proximity check.
   */
  private isSquadAtBuilding(squad: any, building: any): boolean {
    // Calculate building center tile
    const buildingCenterX =
      building.tileX + (building.stats?.widthTiles ?? 1) / 2;
    const buildingCenterY =
      building.tileY + (building.stats?.heightTiles ?? 1) / 2;

    const dx = squad.tileX - buildingCenterX;
    const dy = squad.tileY - buildingCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Consider the squad "at" the building if within arrival radius
    // and the squad is not actively moving
    return dist <= ARRIVAL_RADIUS_TILES && !squad.isMoving;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /** Destroy all dropped goods sprites. Call on scene shutdown. */
  destroy(): void {
    for (const dropped of this.droppedGoods) {
      dropped.sprite.destroy();
    }
    this.droppedGoods = [];
    this.truckRoutes = [];
  }
}
