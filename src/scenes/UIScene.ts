// ─── UI Scene ───────────────────────────────────────────────────────────────
// HUD overlay rendered on top of GameScene with a fixed camera.
// Shows resource bar, minimap, selection panel, action bar, and alerts.

import Phaser from 'phaser';
import {
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  PLAYER_COLORS,
  TIER_COSTS,
  STARTING_CASH,
  STARTING_GOODS,
  STARTING_INFLUENCE,
} from '../data/config';
import { UnitType, UNIT_DEFS } from '../data/units';
import { BuildingType, BUILDING_DEFS } from '../data/buildings';
import { EventBus, GameEvents } from '../utils/EventBus';

// ─── Constants ──────────────────────────────────────────────────────────────

const UI_DEPTH = 100;
const PANEL_BG_COLOR = 0x111111;
const PANEL_BG_ALPHA = 0.85;
const PANEL_BORDER_COLOR = 0x444444;
const FONT_FAMILY = 'Arial';
const MINIMAP_SIZE = 200;
const MINIMAP_UPDATE_INTERVAL = 500; // ms
const ALERT_LIFETIME = 5000; // ms
const MAX_ALERTS = 5;

// Resource bar dimensions
const RESOURCE_BAR_HEIGHT = 40;

// Selection panel dimensions
const SELECTION_PANEL_WIDTH = 400;
const SELECTION_PANEL_HEIGHT = 150;

// Action bar dimensions
const ACTION_BAR_WIDTH = 300;
const ACTION_BAR_HEIGHT = 150;

// ─── Alert entry ────────────────────────────────────────────────────────────

interface AlertEntry {
  text: Phaser.GameObjects.Text;
  background: Phaser.GameObjects.Rectangle;
  createdAt: number;
}

// ─── Action button ──────────────────────────────────────────────────────────

interface ActionButton {
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  callback: () => void;
  enabled: boolean;
}

// ─── UIScene ────────────────────────────────────────────────────────────────

export class UIScene extends Phaser.Scene {
  // ── References ────────────────────────────────────────────────────────
  private gameScene!: Phaser.Scene;

  // ── Resource bar elements ─────────────────────────────────────────────
  private resourceBarBg!: Phaser.GameObjects.Rectangle;
  private cashText!: Phaser.GameObjects.Text;
  private goodsText!: Phaser.GameObjects.Text;
  private influenceText!: Phaser.GameObjects.Text;
  private incomeRateText!: Phaser.GameObjects.Text;
  private tierText!: Phaser.GameObjects.Text;
  private tierButton!: Phaser.GameObjects.Rectangle;
  private tierButtonLabel!: Phaser.GameObjects.Text;

  // ── Resource tracking ─────────────────────────────────────────────────
  private playerCash: number = STARTING_CASH;
  private playerGoods: number = STARTING_GOODS;
  private playerInfluence: number = STARTING_INFLUENCE;
  private incomeRate: number = 0;
  private goodsRate: number = 0;
  private influenceRate: number = 0;
  private currentTier: number = 1;

  // ── Minimap elements ──────────────────────────────────────────────────
  private minimapBg!: Phaser.GameObjects.Rectangle;
  private minimapBorder!: Phaser.GameObjects.Rectangle;
  private minimapTexture!: Phaser.GameObjects.RenderTexture;
  private minimapViewport!: Phaser.GameObjects.Graphics;
  private minimapLastUpdate: number = 0;
  private minimapExpanded: boolean = false;

  // Minimap position & size
  private minimapX: number = 10;
  private minimapY: number = VIEWPORT_HEIGHT - MINIMAP_SIZE - 10;

  // ── Selection panel elements ──────────────────────────────────────────
  private selectionPanelBg!: Phaser.GameObjects.Rectangle;
  private selectionTexts: Phaser.GameObjects.Text[] = [];
  private selectionHpBar!: Phaser.GameObjects.Graphics;
  private currentSelection: any = null;
  private selectionType: 'none' | 'unit' | 'building' | 'multi' = 'none';
  private multiSelection: any[] = [];

  // ── Action bar elements ───────────────────────────────────────────────
  private actionBarBg!: Phaser.GameObjects.Rectangle;
  private actionButtons: ActionButton[] = [];

  // ── Alerts ────────────────────────────────────────────────────────────
  private alerts: AlertEntry[] = [];

  constructor() {
    super({ key: 'UIScene' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════

  create(): void {
    // Get reference to the game scene
    this.gameScene = this.scene.get('GameScene');

    // Fixed camera -- does not scroll with the game world
    this.cameras.main.setScroll(0, 0);

    // Build all UI panels
    this.createResourceBar();
    this.createMinimap();
    this.createSelectionPanel();
    this.createActionBar();

    // Register event listeners
    this.registerEventListeners();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RESOURCE BAR (top of screen)
  // ═══════════════════════════════════════════════════════════════════════

  private createResourceBar(): void {
    // Background
    this.resourceBarBg = this.add.rectangle(
      VIEWPORT_WIDTH / 2,
      RESOURCE_BAR_HEIGHT / 2,
      VIEWPORT_WIDTH,
      RESOURCE_BAR_HEIGHT,
      PANEL_BG_COLOR,
      PANEL_BG_ALPHA,
    );
    this.resourceBarBg.setDepth(UI_DEPTH);

    // ── Left section: Player resources ──────────────────────────────────
    const leftX = 20;
    const textY = RESOURCE_BAR_HEIGHT / 2;

    this.cashText = this.add.text(leftX, textY, '$0', {
      fontSize: '16px',
      fontFamily: FONT_FAMILY,
      color: '#FFD700',
      fontStyle: 'bold',
    });
    this.cashText.setOrigin(0, 0.5);
    this.cashText.setDepth(UI_DEPTH + 1);

    this.goodsText = this.add.text(leftX + 120, textY, 'Goods: 0', {
      fontSize: '16px',
      fontFamily: FONT_FAMILY,
      color: '#CD853F',
      fontStyle: 'bold',
    });
    this.goodsText.setOrigin(0, 0.5);
    this.goodsText.setDepth(UI_DEPTH + 1);

    this.influenceText = this.add.text(leftX + 260, textY, 'Inf: 0', {
      fontSize: '16px',
      fontFamily: FONT_FAMILY,
      color: '#6495ED',
      fontStyle: 'bold',
    });
    this.influenceText.setOrigin(0, 0.5);
    this.influenceText.setDepth(UI_DEPTH + 1);

    // ── Center section: Income rates ────────────────────────────────────
    this.incomeRateText = this.add.text(VIEWPORT_WIDTH / 2, textY, '+$0/min  +0g/min  +0i/min', {
      fontSize: '13px',
      fontFamily: FONT_FAMILY,
      color: '#AAAAAA',
    });
    this.incomeRateText.setOrigin(0.5, 0.5);
    this.incomeRateText.setDepth(UI_DEPTH + 1);

    // ── Right section: Tier info and button ──────────────────────────────
    this.tierText = this.add.text(VIEWPORT_WIDTH - 250, textY, 'TIER 1: Street Crew', {
      fontSize: '14px',
      fontFamily: FONT_FAMILY,
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    this.tierText.setOrigin(0, 0.5);
    this.tierText.setDepth(UI_DEPTH + 1);

    // Tier-up button
    this.tierButton = this.add.rectangle(
      VIEWPORT_WIDTH - 60,
      textY,
      100,
      28,
      0x336633,
      0.9,
    );
    this.tierButton.setDepth(UI_DEPTH + 1);
    this.tierButton.setInteractive({ useHandCursor: true });
    this.tierButton.on('pointerdown', () => this.onTierUpClicked());

    this.tierButtonLabel = this.add.text(VIEWPORT_WIDTH - 60, textY, 'TIER UP', {
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    this.tierButtonLabel.setOrigin(0.5, 0.5);
    this.tierButtonLabel.setDepth(UI_DEPTH + 2);
  }

  private updateResourceBar(): void {
    this.cashText.setText(`$${Math.floor(this.playerCash)}`);
    this.goodsText.setText(`Goods: ${Math.floor(this.playerGoods)}`);
    this.influenceText.setText(`Inf: ${Math.floor(this.playerInfluence)}`);

    this.incomeRateText.setText(
      `+$${Math.floor(this.incomeRate)}/min  +${Math.floor(this.goodsRate)}g/min  +${Math.floor(this.influenceRate)}i/min`,
    );

    // Tier display
    const tierNames: Record<number, string> = {
      1: 'Street Crew',
      2: 'Syndicate',
      3: 'Crime Family',
      4: 'Empire',
    };
    this.tierText.setText(`TIER ${this.currentTier}: ${tierNames[this.currentTier] ?? 'Unknown'}`);

    // Update tier button appearance
    const nextTier = this.currentTier + 1;
    const cost = TIER_COSTS[nextTier as keyof typeof TIER_COSTS];
    if (cost) {
      this.tierButtonLabel.setText(`TIER UP ($${cost.cash})`);
      const canAfford = this.playerCash >= cost.cash &&
        this.playerGoods >= cost.goods &&
        this.playerInfluence >= cost.influence;
      this.tierButton.setFillStyle(canAfford ? 0x336633 : 0x333333, 0.9);
    } else {
      this.tierButtonLabel.setText('MAX TIER');
      this.tierButton.setFillStyle(0x333333, 0.9);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MINIMAP (bottom-left)
  // ═══════════════════════════════════════════════════════════════════════

  private createMinimap(): void {
    // Background
    this.minimapBg = this.add.rectangle(
      this.minimapX + MINIMAP_SIZE / 2,
      this.minimapY + MINIMAP_SIZE / 2,
      MINIMAP_SIZE,
      MINIMAP_SIZE,
      0x0a0a0a,
      0.9,
    );
    this.minimapBg.setDepth(UI_DEPTH);

    // Border
    this.minimapBorder = this.add.rectangle(
      this.minimapX + MINIMAP_SIZE / 2,
      this.minimapY + MINIMAP_SIZE / 2,
      MINIMAP_SIZE + 4,
      MINIMAP_SIZE + 4,
    );
    this.minimapBorder.setStrokeStyle(2, 0x888888, 1);
    this.minimapBorder.setFillStyle(0x000000, 0);
    this.minimapBorder.setDepth(UI_DEPTH + 2);

    // Render texture for the minimap content
    this.minimapTexture = this.add.renderTexture(
      this.minimapX,
      this.minimapY,
      MINIMAP_SIZE,
      MINIMAP_SIZE,
    );
    this.minimapTexture.setOrigin(0, 0);
    this.minimapTexture.setDepth(UI_DEPTH + 1);

    // Camera viewport overlay
    this.minimapViewport = this.add.graphics();
    this.minimapViewport.setDepth(UI_DEPTH + 3);

    // Minimap click handling
    this.minimapBg.setInteractive({ useHandCursor: true });
    this.minimapBg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.onMinimapClick(pointer);
    });
  }

  private updateMinimap(time: number): void {
    // Only update periodically to save performance
    if (time - this.minimapLastUpdate < MINIMAP_UPDATE_INTERVAL) {
      this.updateMinimapViewport(); // Always update viewport rectangle
      return;
    }
    this.minimapLastUpdate = time;

    // Scale factor: map tiles to minimap pixels
    const scaleX = MINIMAP_SIZE / MAP_WIDTH;
    const scaleY = MINIMAP_SIZE / MAP_HEIGHT;

    // Clear and redraw
    this.minimapTexture.clear();

    // Draw terrain using a temporary graphics object
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);

    // Draw a simplified terrain view
    // Sample every few tiles for performance
    const step = Math.max(1, Math.floor(MAP_WIDTH / MINIMAP_SIZE));

    const gameScene = this.gameScene as any;
    const mapSystem = gameScene?.mapSystem;

    if (mapSystem) {
      for (let ty = 0; ty < MAP_HEIGHT; ty += step) {
        for (let tx = 0; tx < MAP_WIDTH; tx += step) {
          const terrain = mapSystem.getTerrain(tx, ty);
          let color = 0x222222;

          switch (terrain) {
            case 0: // ROAD
              color = 0x3a3a3a;
              break;
            case 1: // SIDEWALK
              color = 0x555555;
              break;
            case 2: // BUILDING_FLOOR
              color = 0x2a1f14;
              break;
            case 3: // WALL
              color = 0x1a1208;
              break;
            case 4: // ALLEY
              color = 0x2a2a2a;
              break;
            case 5: // PARK
              color = 0x1a3a1a;
              break;
            case 6: // WATER
              color = 0x1a2a4a;
              break;
            case 7: // BRIDGE
              color = 0x4a4a3a;
              break;
            case 8: // COVER_OBJECT
              color = 0x555555;
              break;
          }

          const px = Math.floor(tx * scaleX);
          const py = Math.floor(ty * scaleY);
          const pw = Math.max(1, Math.ceil(step * scaleX));
          const ph = Math.max(1, Math.ceil(step * scaleY));

          gfx.fillStyle(color, 1);
          gfx.fillRect(px, py, pw, ph);
        }
      }
    }

    // Draw buildings as colored dots
    const buildingSystem = gameScene?.buildingSystem;
    if (buildingSystem) {
      for (const building of buildingSystem.buildings.values()) {
        let bColor: number;
        if (building.owner === -1) {
          bColor = PLAYER_COLORS.neutral;
        } else {
          bColor = (PLAYER_COLORS as Record<number, number>)[building.owner] ?? PLAYER_COLORS.neutral;
        }

        const bx = Math.floor(building.tileX * scaleX);
        const by = Math.floor(building.tileY * scaleY);
        const bw = Math.max(2, Math.ceil(building.stats.widthTiles * scaleX));
        const bh = Math.max(2, Math.ceil(building.stats.heightTiles * scaleY));

        gfx.fillStyle(bColor, 1);
        gfx.fillRect(bx, by, bw, bh);
      }
    }

    // Draw units as bright dots
    const unitSystem = gameScene?.unitSystem;
    if (unitSystem) {
      for (const squad of unitSystem.squads.values()) {
        const uColor = (PLAYER_COLORS as Record<number, number>)[squad.owner] ?? 0xFFFFFF;
        const ux = Math.floor(squad.tileX * scaleX);
        const uy = Math.floor(squad.tileY * scaleY);

        // Make unit dots bright and slightly larger
        gfx.fillStyle(uColor, 1);
        gfx.fillRect(ux - 1, uy - 1, 3, 3);
      }
    }

    // Render the graphics onto the render texture
    this.minimapTexture.draw(gfx, 0, 0);
    gfx.destroy();

    // Update viewport rectangle
    this.updateMinimapViewport();
  }

  private updateMinimapViewport(): void {
    this.minimapViewport.clear();

    const gameScene = this.gameScene as any;
    if (!gameScene?.cameras?.main) return;

    const cam = gameScene.cameras.main;
    const scaleX = MINIMAP_SIZE / MAP_WIDTH;
    const scaleY = MINIMAP_SIZE / MAP_HEIGHT;

    // Camera world view in tile coords
    const camTileX = cam.worldView.x / TILE_SIZE;
    const camTileY = cam.worldView.y / TILE_SIZE;
    const camTileW = cam.worldView.width / TILE_SIZE;
    const camTileH = cam.worldView.height / TILE_SIZE;

    // Convert to minimap pixel coords
    const vpX = this.minimapX + camTileX * scaleX;
    const vpY = this.minimapY + camTileY * scaleY;
    const vpW = camTileW * scaleX;
    const vpH = camTileH * scaleY;

    // Draw white rectangle outline
    this.minimapViewport.lineStyle(1, 0xFFFFFF, 0.9);
    this.minimapViewport.strokeRect(vpX, vpY, vpW, vpH);
  }

  private onMinimapClick(pointer: Phaser.Input.Pointer): void {
    // Convert minimap click to world tile coordinates
    const localX = pointer.x - this.minimapX;
    const localY = pointer.y - this.minimapY;

    const tileX = (localX / MINIMAP_SIZE) * MAP_WIDTH;
    const tileY = (localY / MINIMAP_SIZE) * MAP_HEIGHT;

    // Convert to world pixel position
    const worldX = tileX * TILE_SIZE;
    const worldY = tileY * TILE_SIZE;

    // Center the game camera on this position
    const gameScene = this.gameScene as any;
    if (gameScene?.cameras?.main) {
      gameScene.cameras.main.centerOn(worldX, worldY);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SELECTION PANEL (bottom-center)
  // ═══════════════════════════════════════════════════════════════════════

  private createSelectionPanel(): void {
    const panelX = this.minimapX + MINIMAP_SIZE + 15;
    const panelY = VIEWPORT_HEIGHT - SELECTION_PANEL_HEIGHT - 10;

    // Background
    this.selectionPanelBg = this.add.rectangle(
      panelX + SELECTION_PANEL_WIDTH / 2,
      panelY + SELECTION_PANEL_HEIGHT / 2,
      SELECTION_PANEL_WIDTH,
      SELECTION_PANEL_HEIGHT,
      PANEL_BG_COLOR,
      PANEL_BG_ALPHA,
    );
    this.selectionPanelBg.setStrokeStyle(1, PANEL_BORDER_COLOR, 0.8);
    this.selectionPanelBg.setDepth(UI_DEPTH);
    this.selectionPanelBg.setVisible(false);

    // HP bar graphics
    this.selectionHpBar = this.add.graphics();
    this.selectionHpBar.setDepth(UI_DEPTH + 1);
    this.selectionHpBar.setVisible(false);
  }

  private updateSelectionPanel(): void {
    // Clear previous text elements
    for (const text of this.selectionTexts) {
      text.destroy();
    }
    this.selectionTexts = [];
    this.selectionHpBar.clear();
    this.selectionHpBar.setVisible(false);

    const panelX = this.minimapX + MINIMAP_SIZE + 15;
    const panelY = VIEWPORT_HEIGHT - SELECTION_PANEL_HEIGHT - 10;

    const gameScene = this.gameScene as any;
    const unitSystem = gameScene?.unitSystem;
    const selected = unitSystem?.selectedSquads ?? [];

    // Check for selected building
    const selectedBuilding = gameScene?.selectedBuilding;

    if (selected.length === 1) {
      // ── Single unit selected ──────────────────────────────────────────
      this.selectionType = 'unit';
      this.currentSelection = selected[0];
      this.selectionPanelBg.setVisible(true);

      const squad = selected[0];
      const stats = squad.stats;

      // Unit name and type
      const nameText = this.add.text(panelX + 10, panelY + 10, `${stats.name}`, {
        fontSize: '16px',
        fontFamily: FONT_FAMILY,
        color: '#FFFFFF',
        fontStyle: 'bold',
      });
      nameText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(nameText);

      // Tier
      const tierText = this.add.text(panelX + 10, panelY + 30, `Tier ${stats.tier}  |  ${squad.state.toUpperCase()}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#AAAAAA',
      });
      tierText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(tierText);

      // HP bar
      this.drawSelectionHpBar(panelX + 10, panelY + 50, SELECTION_PANEL_WIDTH - 20, 8, squad.hp, squad.maxHp);

      // HP text
      const hpText = this.add.text(panelX + 10, panelY + 62, `HP: ${Math.ceil(squad.hp)}/${squad.maxHp}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#CCCCCC',
      });
      hpText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(hpText);

      // Members
      const memberText = this.add.text(panelX + 150, panelY + 62, `Members: ${squad.members}/${stats.squadSize}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#CCCCCC',
      });
      memberText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(memberText);

      // Veterancy stars
      const stars = '\u2605'.repeat(squad.veterancy) + '\u2606'.repeat(3 - squad.veterancy);
      const vetText = this.add.text(panelX + 10, panelY + 82, `Veterancy: ${stars}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#FFD700',
      });
      vetText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(vetText);

      // Carrying goods (if applicable)
      if (stats.canCarryGoods) {
        const goodsText = this.add.text(panelX + 10, panelY + 102, `Carrying: ${squad.carryingGoods}/${stats.goodsCapacity} goods`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#CD853F',
        });
        goodsText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(goodsText);
      }

      // DPS info
      const dpsText = this.add.text(panelX + 10, panelY + 122, `DPS: ${squad.members * stats.dpsPerMember}  |  Range: ${stats.range}  |  Speed: ${stats.speed}`, {
        fontSize: '11px',
        fontFamily: FONT_FAMILY,
        color: '#888888',
      });
      dpsText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(dpsText);

    } else if (selected.length > 1) {
      // ── Multiple units selected ───────────────────────────────────────
      this.selectionType = 'multi';
      this.multiSelection = selected;
      this.selectionPanelBg.setVisible(true);

      // Count and types summary
      const typeCount = new Map<string, number>();
      let totalHp = 0;
      let totalMaxHp = 0;

      for (const squad of selected) {
        const name = squad.stats.name;
        typeCount.set(name, (typeCount.get(name) ?? 0) + 1);
        totalHp += squad.hp;
        totalMaxHp += squad.maxHp;
      }

      const countText = this.add.text(panelX + 10, panelY + 10, `${selected.length} Squads Selected`, {
        fontSize: '16px',
        fontFamily: FONT_FAMILY,
        color: '#FFFFFF',
        fontStyle: 'bold',
      });
      countText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(countText);

      // Type breakdown
      let yOffset = panelY + 35;
      for (const [name, count] of typeCount) {
        const typeText = this.add.text(panelX + 10, yOffset, `${name} x${count}`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#CCCCCC',
        });
        typeText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(typeText);
        yOffset += 16;
      }

      // Combined HP bar
      this.drawSelectionHpBar(panelX + 10, panelY + SELECTION_PANEL_HEIGHT - 40, SELECTION_PANEL_WIDTH - 20, 8, totalHp, totalMaxHp);

      const hpText = this.add.text(panelX + 10, panelY + SELECTION_PANEL_HEIGHT - 28, `Total HP: ${Math.ceil(totalHp)}/${totalMaxHp}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#CCCCCC',
      });
      hpText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(hpText);

    } else if (selectedBuilding) {
      // ── Building selected ─────────────────────────────────────────────
      this.selectionType = 'building';
      this.currentSelection = selectedBuilding;
      this.selectionPanelBg.setVisible(true);

      const building = selectedBuilding;
      const stats = building.stats;

      // Building name
      const nameText = this.add.text(panelX + 10, panelY + 10, stats.name, {
        fontSize: '16px',
        fontFamily: FONT_FAMILY,
        color: '#FFFFFF',
        fontStyle: 'bold',
      });
      nameText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(nameText);

      // Owner and tier
      const ownerName = building.owner === -1 ? 'Neutral' : building.owner === 0 ? 'Player' : 'Enemy';
      const infoText = this.add.text(panelX + 10, panelY + 30, `Tier ${stats.tier}  |  Owner: ${ownerName}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#AAAAAA',
      });
      infoText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(infoText);

      // HP bar
      this.drawSelectionHpBar(panelX + 10, panelY + 50, SELECTION_PANEL_WIDTH - 20, 8, building.hp, building.maxHp);

      const hpText = this.add.text(panelX + 10, panelY + 62, `HP: ${Math.ceil(building.hp)}/${building.maxHp}`, {
        fontSize: '12px',
        fontFamily: FONT_FAMILY,
        color: '#CCCCCC',
      });
      hpText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(hpText);

      // Income rates
      const incomeText = this.add.text(panelX + 10, panelY + 82,
        `Income: $${stats.cashPerMin}/min  |  Goods: ${stats.goodsPerMin}/min  |  Inf: ${stats.influencePerMin}/min`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#CCCCCC',
        });
      incomeText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(incomeText);

      // Goods stored (if applicable)
      if (stats.canStoreGoods) {
        const goodsText = this.add.text(panelX + 10, panelY + 100, `Goods Stored: ${building.goodsStored}/${stats.goodsStorage}`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#CD853F',
        });
        goodsText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(goodsText);
      }

      // Garrison status
      if (stats.canGarrison) {
        const garrisonText = this.add.text(panelX + 10, panelY + 118, `Garrison: ${building.garrisonedSquads.length}/${stats.garrisonSlots}`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#CCCCCC',
        });
        garrisonText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(garrisonText);
      }

      // Capture progress
      if (building.isBeingCaptured) {
        const captureText = this.add.text(panelX + 10, panelY + 134, `Capture: ${Math.floor(building.captureProgress * 100)}%`, {
          fontSize: '12px',
          fontFamily: FONT_FAMILY,
          color: '#FFD700',
        });
        captureText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(captureText);
      }

    } else {
      // ── Nothing selected ──────────────────────────────────────────────
      this.selectionType = 'none';
      this.currentSelection = null;
      this.selectionPanelBg.setVisible(false);
    }
  }

  private drawSelectionHpBar(x: number, y: number, width: number, height: number, hp: number, maxHp: number): void {
    this.selectionHpBar.setVisible(true);

    const ratio = Math.max(0, Math.min(1, hp / maxHp));

    // Background
    this.selectionHpBar.fillStyle(0x333333, 0.9);
    this.selectionHpBar.fillRect(x, y, width, height);

    // Fill color based on health ratio
    let color: number;
    if (ratio > 0.6) {
      color = 0x00CC00;
    } else if (ratio > 0.3) {
      color = 0xCCCC00;
    } else {
      color = 0xCC0000;
    }

    this.selectionHpBar.fillStyle(color, 1);
    this.selectionHpBar.fillRect(x, y, width * ratio, height);

    // Border
    this.selectionHpBar.lineStyle(1, 0x555555, 0.8);
    this.selectionHpBar.strokeRect(x, y, width, height);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ACTION BAR (bottom-right)
  // ═══════════════════════════════════════════════════════════════════════

  private createActionBar(): void {
    const barX = VIEWPORT_WIDTH - ACTION_BAR_WIDTH - 10;
    const barY = VIEWPORT_HEIGHT - ACTION_BAR_HEIGHT - 10;

    // Background
    this.actionBarBg = this.add.rectangle(
      barX + ACTION_BAR_WIDTH / 2,
      barY + ACTION_BAR_HEIGHT / 2,
      ACTION_BAR_WIDTH,
      ACTION_BAR_HEIGHT,
      PANEL_BG_COLOR,
      PANEL_BG_ALPHA,
    );
    this.actionBarBg.setStrokeStyle(1, PANEL_BORDER_COLOR, 0.8);
    this.actionBarBg.setDepth(UI_DEPTH);
    this.actionBarBg.setVisible(false);
  }

  private updateActionBar(): void {
    // Clear existing buttons
    this.clearActionButtons();

    const barX = VIEWPORT_WIDTH - ACTION_BAR_WIDTH - 10;
    const barY = VIEWPORT_HEIGHT - ACTION_BAR_HEIGHT - 10;

    const gameScene = this.gameScene as any;
    const unitSystem = gameScene?.unitSystem;
    const selected = unitSystem?.selectedSquads ?? [];
    const selectedBuilding = gameScene?.selectedBuilding;

    if (selectedBuilding && selectedBuilding.stats.canProduceUnits && selectedBuilding.owner === 0) {
      // ── Compound selected: Show unit production buttons ───────────────
      this.actionBarBg.setVisible(true);

      const produceableUnits = [
        { type: UnitType.RUNNER, hotkey: '1' },
        { type: UnitType.THUG, hotkey: '2' },
        { type: UnitType.ENFORCER, hotkey: '3' },
        { type: UnitType.ARSONIST, hotkey: '4' },
        { type: UnitType.LOOKOUT, hotkey: '5' },
      ];

      let idx = 0;
      const btnW = 130;
      const btnH = 24;
      const gap = 4;

      for (const unit of produceableUnits) {
        const def = UNIT_DEFS[unit.type];
        const bx = barX + 10;
        const by = barY + 10 + idx * (btnH + gap);
        const canAfford = this.playerCash >= def.cost;
        const tierOk = def.tier <= this.currentTier;
        const enabled = canAfford && tierOk;

        this.createActionButton(
          bx + btnW / 2,
          by + btnH / 2,
          btnW,
          btnH,
          `[${unit.hotkey}] ${def.name} $${def.cost}`,
          enabled,
          () => {
            EventBus.emit(GameEvents.PRODUCE_UNIT, unit.type, 0);
          },
        );

        idx++;
      }

    } else if (selected.length > 0) {
      // ── Units selected: Show command buttons ──────────────────────────
      this.actionBarBg.setVisible(true);

      const btnW = 130;
      const btnH = 28;
      const gap = 6;
      let idx = 0;

      // Stop button
      this.createActionButton(
        barX + 10 + btnW / 2,
        barY + 10 + idx * (btnH + gap) + btnH / 2,
        btnW,
        btnH,
        '[S] Stop',
        true,
        () => gameScene?.handleStopSelected?.(),
      );
      idx++;

      // Retreat button
      this.createActionButton(
        barX + 10 + btnW / 2,
        barY + 10 + idx * (btnH + gap) + btnH / 2,
        btnW,
        btnH,
        '[R] Retreat',
        true,
        () => gameScene?.handleRetreat?.(),
      );
      idx++;

      // Garrison button
      this.createActionButton(
        barX + 10 + btnW / 2,
        barY + 10 + idx * (btnH + gap) + btnH / 2,
        btnW,
        btnH,
        '[G] Garrison',
        true,
        () => gameScene?.handleGarrison?.(),
      );
      idx++;

      // Check for goods carriers -- show Set Route button
      const hasCarrier = selected.some((s: any) => s.stats.canCarryGoods);
      if (hasCarrier) {
        this.createActionButton(
          barX + 10 + btnW / 2,
          barY + 10 + idx * (btnH + gap) + btnH / 2,
          btnW,
          btnH,
          'Set Route',
          true,
          () => {
            // Route setting would be handled by logistics system
            EventBus.emit(GameEvents.TRANSPORT_GOODS, null, selected.filter((s: any) => s.stats.canCarryGoods));
          },
        );
        idx++;
      }

    } else {
      this.actionBarBg.setVisible(false);
    }
  }

  private createActionButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    enabled: boolean,
    callback: () => void,
  ): void {
    const bg = this.add.rectangle(x, y, width, height, enabled ? 0x335533 : 0x333333, 0.9);
    bg.setDepth(UI_DEPTH + 1);
    bg.setStrokeStyle(1, enabled ? 0x558855 : 0x444444, 0.8);

    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(0x446644, 1));
      bg.on('pointerout', () => bg.setFillStyle(0x335533, 0.9));
      bg.on('pointerdown', () => callback());
    }

    const text = this.add.text(x, y, label, {
      fontSize: '11px',
      fontFamily: FONT_FAMILY,
      color: enabled ? '#FFFFFF' : '#666666',
      fontStyle: 'bold',
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(UI_DEPTH + 2);

    this.actionButtons.push({ background: bg, label: text, callback, enabled });
  }

  private clearActionButtons(): void {
    for (const btn of this.actionButtons) {
      btn.background.destroy();
      btn.label.destroy();
    }
    this.actionButtons = [];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ALERTS (top-right)
  // ═══════════════════════════════════════════════════════════════════════

  private pushAlert(message: string, color: string = '#FFFFFF', flash: boolean = false): void {
    const alertX = VIEWPORT_WIDTH - 300;
    const alertY = 50; // Below resource bar

    // Shift existing alerts down
    for (let i = 0; i < this.alerts.length; i++) {
      const alert = this.alerts[i];
      alert.text.y += 28;
      alert.background.y += 28;
    }

    // Create new alert
    const bg = this.add.rectangle(alertX + 130, alertY + 12, 260, 24, 0x111111, 0.8);
    bg.setDepth(UI_DEPTH + 5);
    bg.setStrokeStyle(1, 0x444444, 0.6);

    const text = this.add.text(alertX + 10, alertY + 12, message, {
      fontSize: '13px',
      fontFamily: FONT_FAMILY,
      color,
      fontStyle: 'bold',
    });
    text.setOrigin(0, 0.5);
    text.setDepth(UI_DEPTH + 6);

    const entry: AlertEntry = {
      text,
      background: bg,
      createdAt: this.time.now,
    };

    this.alerts.unshift(entry);

    // Flashing effect for urgent alerts
    if (flash) {
      this.tweens.add({
        targets: [text],
        alpha: { from: 1, to: 0.3 },
        yoyo: true,
        repeat: 3,
        duration: 200,
      });
    }

    // Fade out after lifetime
    this.time.delayedCall(ALERT_LIFETIME, () => {
      this.tweens.add({
        targets: [text, bg],
        alpha: 0,
        duration: 500,
        onComplete: () => {
          text.destroy();
          bg.destroy();
          const idx = this.alerts.indexOf(entry);
          if (idx !== -1) {
            this.alerts.splice(idx, 1);
          }
        },
      });
    });

    // Cap visible alerts
    while (this.alerts.length > MAX_ALERTS) {
      const old = this.alerts.pop()!;
      old.text.destroy();
      old.background.destroy();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════

  private registerEventListeners(): void {
    // ── Economy events ──────────────────────────────────────────────────
    EventBus.on(GameEvents.CASH_CHANGED, (playerIndex: number, amount: number) => {
      if (playerIndex === 0) {
        this.playerCash = amount;
      }
    });

    EventBus.on(GameEvents.GOODS_CHANGED, (playerIndex: number, amount: number) => {
      if (playerIndex === 0) {
        this.playerGoods = amount;
      }
    });

    EventBus.on(GameEvents.INFLUENCE_CHANGED, (playerIndex: number, amount: number) => {
      if (playerIndex === 0) {
        this.playerInfluence = amount;
      }
    });

    EventBus.on(GameEvents.INCOME_TICK, (playerIndex: number, cashRate: number, goodsRate: number, influenceRate: number) => {
      if (playerIndex === 0) {
        this.incomeRate = cashRate;
        this.goodsRate = goodsRate;
        this.influenceRate = influenceRate;
      }
    });

    // ── Selection events ────────────────────────────────────────────────
    EventBus.on(GameEvents.UNIT_SELECTED, () => {
      this.updateSelectionPanel();
      this.updateActionBar();
    });

    EventBus.on(GameEvents.UNIT_DESELECTED, () => {
      this.updateSelectionPanel();
      this.updateActionBar();
    });

    EventBus.on(GameEvents.BUILDING_SELECTED, () => {
      this.updateSelectionPanel();
      this.updateActionBar();
    });

    EventBus.on(GameEvents.SELECTION_CLEARED, () => {
      this.updateSelectionPanel();
      this.updateActionBar();
    });

    // ── Alert-generating events ─────────────────────────────────────────
    EventBus.on(GameEvents.BUILDING_CAPTURED, (data: any) => {
      if (data.newOwner === 0) {
        this.pushAlert('Building captured!', '#00FF00');
      } else if (data.previousOwner === 0) {
        this.pushAlert('Building lost!', '#FF4444', true);
      }
    });

    EventBus.on(GameEvents.TRUCK_DESTROYED, () => {
      this.pushAlert('Truck destroyed!', '#FF4444', true);
    });

    EventBus.on(GameEvents.TIER_ADVANCED, (playerIndex: number, newTier: number) => {
      if (playerIndex === 0) {
        this.currentTier = newTier;
        this.pushAlert(`Tier ${newTier} reached!`, '#FFD700');
      }
    });

    EventBus.on(GameEvents.COMBAT_STARTED, () => {
      this.pushAlert('Under attack!', '#FF4444', true);
    });

    EventBus.on(GameEvents.SQUAD_WIPED, (squad: any) => {
      if (squad && typeof squad === 'object' && squad.owner === 0) {
        this.pushAlert('Squad wiped!', '#FF4444');
      }
    });

    // ── Minimap toggle ──────────────────────────────────────────────────
    EventBus.on('minimap:toggle', () => {
      this.minimapExpanded = !this.minimapExpanded;
      // Toggle minimap zoom could resize the minimap -- for now just log
    });

    // ── Game over ───────────────────────────────────────────────────────
    EventBus.on(GameEvents.GAME_OVER, (data: any) => {
      const winner = data.winner === 0 ? 'VICTORY' : 'DEFEAT';
      const color = data.winner === 0 ? '#FFD700' : '#FF0000';

      // Show large centered text
      const gameOverText = this.add.text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2, winner, {
        fontSize: '64px',
        fontFamily: FONT_FAMILY,
        color,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 4,
      });
      gameOverText.setOrigin(0.5, 0.5);
      gameOverText.setDepth(UI_DEPTH + 10);

      const reasonText = this.add.text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 + 50, data.reason, {
        fontSize: '18px',
        fontFamily: FONT_FAMILY,
        color: '#CCCCCC',
      });
      reasonText.setOrigin(0.5, 0.5);
      reasonText.setDepth(UI_DEPTH + 10);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TIER UP BUTTON HANDLER
  // ═══════════════════════════════════════════════════════════════════════

  private onTierUpClicked(): void {
    const gameScene = this.gameScene as any;
    if (typeof gameScene?.handleTierAdvance === 'function') {
      gameScene.handleTierAdvance();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════

  update(time: number, delta: number): void {
    // Update resource bar display
    this.updateResourceBar();

    // Update selection panel based on current selection
    this.updateSelectionPanel();

    // Update action bar
    this.updateActionBar();

    // Update minimap periodically
    this.updateMinimap(time);
  }
}
