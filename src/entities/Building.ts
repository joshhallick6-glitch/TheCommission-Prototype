// ─── Building Entity ─────────────────────────────────────────────────────────
// Capturable property on the map. Provides income, garrison, and goods storage
// depending on type. Ownership is indicated by a colored border.
//
// VISUAL RENDERING: All building visuals (skyscraper walls, storefront accents,
// labels) are drawn by GameScene.createCityBlockVisuals(). The Building entity
// itself has NO ground-level visual — it is purely a data/interaction entity.
// The border overlay is only shown when the building is selected.

import Phaser from 'phaser';
import { TILE_WIDTH, TILE_HEIGHT, CAPTURE_TIME_BASE, CAPTURE_TIME_ENEMY, PLAYER_COLORS } from '../data/config';
import { BuildingType, BuildingStats, BUILDING_DEFS } from '../data/buildings';
import { UNIT_DEFS } from '../data/units';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld, isoDepth, worldToTile } from '../utils/IsometricUtils';

const HALF_W = TILE_WIDTH / 2;
const HALF_H = TILE_HEIGHT / 2;

interface ProductionQueueEntry {
  unitType: string;
  progress: number;
  totalTime: number;
}

export class Building {
  readonly id: string;
  readonly type: BuildingType;
  readonly stats: BuildingStats;

  owner: number;
  hp: number;
  maxHp: number;
  tileX: number;
  tileY: number;

  isBeingCaptured: boolean = false;
  captureProgress: number = 0;
  capturingPlayer: number = -1;

  garrisonedSquads: string[] = [];
  goodsStored: number = 0;

  private productionQueue: ProductionQueueEntry[] = [];
  public rallyPoint: { x: number; y: number } | null = null;

  // Visuals — minimal. The skyscraper IS the visual.
  sprite: Phaser.GameObjects.Graphics;
  borderGraphics: Phaser.GameObjects.Graphics;
  captureBar: Phaser.GameObjects.Graphics;
  healthBar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  selected: boolean = false;
  private isDestroyed: boolean = false;

  /** Four corners of the storefront parallelogram on the skyscraper wall.
   *  Set by GameScene.drawBuildingStorefront(). Used for click detection and border.
   *  bl=bottom-left, br=bottom-right, tr=top-right, tl=top-left (wall-face coords). */
  public storefrontBounds: {
    blX: number; blY: number;  // bottom-left (ground, start of wall segment)
    brX: number; brY: number;  // bottom-right (ground, end of wall segment)
    trX: number; trY: number;  // top-right (above br)
    tlX: number; tlY: number;  // top-left (above bl)
  } | null = null;

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

    const centerTileX = tileX + (this.stats.widthTiles - 1) / 2;
    const centerTileY = tileY + (this.stats.heightTiles - 1) / 2;
    const centerPos = tileToWorld(centerTileX, centerTileY);

    this.pixelX = centerPos.x;
    this.pixelY = centerPos.y;
    this.pixelW = this.stats.widthTiles * TILE_WIDTH;
    this.pixelH = this.stats.heightTiles * TILE_HEIGHT + 24;

    const depth = isoDepth(tileX + this.stats.widthTiles - 1, tileY + this.stats.heightTiles - 1, 0);

    // No-op sprite (kept for FogOfWarSystem visibility toggling)
    this.sprite = scene.add.graphics();
    this.sprite.setDepth(depth);

    // Border — only shown when selected
    this.borderGraphics = scene.add.graphics();
    this.borderGraphics.setDepth(depth + 0.1);
    this.borderGraphics.setVisible(false);

    // Label — hidden, GameScene draws labels on the skyscraper wall
    this.label = scene.add.text(0, 0, '', { fontSize: '1px' });
    this.label.setVisible(false);

    // Health bar
    this.healthBar = scene.add.graphics();
    this.healthBar.setDepth(depth + 0.3);
    this.healthBar.setVisible(false);

    // Capture bar
    this.captureBar = scene.add.graphics();
    this.captureBar.setDepth(depth + 0.3);
    this.captureBar.setVisible(false);
  }

  // ─── Capture ─────────────────────────────────────────────────────────────────

  startCapture(playerIndex: number): void {
    if (this.isBeingCaptured && this.capturingPlayer === playerIndex) return;
    this.isBeingCaptured = true;
    this.captureProgress = 0;
    this.capturingPlayer = playerIndex;
    this.captureBar.setVisible(true);
    EventBus.emit(GameEvents.CAPTURE_STARTED, { buildingId: this.id, playerIndex });
  }

  updateCapture(delta: number, squadCount: number = 1): void {
    if (!this.isBeingCaptured) return;
    const baseTime = this.owner === -1 ? CAPTURE_TIME_BASE : CAPTURE_TIME_ENEMY;
    const speedMultiplier = Math.min(2.0, 1.0 + (Math.max(1, squadCount) - 1) * 0.25);
    const rate = (1.0 / baseTime) * speedMultiplier;
    this.captureProgress = Math.min(1.0, this.captureProgress + rate * delta);
    this.drawCaptureBar();
    EventBus.emit(GameEvents.CAPTURE_PROGRESS, { buildingId: this.id, progress: this.captureProgress, playerIndex: this.capturingPlayer });
    if (this.captureProgress >= 1.0) this.completeCapture();
  }

  completeCapture(): void {
    const previousOwner = this.owner;
    this.owner = this.capturingPlayer;
    this.isBeingCaptured = false;
    this.captureProgress = 0;
    this.capturingPlayer = -1;
    this.captureBar.setVisible(false);
    this.productionQueue = [];
    this.garrisonedSquads = [];
    this.updateBorder();
    EventBus.emit(GameEvents.BUILDING_CAPTURED, { buildingId: this.id, newOwner: this.owner, previousOwner, type: this.type });
  }

  cancelCapture(): void {
    this.isBeingCaptured = false;
    this.captureProgress = 0;
    this.capturingPlayer = -1;
    this.captureBar.setVisible(false);
    this.drawCaptureBar();
  }

  // ─── Damage & Repair ─────────────────────────────────────────────────────────

  takeDamage(amount: number, _attacker?: any): void {
    this.hp = Math.max(0, this.hp - amount);
    this.drawHealthBar();
    EventBus.emit(GameEvents.BUILDING_DAMAGED, { buildingId: this.id, hp: this.hp, maxHp: this.maxHp });
    if (this.hp <= 0) this.destroy();
  }

  repair(amount: number): void {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.drawHealthBar();
  }

  // ─── Garrison ────────────────────────────────────────────────────────────────

  garrison(squadId: string): boolean {
    if (!this.stats.canGarrison) return false;
    if (this.garrisonedSquads.length >= this.stats.garrisonSlots) return false;
    if (this.garrisonedSquads.includes(squadId)) return false;
    this.garrisonedSquads.push(squadId);
    return true;
  }

  ungarrison(squadId: string): void {
    const idx = this.garrisonedSquads.indexOf(squadId);
    if (idx !== -1) this.garrisonedSquads.splice(idx, 1);
  }

  // ─── Production Queue ──────────────────────────────────────────────────────

  queueUnit(unitType: string, trainTimeMultiplier: number = 1.0): boolean {
    if (!this.stats.canProduceUnits) return false;
    if (this.productionQueue.length >= 5) return false;
    const unitDef = UNIT_DEFS[unitType as keyof typeof UNIT_DEFS];
    if (!unitDef) return false;
    const effectiveMultiplier = unitDef.tier >= 2 ? trainTimeMultiplier : 1.0;
    this.productionQueue.push({ unitType, progress: 0, totalTime: unitDef.trainTime * 1000 * effectiveMultiplier });
    return true;
  }

  cancelUnit(index: number): string | null {
    if (index < 0 || index >= this.productionQueue.length) return null;
    const entry = this.productionQueue[index];
    this.productionQueue.splice(index, 1);
    return entry.unitType;
  }

  updateProduction(delta: number): void {
    if (!this.stats.canProduceUnits || this.productionQueue.length === 0) return;
    const front = this.productionQueue[0];
    front.progress += delta;
    if (front.progress >= front.totalTime) {
      this.productionQueue.shift();
      EventBus.emit(GameEvents.UNIT_PRODUCED, { buildingId: this.id, unitType: front.unitType, tileX: this.tileX, tileY: this.tileY, rallyPoint: this.rallyPoint });
    }
  }

  getQueue(): ProductionQueueEntry[] { return this.productionQueue; }
  setRallyPoint(tileX: number, tileY: number): void { this.rallyPoint = { x: tileX, y: tileY }; }

  // ─── Selection ───────────────────────────────────────────────────────────────

  select(): void {
    this.selected = true;
    this.borderGraphics.setVisible(true);
    this.updateBorder();
  }

  deselect(): void {
    this.selected = false;
    this.borderGraphics.setVisible(false);
  }

  update(delta: number): void { this.updateProduction(delta); }

  // ─── Drawing ─────────────────────────────────────────────────────────────────

  drawHealthBar(): void {
    this.healthBar.clear();
    if (this.hp >= this.maxHp) { this.healthBar.setVisible(false); return; }
    this.healthBar.setVisible(true);
    const barWidth = TILE_WIDTH * this.stats.widthTiles * 0.7;
    const barHeight = 4;
    const barX = this.pixelX - barWidth / 2;
    const barY = this.pixelY - this.stats.heightTiles * TILE_HEIGHT / 2 - 12;
    this.healthBar.fillStyle(0x222222, 0.9);
    this.healthBar.fillRect(barX, barY, barWidth, barHeight);
    const ratio = this.hp / this.maxHp;
    const color = ratio > 0.6 ? 0x00cc00 : ratio > 0.3 ? 0xcccc00 : 0xcc0000;
    this.healthBar.fillStyle(color, 1);
    this.healthBar.fillRect(barX, barY, barWidth * ratio, barHeight);
  }

  drawCaptureBar(): void {
    this.captureBar.clear();
    if (!this.isBeingCaptured) { this.captureBar.setVisible(false); return; }
    this.captureBar.setVisible(true);
    const barWidth = TILE_WIDTH * this.stats.widthTiles * 0.7;
    const barHeight = 4;
    const barX = this.pixelX - barWidth / 2;
    const barY = this.pixelY + this.stats.heightTiles * TILE_HEIGHT / 2 + 4;
    this.captureBar.fillStyle(0x222222, 0.9);
    this.captureBar.fillRect(barX, barY, barWidth, barHeight);
    const captureColor = this.capturingPlayer >= 0
      ? (PLAYER_COLORS as Record<number, number>)[this.capturingPlayer] ?? 0x3388ff : 0x3388ff;
    this.captureBar.fillStyle(captureColor, 1);
    this.captureBar.fillRect(barX, barY, barWidth * this.captureProgress, barHeight);
  }

  updateBorder(): void {
    this.borderGraphics.clear();
    let borderColor: number;
    if (this.owner === -1) borderColor = PLAYER_COLORS.neutral;
    else borderColor = (PLAYER_COLORS as Record<number, number>)[this.owner] ?? PLAYER_COLORS.neutral;

    // Draw border as a parallelogram matching the storefront wall face
    if (this.storefrontBounds) {
      const s = this.storefrontBounds;

      // Main border — parallelogram matching the wall panel
      this.borderGraphics.lineStyle(2, borderColor, 1.0);
      this.borderGraphics.beginPath();
      this.borderGraphics.moveTo(s.blX, s.blY);
      this.borderGraphics.lineTo(s.brX, s.brY);
      this.borderGraphics.lineTo(s.trX, s.trY);
      this.borderGraphics.lineTo(s.tlX, s.tlY);
      this.borderGraphics.closePath();
      this.borderGraphics.strokePath();

      // Outer glow — slightly expanded parallelogram
      this.borderGraphics.lineStyle(1, 0xffffff, 0.4);
      const dx = 3;
      const dy = 2;
      this.borderGraphics.beginPath();
      this.borderGraphics.moveTo(s.blX - dx, s.blY + dy);
      this.borderGraphics.lineTo(s.brX + dx, s.brY + dy);
      this.borderGraphics.lineTo(s.trX + dx, s.trY - dy);
      this.borderGraphics.lineTo(s.tlX - dx, s.tlY - dy);
      this.borderGraphics.closePath();
      this.borderGraphics.strokePath();
      return;
    }

    // Fallback: ground-level diamond (shouldn't normally be needed)
    const w = this.stats.widthTiles;
    const h = this.stats.heightTiles;
    const topPos = tileToWorld(this.tileX, this.tileY);
    const rightPos = tileToWorld(this.tileX + w, this.tileY);
    const bottomPos = tileToWorld(this.tileX + w, this.tileY + h);
    const leftPos = tileToWorld(this.tileX, this.tileY + h);

    this.borderGraphics.lineStyle(3, borderColor, 1.0);
    this.borderGraphics.beginPath();
    this.borderGraphics.moveTo(topPos.x, topPos.y - HALF_H);
    this.borderGraphics.lineTo(rightPos.x + HALF_W, rightPos.y);
    this.borderGraphics.lineTo(bottomPos.x, bottomPos.y + HALF_H);
    this.borderGraphics.lineTo(leftPos.x - HALF_W, leftPos.y);
    this.borderGraphics.closePath();
    this.borderGraphics.strokePath();
  }

  // ─── Spatial Queries ─────────────────────────────────────────────────────────

  getBounds(): Phaser.Geom.Rectangle {
    const halfW = this.stats.widthTiles * TILE_WIDTH / 2 + TILE_WIDTH / 2;
    const halfH = this.stats.heightTiles * TILE_HEIGHT / 2 + TILE_HEIGHT;
    return new Phaser.Geom.Rectangle(this.pixelX - halfW, this.pixelY - halfH, halfW * 2, halfH * 2);
  }

  containsPoint(worldPixelX: number, worldPixelY: number): boolean {
    // Primary: check the storefront parallelogram (set by GameScene)
    if (this.storefrontBounds) {
      const s = this.storefrontBounds;
      // Use axis-aligned bounding box of the parallelogram with margin
      const minX = Math.min(s.blX, s.brX, s.tlX, s.trX) - 6;
      const maxX = Math.max(s.blX, s.brX, s.tlX, s.trX) + 6;
      const minY = Math.min(s.blY, s.brY, s.tlY, s.trY) - 6;
      const maxY = Math.max(s.blY, s.brY, s.tlY, s.trY) + 6;
      if (worldPixelX >= minX && worldPixelX <= maxX &&
          worldPixelY >= minY && worldPixelY <= maxY) {
        return true;
      }
    }
    // Fallback: ground-level tile footprint
    const tile = worldToTile(worldPixelX, worldPixelY);
    return tile.x >= this.tileX && tile.x < this.tileX + this.stats.widthTiles
        && tile.y >= this.tileY && tile.y < this.tileY + this.stats.heightTiles;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    EventBus.emit(GameEvents.BUILDING_DESTROYED, { buildingId: this.id, type: this.type, owner: this.owner });
    this.sprite.destroy();
    this.borderGraphics.destroy();
    this.captureBar.destroy();
    this.healthBar.destroy();
    this.label.destroy();
  }
}
