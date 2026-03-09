// ─── Combat System ──────────────────────────────────────────────────────────
// Tick-based combat resolution for all engaged squads.
// Every COMBAT_TICK_MS (500ms) it resolves damage for all registered
// attacker/target pairs, applying cover, garrison, flank, veterancy, and
// retreat modifiers.

import Phaser from 'phaser';
import {
  TILE_SIZE,
  TerrainType,
  COVER_DAMAGE_REDUCTION,
  GARRISON_DAMAGE_REDUCTION,
  FLANK_DAMAGE_BONUS,
  RETREAT_DPS_MULTIPLIER,
  VETERANCY_BONUS,
} from '../data/config';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld } from '../utils/IsometricUtils';

export class CombatSystem {
  scene: Phaser.Scene;
  combatTimer: number = 0;
  combatPairs: Map<string, string> = new Map(); // attackerID -> targetID
  readonly COMBAT_TICK_MS: number = 500;

  /** Live squad references, keyed by squad id. Set externally by the game scene. */
  private squadLookup: Map<string, any> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Provide the system with a live reference map so it can resolve squad IDs
   * to actual objects each tick. The game scene should call this once (or
   * whenever the roster changes) with the same Map it already maintains.
   */
  setSquadLookup(lookup: Map<string, any>): void {
    this.squadLookup = lookup;
  }

  /** Main update -- accumulate delta and resolve ticks. */
  update(delta: number): void {
    this.combatTimer += delta;

    while (this.combatTimer >= this.COMBAT_TICK_MS) {
      this.combatTimer -= this.COMBAT_TICK_MS;
      this.resolveCombatTick();
    }
  }

  /**
   * Register a combat pair so the attacker fires on the target each tick.
   * If the attacker was already engaged with a different target, the old
   * pairing is replaced.
   */
  engageTarget(attackerSquad: any, targetSquad: any): void {
    this.combatPairs.set(attackerSquad.id, targetSquad.id);

    // Keep lookup up to date with any new squads we see
    if (!this.squadLookup.has(attackerSquad.id)) {
      this.squadLookup.set(attackerSquad.id, attackerSquad);
    }
    if (!this.squadLookup.has(targetSquad.id)) {
      this.squadLookup.set(targetSquad.id, targetSquad);
    }

    EventBus.emit(GameEvents.COMBAT_STARTED, attackerSquad.id, targetSquad.id);
  }

  /** Remove every combat pair that references this squad (as attacker or target). */
  disengageAll(squadId: string): void {
    // Remove as attacker
    this.combatPairs.delete(squadId);

    // Remove any pairs targeting this squad
    for (const [attackerId, targetId] of this.combatPairs) {
      if (targetId === squadId) {
        this.combatPairs.delete(attackerId);
      }
    }
  }

  // ── Combat Resolution ───────────────────────────────────────────────────────

  /** Resolve one combat tick for every registered pair. */
  resolveCombatTick(): void {
    // Snapshot the pairs so we can safely mutate during iteration
    const pairs = Array.from(this.combatPairs.entries());

    for (const [attackerId, targetId] of pairs) {
      const attacker = this.squadLookup.get(attackerId);
      const target = this.squadLookup.get(targetId);

      // ── Guard: both squads must still be alive ───────────────────────
      if (!attacker || !target) {
        this.combatPairs.delete(attackerId);
        continue;
      }
      if (
        (attacker.members !== undefined && attacker.members <= 0) ||
        (attacker.hp !== undefined && attacker.hp <= 0)
      ) {
        this.combatPairs.delete(attackerId);
        continue;
      }
      if (
        (target.members !== undefined && target.members <= 0) ||
        (target.hp !== undefined && target.hp <= 0)
      ) {
        this.combatPairs.delete(attackerId);
        continue;
      }

      // ── Range check ──────────────────────────────────────────────────
      if (!this.isInRange(attacker, target)) {
        continue; // out of range this tick -- keep the pair for when they close
      }

      // ── Determine terrain at target position ─────────────────────────
      const terrainAtTarget = this.getTerrainAt(target.tileX, target.tileY);

      // ── Calculate and apply damage ───────────────────────────────────
      const finalDamage = this.calculateDamage(attacker, target, terrainAtTarget);

      if (finalDamage > 0) {
        // Apply damage via squad API if available, otherwise reduce hp directly
        if (typeof target.takeDamage === 'function') {
          target.takeDamage(finalDamage);
        } else if (target.hp !== undefined) {
          target.hp = Math.max(0, target.hp - finalDamage);
        }

        // Visual effects
        const fromPos = tileToWorld(attacker.tileX, attacker.tileY);
        const fromX = fromPos.x;
        const fromY = fromPos.y;
        const toPos = tileToWorld(target.tileX, target.tileY);
        const toX = toPos.x;
        const toY = toPos.y;

        this.createCombatEffect(this.scene, fromX, fromY, toX, toY);
        this.flashTarget(target);

        EventBus.emit(
          GameEvents.UNIT_DAMAGED,
          target.id,
          finalDamage,
          attacker.id,
        );

        // ── Check for squad wipe ─────────────────────────────────────
        const targetDead =
          (target.hp !== undefined && target.hp <= 0) ||
          (target.members !== undefined && target.members <= 0);

        if (targetDead) {
          this.awardVeterancy(attacker);
          this.disengageAll(targetId);

          // Squad.die() already emits SQUAD_WIPED — only emit UNIT_KILLED here
          EventBus.emit(GameEvents.UNIT_KILLED, targetId, attackerId);

          // Small screen-shake for nearby wipes
          this.shakeIfNearCamera(toX, toY);
        }
      }
    }
  }

  /**
   * Pure damage calculation. Takes the TerrainType at the target's position
   * and returns the final damage value after all modifiers.
   */
  calculateDamage(attacker: any, target: any, terrainAtTarget: number): number {
    if (!attacker.stats || attacker.members === undefined) return 0;

    const memberCount =
      attacker.members > 0 ? attacker.members : 1;

    // Raw damage for one tick
    let damage =
      attacker.stats.dpsPerMember * memberCount * (this.COMBAT_TICK_MS / 1000);

    // ── Attacker modifiers ─────────────────────────────────────────────

    // Veterancy bonus (attacker)
    const vetLevel = attacker.veterancy ?? 0;
    if (vetLevel > 0) {
      damage *= 1 + VETERANCY_BONUS * vetLevel;
    }

    // Retreating penalty (attacker)
    if (attacker.state === 'retreating') {
      damage *= RETREAT_DPS_MULTIPLIER;
    }

    // Flanking bonus
    if (this.isFlanking(attacker, target)) {
      damage *= 1 + FLANK_DAMAGE_BONUS;
    }

    // ── Target modifiers (damage reduction) ────────────────────────────

    // Garrison
    if (target.state === 'garrisoned') {
      damage *= 1 - GARRISON_DAMAGE_REDUCTION;
    }

    // Cover: target on a COVER_OBJECT tile, or on a SIDEWALK adjacent to a WALL
    if (this.hasCover(terrainAtTarget, target.tileX, target.tileY)) {
      damage *= 1 - COVER_DAMAGE_REDUCTION;
    }

    return Math.max(0, damage);
  }

  // ── Range & Distance ────────────────────────────────────────────────────────

  /** Euclidean distance in tiles between two points. */
  distanceBetween(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Check whether the target is within the attacker's weapon range (in tiles). */
  isInRange(attacker: any, target: any): boolean {
    const dist = this.distanceBetween(
      attacker.tileX,
      attacker.tileY,
      target.tileX,
      target.tileY,
    );
    return dist <= (attacker.stats?.range ?? 0);
  }

  // ── Visual Effects ──────────────────────────────────────────────────────────

  /**
   * Draw a brief bullet tracer line from attacker to target and a small
   * muzzle flash at the attacker's position. All visuals auto-destroy.
   */
  createCombatEffect(
    scene: Phaser.Scene,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void {
    // ── Bullet tracer (line that fades out in 100ms) ───────────────────
    const line = scene.add.line(
      0,
      0,
      fromX,
      fromY,
      toX,
      toY,
      0xffee00,
      0.8,
    );
    line.setOrigin(0, 0);
    line.setLineWidth(1);
    line.setDepth(100);

    scene.tweens.add({
      targets: line,
      alpha: 0,
      duration: 100,
      onComplete: () => line.destroy(),
    });

    // ── Muzzle flash (small sprite at attacker position) ───────────────
    // Use a generated texture if available, otherwise a tiny graphics flash
    if (scene.textures.exists('fx-muzzle-flash')) {
      const flash = scene.add.image(fromX, fromY, 'fx-muzzle-flash');
      flash.setDepth(101);
      flash.setScale(1.2);
      scene.tweens.add({
        targets: flash,
        alpha: 0,
        scaleX: 2,
        scaleY: 2,
        duration: 80,
        onComplete: () => flash.destroy(),
      });
    } else {
      // Fallback: tiny yellow circle
      const gfx = scene.add.graphics();
      gfx.setDepth(101);
      gfx.fillStyle(0xff8800, 0.9);
      gfx.fillCircle(fromX, fromY, 3);
      scene.tweens.add({
        targets: gfx,
        alpha: 0,
        duration: 80,
        onComplete: () => gfx.destroy(),
      });
    }
  }

  // ── Veterancy ───────────────────────────────────────────────────────────────

  /** Increment squad veterancy (max 3). Each level gives +10% combat stats. */
  awardVeterancy(squad: any): void {
    if (squad.veterancy === undefined) {
      squad.veterancy = 0;
    }
    if (squad.veterancy < 3) {
      squad.veterancy += 1;
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Determine the TerrainType at a tile coordinate. Reads from the scene's
   * tilemap if one is available; otherwise defaults to ROAD.
   */
  private getTerrainAt(tileX: number, tileY: number): number {
    const tilemap = (this.scene as any).tilemap as Phaser.Tilemaps.Tilemap | undefined;
    if (tilemap) {
      const tile = tilemap.getTileAt(tileX, tileY);
      if (tile) {
        return tile.index;
      }
    }
    return TerrainType.ROAD;
  }

  /**
   * Check if the target has cover at its current position.
   * Cover is granted when:
   *  - The tile is a COVER_OBJECT, or
   *  - The tile is SIDEWALK and at least one adjacent tile is a WALL
   */
  private hasCover(terrainAtTarget: number, tileX: number, tileY: number): boolean {
    if (terrainAtTarget === TerrainType.COVER_OBJECT) {
      return true;
    }

    if (terrainAtTarget === TerrainType.SIDEWALK) {
      // Check the four cardinal neighbours for a WALL
      const neighbours = [
        { x: tileX - 1, y: tileY },
        { x: tileX + 1, y: tileY },
        { x: tileX, y: tileY - 1 },
        { x: tileX, y: tileY + 1 },
      ];
      for (const n of neighbours) {
        if (this.getTerrainAt(n.x, n.y) === TerrainType.WALL) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Flanking heuristic: the attacker is considered to be flanking if it
   * approaches from behind the target. We approximate "behind" by checking
   * whether the angle from the target's facing direction to the attacker's
   * position is greater than 90 degrees (i.e., behind the target's forward
   * half-plane).
   *
   * If the target has a `facingAngle` property (radians), we use it.
   * Otherwise we use the angle from the target toward its own attackTarget
   * as a proxy for its facing direction.
   */
  private isFlanking(attacker: any, target: any): boolean {
    // Determine target's facing direction
    let facingAngle: number;

    if (target.facingAngle !== undefined) {
      facingAngle = target.facingAngle;
    } else if (target.attackTarget) {
      // Target is looking at its own attack target
      const atkTarget = this.squadLookup.get(target.attackTarget) ?? target.attackTarget;
      if (atkTarget && atkTarget.tileX !== undefined) {
        facingAngle = Math.atan2(
          atkTarget.tileY - target.tileY,
          atkTarget.tileX - target.tileX,
        );
      } else {
        return false; // Can't determine facing
      }
    } else {
      return false; // No facing info
    }

    // Angle from target to the attacker
    const angleToAttacker = Math.atan2(
      attacker.tileY - target.tileY,
      attacker.tileX - target.tileX,
    );

    // Difference between facing and angle-to-attacker
    let diff = angleToAttacker - facingAngle;
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    // If the absolute difference is greater than 90 degrees, attacker is behind
    return Math.abs(diff) > Math.PI / 2;
  }

  /** Flash the target sprite red briefly on hit for visual feedback. */
  private flashTarget(target: any): void {
    const sprite: Phaser.GameObjects.Sprite | undefined =
      target.sprite ?? target.gameObject;
    if (!sprite || typeof sprite.setTint !== 'function') return;

    sprite.setTint(0xff0000);
    this.scene.time.delayedCall(80, () => {
      if (sprite && !sprite.scene) return; // destroyed check
      sprite.clearTint();
    });
  }

  /** Apply a small camera shake if the world position is near the viewport. */
  private shakeIfNearCamera(worldX: number, worldY: number): void {
    const cam = this.scene.cameras.main;
    if (!cam) return;

    // Check if the position is within (or close to) the viewport
    const bounds = cam.worldView;
    const margin = 64;
    if (
      worldX >= bounds.x - margin &&
      worldX <= bounds.right + margin &&
      worldY >= bounds.y - margin &&
      worldY <= bounds.bottom + margin
    ) {
      cam.shake(120, 0.005);
    }
  }
}
