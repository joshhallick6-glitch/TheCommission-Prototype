// ─── Squad Entity ────────────────────────────────────────────────────────────
// The atomic selectable/commandable unit in the game.
// Each squad has a sprite, health bar, selection circle, and pathfinding logic.

import Phaser from 'phaser';
import { TILE_SIZE, TILE_WIDTH, TILE_HEIGHT, PLAYER_COLORS } from '../data/config';
import { UnitType, UnitStats, UNIT_DEFS } from '../data/units';
import { pathfinding } from '../utils/Pathfinding';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld, isoDepth } from '../utils/IsometricUtils';

let squadCounter = 0;

/** Callback set by UnitSystem so squads can scan for nearby enemies during attack-move. */
export type EnemyScanCallback = (squad: Squad, range: number) => Squad[];
let enemyScanFn: EnemyScanCallback | null = null;

export function setEnemyScanCallback(fn: EnemyScanCallback): void {
  enemyScanFn = fn;
}

export class Squad {
  public id: string;
  public owner: number;
  public stats: UnitStats;
  public members: number;
  public hp: number;
  public maxHp: number;
  public tileX: number;
  public tileY: number;
  public targetTileX: number;
  public targetTileY: number;
  public path: { x: number; y: number }[];
  public pathIndex: number;
  public isMoving: boolean;
  public isSelected: boolean;
  public attackTarget: Squad | null;
  public state: 'idle' | 'moving' | 'attacking' | 'retreating' | 'capturing' | 'garrisoned';
  public veterancy: number;
  public carryingGoods: number;
  public commandQueue: { type: 'move' | 'attack' | 'attackMove'; target: { x: number; y: number }; attackTarget?: Squad | null }[] = [];
  public isAttackMoving: boolean = false;
  private isDestroyed: boolean = false;
  public sprite: Phaser.GameObjects.Sprite;
  public healthBar: Phaser.GameObjects.Graphics;
  public selectionCircle: Phaser.GameObjects.Graphics;

  private scene: Phaser.Scene;
  // Sub-tile interpolation: the pixel position we're smoothly moving toward
  private pixelPosX: number;
  private pixelPosY: number;

  constructor(
    scene: Phaser.Scene,
    type: UnitType,
    owner: number,
    tileX: number,
    tileY: number,
  ) {
    this.scene = scene;
    this.owner = owner;
    this.stats = { ...UNIT_DEFS[type] };
    this.id = `squad_${owner}_${squadCounter++}`;

    // Position
    this.tileX = tileX;
    this.tileY = tileY;
    this.targetTileX = tileX;
    this.targetTileY = tileY;
    this.pixelPosX = this.getPixelX();
    this.pixelPosY = this.getPixelY();

    // State
    this.members = this.stats.squadSize;
    this.maxHp = this.stats.squadSize * this.stats.hpPerMember;
    this.hp = this.maxHp;
    this.path = [];
    this.pathIndex = 0;
    this.isMoving = false;
    this.isSelected = false;
    this.attackTarget = null;
    this.state = 'idle';
    this.veterancy = 0;
    this.carryingGoods = 0;

    // --- Visual setup ---

    // Determine texture key: BootScene generates 'unit-{type}' for all unit types
    // (vehicles use the same 'unit-' prefix since BootScene.generateVehicleSprite
    // uses `unit-${type}` regardless of isVehicle)
    const textureKey = `unit-${type}`;

    const px = this.getPixelX();
    const py = this.getPixelY();

    // Create sprite, falling back to a generated circle if the texture doesn't exist
    if (scene.textures.exists(textureKey)) {
      this.sprite = scene.add.sprite(px, py, textureKey);
    } else {
      // Generate a fallback texture: colored circle for infantry, rectangle for vehicles
      const fallbackKey = `${textureKey}-fallback`;
      if (!scene.textures.exists(fallbackKey)) {
        const gfx = scene.add.graphics();
        if (this.stats.isVehicle) {
          gfx.fillStyle(this.stats.color, 1);
          gfx.fillRect(4, 6, 24, 14);
        } else {
          gfx.fillStyle(this.stats.color, 1);
          gfx.fillEllipse(16, 14, 12, 8);
          gfx.fillCircle(16, 8, 5);
        }
        gfx.generateTexture(fallbackKey, 32, 24);
        gfx.destroy();
      }
      this.sprite = scene.add.sprite(px, py, fallbackKey);
    }

    // Tint by owner color
    const ownerColor = PLAYER_COLORS[owner as keyof typeof PLAYER_COLORS];
    if (ownerColor !== undefined) {
      this.sprite.setTint(ownerColor);
    }

    // Isometric depth sorting — units further from camera render in front
    this.sprite.setDepth(isoDepth(tileX, tileY, 1));

    // Selection circle (hidden by default)
    this.selectionCircle = scene.add.graphics();
    this.selectionCircle.setDepth(9);
    this.selectionCircle.setVisible(false);
    this.drawSelectionCircle();

    // Health bar (positioned above sprite)
    this.healthBar = scene.add.graphics();
    this.healthBar.setDepth(11);
    this.drawHealthBar();
  }

  // ─── Selection ──────────────────────────────────────────────────────────────

  select(): void {
    this.isSelected = true;
    this.selectionCircle.setVisible(true);
    EventBus.emit(GameEvents.UNIT_SELECTED, this);
  }

  deselect(): void {
    this.isSelected = false;
    this.selectionCircle.setVisible(false);
    EventBus.emit(GameEvents.UNIT_DESELECTED, this);
  }

  // ─── Movement ───────────────────────────────────────────────────────────────

  moveTo(tileX: number, tileY: number): void {
    this.targetTileX = tileX;
    this.targetTileY = tileY;

    pathfinding
      .findPath(this.tileX, this.tileY, tileX, tileY, this.stats.isVehicle)
      .then((foundPath) => {
        if (foundPath.length > 0) {
          // Skip the first node (current position)
          this.path = foundPath;
          this.pathIndex = 1;
          this.isMoving = true;
          this.state = 'moving';
          this.attackTarget = null;
        }
      });
  }

  /** Move toward a destination, but engage any enemies encountered along the way. */
  attackMoveTo(tileX: number, tileY: number): void {
    this.isAttackMoving = true;
    this.moveTo(tileX, tileY);
  }

  /** Add a command to the back of the queue (for shift-click waypoints). */
  queueCommand(cmd: { type: 'move' | 'attack' | 'attackMove'; target: { x: number; y: number }; attackTarget?: Squad | null }): void {
    this.commandQueue.push(cmd);
  }

  /** Pop and execute the next queued command. */
  private executeNextCommand(): void {
    if (this.commandQueue.length === 0) return;
    const cmd = this.commandQueue.shift()!;
    if (cmd.type === 'move') {
      this.moveTo(cmd.target.x, cmd.target.y);
    } else if (cmd.type === 'attackMove') {
      this.attackMoveTo(cmd.target.x, cmd.target.y);
    } else if (cmd.type === 'attack' && cmd.attackTarget && cmd.attackTarget.hp > 0) {
      this.attackTarget = cmd.attackTarget;
      this.state = 'attacking';
      if (!this.isInRange(cmd.attackTarget)) {
        this.moveTo(cmd.attackTarget.tileX, cmd.attackTarget.tileY);
      }
    }
  }

  // ─── Main Update ────────────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.isDestroyed) return;

    const dt = delta / 1000; // convert ms to seconds

    if (this.isMoving && this.path.length > 0) {
      this.updateMovement(dt);
    }

    // Attack-move scan: while moving toward the destination, check for nearby enemies
    if (this.isAttackMoving && this.isMoving && this.state === 'moving' && enemyScanFn) {
      const enemies = enemyScanFn(this, this.stats.sightRange);
      if (enemies.length > 0) {
        // Engage the closest enemy
        let closest = enemies[0];
        let closestDist = this.distanceTo(closest);
        for (let i = 1; i < enemies.length; i++) {
          const d = this.distanceTo(enemies[i]);
          if (d < closestDist) {
            closestDist = d;
            closest = enemies[i];
          }
        }
        this.isMoving = false;
        this.attackTarget = closest;
        this.state = 'attacking';
      }
    }

    if (this.state === 'attacking' && this.attackTarget) {
      this.updateCombat(dt);
    }

    // Sync visuals to current interpolated position
    this.sprite.setPosition(this.pixelPosX, this.pixelPosY);
    this.sprite.setDepth(isoDepth(this.tileX, this.tileY, 1));
    this.drawHealthBar();
    this.updateSelectionCirclePosition();
  }

  private updateMovement(dt: number): void {
    if (this.pathIndex >= this.path.length) {
      // Reached end of path
      this.isMoving = false;
      this.isAttackMoving = false;
      this.state = 'idle';
      this.path = [];
      this.pathIndex = 0;
      // Snap to final tile center
      this.pixelPosX = this.getPixelX();
      this.pixelPosY = this.getPixelY();

      // Execute next queued command if any
      this.executeNextCommand();
      return;
    }

    const target = this.path[this.pathIndex];
    const targetWorld = tileToWorld(target.x, target.y);
    const targetPx = targetWorld.x;
    const targetPy = targetWorld.y;

    const dx = targetPx - this.pixelPosX;
    const dy = targetPy - this.pixelPosY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const speed = this.stats.speed * TILE_WIDTH; // pixels per second (using iso tile width)
    const moveAmount = speed * dt;

    if (dist <= moveAmount) {
      // Arrived at this path node
      this.pixelPosX = targetPx;
      this.pixelPosY = targetPy;
      this.tileX = target.x;
      this.tileY = target.y;
      this.pathIndex++;
    } else {
      // Interpolate toward the next node
      const nx = dx / dist;
      const ny = dy / dist;
      this.pixelPosX += nx * moveAmount;
      this.pixelPosY += ny * moveAmount;
    }
  }

  private updateCombat(dt: number): void {
    if (!this.attackTarget || this.attackTarget.hp <= 0) {
      this.attackTarget = null;

      // If attack-moving, resume movement toward the original destination
      if (this.isAttackMoving) {
        this.state = 'moving';
        if (this.path.length > 0) {
          this.isMoving = true;
        } else {
          // Original path was consumed or never set; re-path to the destination
          this.isAttackMoving = false;
          this.state = 'idle';
          this.executeNextCommand();
        }
        return;
      }

      this.state = 'idle';
      return;
    }

    if (this.isInRange(this.attackTarget)) {
      // Deal damage: total squad DPS * delta
      const totalDps = this.members * this.stats.dpsPerMember;
      const veterancyMultiplier = 1 + this.veterancy * 0.1;
      const damage = totalDps * veterancyMultiplier * dt;
      this.attackTarget.takeDamage(damage);
    } else {
      // Move toward target if out of range
      this.moveTo(this.attackTarget.tileX, this.attackTarget.tileY);
    }
  }

  // ─── Stop ─────────────────────────────────────────────────────────────────────

  /** Clear all movement and attack orders, return to idle. */
  stop(): void {
    this.isMoving = false;
    this.isAttackMoving = false;
    this.path = [];
    this.pathIndex = 0;
    this.attackTarget = null;
    this.commandQueue = [];
    this.state = 'idle';
  }

  // ─── Damage & Death ─────────────────────────────────────────────────────────

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);

    // Recalculate living members based on remaining HP
    const hpPerMember = this.stats.hpPerMember;
    this.members = Math.max(0, Math.ceil(this.hp / hpPerMember));

    EventBus.emit(GameEvents.UNIT_DAMAGED, this, amount);

    if (this.hp <= 0) {
      this.die();
    }
  }

  die(): void {
    if (this.isDestroyed) return;

    EventBus.emit(GameEvents.SQUAD_WIPED, this);

    // Hide health bar and selection circle immediately
    this.healthBar.setVisible(false);
    this.selectionCircle.setVisible(false);

    // Death effect: expanding ring that fades
    const deathEffect = this.scene.add.graphics();
    deathEffect.setDepth(15);
    const ringRadius = this.stats.isVehicle ? 20 : 12;
    deathEffect.lineStyle(2, this.stats.isVehicle ? 0xFF4400 : 0xFF0000, 1);
    deathEffect.strokeCircle(this.pixelPosX, this.pixelPosY, ringRadius);

    this.scene.tweens.add({
      targets: deathEffect,
      alpha: 0,
      scaleX: 2,
      scaleY: 2,
      duration: 500,
      onComplete: () => deathEffect.destroy(),
    });

    // Flash sprite red then fade out, destroy when complete
    this.sprite.setTint(0xFF0000);
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      duration: 400,
      onComplete: () => this.destroy(),
    });
  }

  // ─── Utility ────────────────────────────────────────────────────────────────

  getPixelX(): number {
    const pos = tileToWorld(this.tileX, this.tileY);
    return pos.x;
  }

  getPixelY(): number {
    const pos = tileToWorld(this.tileX, this.tileY);
    return pos.y;
  }

  distanceTo(other: Squad): number {
    const dx = this.tileX - other.tileX;
    const dy = this.tileY - other.tileY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  isInRange(other: Squad): boolean {
    return this.distanceTo(other) <= this.stats.range;
  }

  // ─── Visual Drawing ─────────────────────────────────────────────────────────

  drawHealthBar(): void {
    this.healthBar.clear();

    const barWidth = TILE_WIDTH * 0.6;
    const barHeight = 3;
    const barX = this.pixelPosX - barWidth / 2;
    const barY = this.pixelPosY - TILE_HEIGHT * 0.8 - barHeight;
    const healthPercent = this.hp / this.maxHp;

    // Background (dark)
    this.healthBar.fillStyle(0x333333, 0.8);
    this.healthBar.fillRect(barX, barY, barWidth, barHeight);

    // Fill (green -> yellow -> red based on health)
    let color = 0x00cc00;
    if (healthPercent < 0.3) {
      color = 0xcc0000;
    } else if (healthPercent < 0.6) {
      color = 0xcccc00;
    }
    this.healthBar.fillStyle(color, 1);
    this.healthBar.fillRect(barX, barY, barWidth * healthPercent, barHeight);
  }

  private drawSelectionCircle(): void {
    this.selectionCircle.clear();
    this.selectionCircle.lineStyle(2, 0x00ff00, 0.8);
    // Isometric ellipse: wider than tall to match diamond tile perspective
    this.selectionCircle.strokeEllipse(this.pixelPosX, this.pixelPosY, TILE_WIDTH * 0.6, TILE_HEIGHT * 0.6);
  }

  private updateSelectionCirclePosition(): void {
    if (!this.isSelected) return;
    this.selectionCircle.clear();
    this.selectionCircle.lineStyle(2, 0x00ff00, 0.8);
    this.selectionCircle.strokeEllipse(this.pixelPosX, this.pixelPosY, TILE_WIDTH * 0.6, TILE_HEIGHT * 0.6);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sprite.destroy();
    this.healthBar.destroy();
    this.selectionCircle.destroy();
  }
}
