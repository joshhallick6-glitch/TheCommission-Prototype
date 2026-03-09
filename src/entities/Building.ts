// ─── Building Entity ─────────────────────────────────────────────────────────
// Capturable property on the map. Provides income, garrison, and goods storage
// depending on type. Ownership is indicated by a colored border.

import Phaser from 'phaser';
import { TILE_SIZE, CAPTURE_TIME_BASE, CAPTURE_TIME_ENEMY, PLAYER_COLORS } from '../data/config';
import { BuildingType, BuildingStats, BUILDING_DEFS } from '../data/buildings';
import { EventBus, GameEvents } from '../utils/EventBus';

export class Building {
  // ─── Identity ────────────────────────────────────────────────────────────────
  readonly id: string;
  readonly type: BuildingType;
  readonly stats: BuildingStats;

  // ─── State ───────────────────────────────────────────────────────────────────
  owner: number; // -1 = neutral, 0 = P1, 1 = P2
  hp: number;
  maxHp: number;
  tileX: number;
  tileY: number;

  // ─── Capture ─────────────────────────────────────────────────────────────────
  isBeingCaptured: boolean = false;
  captureProgress: number = 0; // 0..1
  capturingPlayer: number = -1;

  // ─── Garrison & Storage ──────────────────────────────────────────────────────
  garrisonedSquads: string[] = [];
  goodsStored: number = 0;

  // ─── Visuals ─────────────────────────────────────────────────────────────────
  sprite: Phaser.GameObjects.Rectangle;
  borderGraphics: Phaser.GameObjects.Graphics;
  captureBar: Phaser.GameObjects.Graphics;
  healthBar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  selected: boolean = false;

  private scene: Phaser.Scene;
  private pixelX: number;
  private pixelY: number;
  private pixelW: number;
  private pixelH: number;

  constructor(
    scene: Phaser.Scene,
    type: BuildingType,
    owner: number,
    tileX: number,
    tileY: number,
  ) {
    this.scene = scene;
    this.type = type;
    this.stats = BUILDING_DEFS[type];
    this.owner = owner;
    this.tileX = tileX;
    this.tileY = tileY;

    this.id = `building_${type}_${tileX}_${tileY}`;
    this.hp = this.stats.hp;
    this.maxHp = this.stats.hp;

    // Pixel geometry (top-left origin)
    this.pixelX = tileX * TILE_SIZE;
    this.pixelY = tileY * TILE_SIZE;
    this.pixelW = this.stats.widthTiles * TILE_SIZE;
    this.pixelH = this.stats.heightTiles * TILE_SIZE;

    // ── Main rectangle ─────────────────────────────────────────────────────────
    // Phaser rectangles are centered by default, so offset by half-size
    this.sprite = scene.add.rectangle(
      this.pixelX + this.pixelW / 2,
      this.pixelY + this.pixelH / 2,
      this.pixelW,
      this.pixelH,
      this.stats.color,
      0.8,
    );
    this.sprite.setDepth(1);

    // ── Owner border ───────────────────────────────────────────────────────────
    this.borderGraphics = scene.add.graphics();
    this.borderGraphics.setDepth(5);
    this.updateBorder();

    // ── Label (first letter of building name) ──────────────────────────────────
    this.label = scene.add.text(
      this.pixelX + this.pixelW / 2,
      this.pixelY + this.pixelH / 2,
      this.stats.name.charAt(0),
      {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2,
      },
    );
    this.label.setOrigin(0.5, 0.5);
    this.label.setDepth(5);

    // ── Health bar (hidden when full) ──────────────────────────────────────────
    this.healthBar = scene.add.graphics();
    this.healthBar.setDepth(5);
    this.healthBar.setVisible(false);

    // ── Capture progress bar (hidden when not capturing) ───────────────────────
    this.captureBar = scene.add.graphics();
    this.captureBar.setDepth(5);
    this.captureBar.setVisible(false);
  }

  // ─── Capture ─────────────────────────────────────────────────────────────────

  /** Begin a capture attempt by the given player. */
  startCapture(playerIndex: number): void {
    // If already being captured by the same player, do nothing
    if (this.isBeingCaptured && this.capturingPlayer === playerIndex) return;

    this.isBeingCaptured = true;
    this.captureProgress = 0;
    this.capturingPlayer = playerIndex;
    this.captureBar.setVisible(true);

    EventBus.emit(GameEvents.CAPTURE_STARTED, {
      buildingId: this.id,
      playerIndex,
    });
  }

  /**
   * Advance capture progress.
   * @param delta Frame delta in milliseconds
   * @param squadCount Number of squads near the building (min 1). Each
   *   additional squad above 1 adds 25% speed, capped at 2x total.
   */
  updateCapture(delta: number, squadCount: number = 1): void {
    if (!this.isBeingCaptured) return;

    // Base capture time depends on whether the building is neutral or enemy
    const baseTime =
      this.owner === -1 ? CAPTURE_TIME_BASE : CAPTURE_TIME_ENEMY;

    // Rate: 1.0 / baseTime per ms, multiplied by squad bonus
    // Each extra squad adds 25%, max 2x (so max effective squads = 5)
    const speedMultiplier = Math.min(
      2.0,
      1.0 + (Math.max(1, squadCount) - 1) * 0.25,
    );
    const rate = (1.0 / baseTime) * speedMultiplier;

    this.captureProgress = Math.min(1.0, this.captureProgress + rate * delta);
    this.drawCaptureBar();

    EventBus.emit(GameEvents.CAPTURE_PROGRESS, {
      buildingId: this.id,
      progress: this.captureProgress,
      playerIndex: this.capturingPlayer,
    });

    if (this.captureProgress >= 1.0) {
      this.completeCapture();
    }
  }

  /** Finalize capture: transfer ownership, reset state. */
  completeCapture(): void {
    const previousOwner = this.owner;
    this.owner = this.capturingPlayer;

    // Reset capture state
    this.isBeingCaptured = false;
    this.captureProgress = 0;
    this.capturingPlayer = -1;
    this.captureBar.setVisible(false);

    // Update visuals
    this.updateBorder();

    EventBus.emit(GameEvents.BUILDING_CAPTURED, {
      buildingId: this.id,
      newOwner: this.owner,
      previousOwner,
      type: this.type,
    });
  }

  /** Cancel an in-progress capture. */
  cancelCapture(): void {
    this.isBeingCaptured = false;
    this.captureProgress = 0;
    this.capturingPlayer = -1;
    this.captureBar.setVisible(false);
    this.drawCaptureBar();
  }

  // ─── Damage & Repair ─────────────────────────────────────────────────────────

  /** Apply damage to the building. Destroys it if HP reaches zero. */
  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.drawHealthBar();

    EventBus.emit(GameEvents.BUILDING_DAMAGED, {
      buildingId: this.id,
      hp: this.hp,
      maxHp: this.maxHp,
    });

    if (this.hp <= 0) {
      this.destroy();
    }
  }

  /** Repair the building up to its maximum HP. */
  repair(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.drawHealthBar();
  }

  // ─── Garrison ────────────────────────────────────────────────────────────────

  /** Garrison a squad. Returns true if successful, false if no room. */
  garrison(squadId: string): boolean {
    if (!this.stats.canGarrison) return false;
    if (this.garrisonedSquads.length >= this.stats.garrisonSlots) return false;
    if (this.garrisonedSquads.includes(squadId)) return false;

    this.garrisonedSquads.push(squadId);
    return true;
  }

  /** Remove a squad from the garrison. */
  ungarrison(squadId: string): void {
    const idx = this.garrisonedSquads.indexOf(squadId);
    if (idx !== -1) {
      this.garrisonedSquads.splice(idx, 1);
    }
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  /** Mark building as selected and highlight the border. */
  select(): void {
    this.selected = true;
    this.updateBorder();
  }

  /** Remove selection highlight. */
  deselect(): void {
    this.selected = false;
    this.updateBorder();
  }

  // ─── Update Loop ─────────────────────────────────────────────────────────────

  /** Called each frame. Advances capture and refreshes visuals as needed. */
  update(delta: number): void {
    if (this.isBeingCaptured) {
      this.updateCapture(delta);
    }
  }

  // ─── Drawing Helpers ─────────────────────────────────────────────────────────

  /** Draw the health bar above the building. Only visible when damaged. */
  drawHealthBar(): void {
    this.healthBar.clear();

    if (this.hp >= this.maxHp) {
      this.healthBar.setVisible(false);
      return;
    }

    this.healthBar.setVisible(true);

    const barWidth = this.pixelW;
    const barHeight = 4;
    const barX = this.pixelX;
    const barY = this.pixelY - 8; // above the building

    // Background (dark)
    this.healthBar.fillStyle(0x222222, 0.9);
    this.healthBar.fillRect(barX, barY, barWidth, barHeight);

    // Fill (green -> yellow -> red gradient based on HP ratio)
    const ratio = this.hp / this.maxHp;
    let color: number;
    if (ratio > 0.6) {
      color = 0x00cc00;
    } else if (ratio > 0.3) {
      color = 0xcccc00;
    } else {
      color = 0xcc0000;
    }

    this.healthBar.fillStyle(color, 1);
    this.healthBar.fillRect(barX, barY, barWidth * ratio, barHeight);
  }

  /** Draw the capture progress bar below the building. */
  drawCaptureBar(): void {
    this.captureBar.clear();

    if (!this.isBeingCaptured) {
      this.captureBar.setVisible(false);
      return;
    }

    this.captureBar.setVisible(true);

    const barWidth = this.pixelW;
    const barHeight = 4;
    const barX = this.pixelX;
    const barY = this.pixelY + this.pixelH + 2; // below the building

    // Background
    this.captureBar.fillStyle(0x222222, 0.9);
    this.captureBar.fillRect(barX, barY, barWidth, barHeight);

    // Fill in capturing player's color (fallback to blue)
    const captureColor =
      this.capturingPlayer >= 0
        ? (PLAYER_COLORS as Record<number, number>)[this.capturingPlayer] ??
          0x3388ff
        : 0x3388ff;

    this.captureBar.fillStyle(captureColor, 1);
    this.captureBar.fillRect(
      barX,
      barY,
      barWidth * this.captureProgress,
      barHeight,
    );
  }

  /** Redraw the owner border. Highlights when selected. */
  updateBorder(): void {
    this.borderGraphics.clear();

    // Determine border color
    let borderColor: number;
    if (this.owner === -1) {
      borderColor = PLAYER_COLORS.neutral;
    } else {
      borderColor =
        (PLAYER_COLORS as Record<number, number>)[this.owner] ??
        PLAYER_COLORS.neutral;
    }

    const lineWidth = this.selected ? 3 : 2;
    const alpha = this.selected ? 1.0 : 0.9;

    this.borderGraphics.lineStyle(lineWidth, borderColor, alpha);
    this.borderGraphics.strokeRect(
      this.pixelX,
      this.pixelY,
      this.pixelW,
      this.pixelH,
    );

    // When selected, add an outer glow (white highlight)
    if (this.selected) {
      this.borderGraphics.lineStyle(1, 0xffffff, 0.5);
      this.borderGraphics.strokeRect(
        this.pixelX - 2,
        this.pixelY - 2,
        this.pixelW + 4,
        this.pixelH + 4,
      );
    }
  }

  // ─── Spatial Queries ─────────────────────────────────────────────────────────

  /** Return pixel-space bounding rectangle for this building. */
  getBounds(): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      this.pixelX,
      this.pixelY,
      this.pixelW,
      this.pixelH,
    );
  }

  /** Check whether a pixel coordinate falls within this building. */
  containsPoint(pixelX: number, pixelY: number): boolean {
    return (
      pixelX >= this.pixelX &&
      pixelX < this.pixelX + this.pixelW &&
      pixelY >= this.pixelY &&
      pixelY < this.pixelY + this.pixelH
    );
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  /** Remove all Phaser objects and emit BUILDING_DESTROYED. */
  destroy(): void {
    EventBus.emit(GameEvents.BUILDING_DESTROYED, {
      buildingId: this.id,
      type: this.type,
      owner: this.owner,
    });

    this.sprite.destroy();
    this.borderGraphics.destroy();
    this.captureBar.destroy();
    this.healthBar.destroy();
    this.label.destroy();
  }
}
