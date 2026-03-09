// ─── Economy System ──────────────────────────────────────────────────────────
// Manages resource tracking, income generation from owned buildings, and tier
// advancement research. Each player has independent cash, goods, and influence
// pools. Goods are NOT added directly from production — they must be physically
// transported via the LogisticsSystem.

import Phaser from 'phaser';
import {
  STARTING_CASH,
  STARTING_GOODS,
  STARTING_INFLUENCE,
  BUILDING_MAINTENANCE,
  TICK_RATE,
  TIER_COSTS,
} from '../data/config';
import { EventBus, GameEvents } from '../utils/EventBus';
import { FamilyModifiers, DEFAULT_MODIFIERS } from '../data/families';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PlayerEconomy {
  cash: number;
  goods: number;
  influence: number;
  tier: number; // 1-4
  tierResearchActive: boolean;
  tierResearchProgress: number; // 0 to 1
  tierResearchTarget: number; // target tier (0 if none)
  incomePerMin: number; // calculated each tick
  goodsPerMin: number; // calculated each tick
  influencePerMin: number; // calculated each tick
}

// ─── EconomySystem ───────────────────────────────────────────────────────────

export class EconomySystem {
  public scene: Phaser.Scene;
  public players: PlayerEconomy[];
  public tickTimer: number;
  /** Family modifiers per player index. */
  private playerModifiers: Map<number, FamilyModifiers> = new Map();

  constructor(scene: Phaser.Scene, playerCount: number) {
    this.scene = scene;
    this.tickTimer = 0;

    // Initialize each player with starting resources at tier 1
    this.players = [];
    for (let i = 0; i < playerCount; i++) {
      this.players.push({
        cash: STARTING_CASH,
        goods: STARTING_GOODS,
        influence: STARTING_INFLUENCE,
        tier: 1,
        tierResearchActive: false,
        tierResearchProgress: 0,
        tierResearchTarget: 0,
        incomePerMin: 0,
        goodsPerMin: 0,
        influencePerMin: 0,
      });
    }
  }

  /** Set family modifiers for a specific player. */
  setPlayerModifiers(player: number, modifiers: FamilyModifiers): void {
    this.playerModifiers.set(player, modifiers);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Clean up on scene teardown. Called by GameScene.shutdown(). */
  destroy(): void {
    this.players = [];
  }

  // ─── Main Update ──────────────────────────────────────────────────────────

  /**
   * Called each frame from the game scene.
   *
   * @param delta - Frame delta in milliseconds
   * @param getBuildingsByOwner - Returns all buildings owned by the given player
   * @param getInfluenceMultiplier - Returns the influence multiplier for a
   *   building based on its neighborhood and the player's control there
   * @param getNeighborhoodAt - Returns the neighborhood name for given tile coords
   */
  update(
    delta: number,
    getBuildingsByOwner: (owner: number) => any[],
    getInfluenceMultiplier: (neighborhood: string, player: number) => number,
    getNeighborhoodAt: (x: number, y: number) => string,
  ): void {
    this.tickTimer += delta;

    // Process ALL accumulated ticks (handles lag spikes correctly)
    while (this.tickTimer >= TICK_RATE) {
      this.tickTimer -= TICK_RATE;

      for (let playerIdx = 0; playerIdx < this.players.length; playerIdx++) {
        const economy = this.players[playerIdx];
        const buildings = getBuildingsByOwner(playerIdx);

        // ── Calculate raw income totals for this tick ──────────────────────
        let totalCashPerMin = 0;
        let totalGoodsPerMin = 0;
        let totalInfluencePerMin = 0;

        for (const building of buildings) {
          const stats = building.stats;
          const neighborhood = getNeighborhoodAt(
            building.tileX,
            building.tileY,
          );
          const influenceMultiplier = getInfluenceMultiplier(
            neighborhood,
            playerIdx,
          );

          // Cash income is base rate * influence multiplier for that neighborhood
          totalCashPerMin += stats.cashPerMin * influenceMultiplier;

          // Goods production rate (tracked for UI display, but NOT added here —
          // goods must be physically transported by trucks)
          totalGoodsPerMin += stats.goodsPerMin;

          // Influence income
          totalInfluencePerMin += stats.influencePerMin * influenceMultiplier;
        }

        // ── Apply family income/influence multipliers ──────────────────────
        const mods = this.playerModifiers.get(playerIdx) ?? DEFAULT_MODIFIERS;
        totalCashPerMin *= mods.cashIncomeMultiplier;
        totalInfluencePerMin *= mods.influenceGainMultiplier;

        // ── Subtract building maintenance ─────────────────────────────────
        // BUILDING_MAINTENANCE is $/min per building, convert to per-tick amount
        // TICK_RATE is in ms, so per-tick = (rate / 60) * (TICK_RATE / 1000)
        const maintenanceCostPerTick =
          buildings.length * (BUILDING_MAINTENANCE / 60) * (TICK_RATE / 1000);

        // ── Convert per-minute rates to per-tick amounts ──────────────────
        const tickFraction = TICK_RATE / 1000 / 60; // fraction of a minute per tick
        const cashThisTick =
          totalCashPerMin * tickFraction - maintenanceCostPerTick;
        const influenceThisTick = totalInfluencePerMin * tickFraction;

        // ── Apply resource changes ────────────────────────────────────────
        const prevCash = economy.cash;
        const prevInfluence = economy.influence;

        economy.cash += cashThisTick;
        // Cash can go negative (player is bleeding money from maintenance)
        // but we floor at 0 to avoid confusion — buildings don't auto-abandon
        economy.cash = Math.max(0, economy.cash);

        economy.influence += influenceThisTick;

        // ── Store display rates ───────────────────────────────────────────
        economy.incomePerMin =
          totalCashPerMin - buildings.length * BUILDING_MAINTENANCE;
        economy.goodsPerMin = totalGoodsPerMin;
        economy.influencePerMin = totalInfluencePerMin;

        // ── Emit change events ────────────────────────────────────────────
        if (economy.cash !== prevCash) {
          EventBus.emit(GameEvents.CASH_CHANGED, {
            player: playerIdx,
            cash: economy.cash,
            delta: economy.cash - prevCash,
          });
        }

        if (economy.influence !== prevInfluence) {
          EventBus.emit(GameEvents.INFLUENCE_CHANGED, {
            player: playerIdx,
            influence: economy.influence,
            delta: economy.influence - prevInfluence,
          });
        }

        // ── Advance tier research if active ───────────────────────────────
        if (economy.tierResearchActive) {
          this.advanceTierResearch(playerIdx, TICK_RATE);
        }
      }

      // ── Global tick event ─────────────────────────────────────────────────
      EventBus.emit(GameEvents.INCOME_TICK, {
        players: this.players.map((p, i) => ({
          player: i,
          cash: p.cash,
          goods: p.goods,
          influence: p.influence,
          incomePerMin: p.incomePerMin,
        })),
      });
    }
  }

  // ─── Resource Getters ─────────────────────────────────────────────────────

  getCash(player: number): number {
    return this.players[player].cash;
  }

  getGoods(player: number): number {
    return this.players[player].goods;
  }

  getInfluence(player: number): number {
    return this.players[player].influence;
  }

  getTier(player: number): number {
    return this.players[player].tier;
  }

  /** Current net cash income in $/min (after maintenance). */
  getIncomeRate(player: number): number {
    return this.players[player].incomePerMin;
  }

  /** Current goods production in Goods/min (produced, not necessarily delivered). */
  getGoodsRate(player: number): number {
    return this.players[player].goodsPerMin;
  }

  // ─── Resource Spending ────────────────────────────────────────────────────

  /**
   * Attempt to spend cash. Returns false if the player cannot afford it.
   * Does NOT emit events — the caller should handle UI feedback.
   */
  spendCash(player: number, amount: number): boolean {
    const economy = this.players[player];
    if (economy.cash < amount) return false;

    economy.cash -= amount;
    EventBus.emit(GameEvents.CASH_CHANGED, {
      player,
      cash: economy.cash,
      delta: -amount,
    });
    return true;
  }

  /**
   * Attempt to spend goods. Returns false if the player cannot afford it.
   */
  spendGoods(player: number, amount: number): boolean {
    const economy = this.players[player];
    if (economy.goods < amount) return false;

    economy.goods -= amount;
    EventBus.emit(GameEvents.GOODS_CHANGED, {
      player,
      goods: economy.goods,
      delta: -amount,
    });
    return true;
  }

  /** Add goods to a player's stockpile (called when goods are delivered). */
  addGoods(player: number, amount: number): void {
    const economy = this.players[player];
    economy.goods += amount;
    EventBus.emit(GameEvents.GOODS_CHANGED, {
      player,
      goods: economy.goods,
      delta: amount,
    });
  }

  /** Add cash to a player (bounties, captures, etc.). */
  addCash(player: number, amount: number): void {
    const economy = this.players[player];
    economy.cash += amount;
    EventBus.emit(GameEvents.CASH_CHANGED, {
      player,
      cash: economy.cash,
      delta: amount,
    });
  }

  /** Check if a player can afford both a cash and goods cost. */
  canAfford(player: number, cash: number, goods: number): boolean {
    const economy = this.players[player];
    return economy.cash >= cash && economy.goods >= goods;
  }

  // ─── Tier Research ────────────────────────────────────────────────────────

  /**
   * Begin researching the next tier. Deducts costs immediately.
   * Returns false if can't afford, already researching, or already at tier 4.
   */
  startTierResearch(player: number): boolean {
    const economy = this.players[player];

    // Already at max tier
    if (economy.tier >= 4) return false;

    // Already researching
    if (economy.tierResearchActive) return false;

    const targetTier = economy.tier + 1;
    const costs = TIER_COSTS[targetTier as keyof typeof TIER_COSTS];
    if (!costs) return false;

    // Check affordability (cash, goods, and influence)
    if (economy.cash < costs.cash) return false;
    if (economy.goods < costs.goods) return false;
    if (economy.influence < costs.influence) return false;

    // Deduct all costs
    economy.cash -= costs.cash;
    economy.goods -= costs.goods;
    economy.influence -= costs.influence;

    // Start research
    economy.tierResearchActive = true;
    economy.tierResearchProgress = 0;
    economy.tierResearchTarget = targetTier;

    EventBus.emit(GameEvents.CASH_CHANGED, {
      player,
      cash: economy.cash,
      delta: -costs.cash,
    });
    EventBus.emit(GameEvents.GOODS_CHANGED, {
      player,
      goods: economy.goods,
      delta: -costs.goods,
    });
    EventBus.emit(GameEvents.INFLUENCE_CHANGED, {
      player,
      influence: economy.influence,
      delta: -costs.influence,
    });
    EventBus.emit(GameEvents.TIER_RESEARCH_STARTED, {
      player,
      targetTier,
    });

    return true;
  }

  /** Cancel tier research in progress. Refunds 50% of costs. */
  cancelTierResearch(player: number): void {
    const economy = this.players[player];
    if (!economy.tierResearchActive) return;

    const costs =
      TIER_COSTS[economy.tierResearchTarget as keyof typeof TIER_COSTS];
    if (costs) {
      // Refund 50%
      const cashRefund = Math.floor(costs.cash * 0.5);
      const goodsRefund = Math.floor(costs.goods * 0.5);
      const influenceRefund = Math.floor(costs.influence * 0.5);

      economy.cash += cashRefund;
      economy.goods += goodsRefund;
      economy.influence += influenceRefund;

      EventBus.emit(GameEvents.CASH_CHANGED, {
        player,
        cash: economy.cash,
        delta: cashRefund,
      });
      EventBus.emit(GameEvents.GOODS_CHANGED, {
        player,
        goods: economy.goods,
        delta: goodsRefund,
      });
      EventBus.emit(GameEvents.INFLUENCE_CHANGED, {
        player,
        influence: economy.influence,
        delta: influenceRefund,
      });
    }

    economy.tierResearchActive = false;
    economy.tierResearchProgress = 0;
    economy.tierResearchTarget = 0;
  }

  /** Complete tier research — advance the player's tier. */
  completeTierResearch(player: number): void {
    const economy = this.players[player];
    if (!economy.tierResearchActive) return;

    economy.tier = economy.tierResearchTarget;
    economy.tierResearchActive = false;
    economy.tierResearchProgress = 0;
    economy.tierResearchTarget = 0;

    EventBus.emit(GameEvents.TIER_ADVANCED, {
      player,
      newTier: economy.tier,
    });
  }

  /** Return the full economy state for a player (for UI display). */
  getPlayerEconomy(player: number): PlayerEconomy {
    return { ...this.players[player] };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  /**
   * Advance tier research progress by the given elapsed time.
   * Automatically completes when progress reaches 1.0.
   */
  private advanceTierResearch(player: number, elapsedMs: number): void {
    const economy = this.players[player];
    if (!economy.tierResearchActive) return;

    const costs =
      TIER_COSTS[economy.tierResearchTarget as keyof typeof TIER_COSTS];
    if (!costs) return;

    // Progress is 0..1 based on costs.time (total research time in ms)
    const progressIncrement = elapsedMs / costs.time;
    economy.tierResearchProgress = Math.min(
      1.0,
      economy.tierResearchProgress + progressIncrement,
    );

    if (economy.tierResearchProgress >= 1.0) {
      this.completeTierResearch(player);
    }
  }
}
