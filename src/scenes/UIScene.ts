// ─── UI Scene ───────────────────────────────────────────────────────────────
// HUD overlay rendered on top of GameScene with a fixed camera.
// Shows resource bar, minimap, selection panel, action bar, and alerts.

import Phaser from 'phaser';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_COLORS,
  TIER_COSTS,
  STARTING_CASH,
  STARTING_GOODS,
  STARTING_INFLUENCE,
} from '../data/config';
import { UnitType, UNIT_DEFS } from '../data/units';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld, worldToTile } from '../utils/IsometricUtils';

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

// Bottom bar dimensions (AoE2-style unified bottom panel)
const BOTTOM_BAR_HEIGHT = 180;

// Command panel width (fixed)
const COMMAND_PANEL_WIDTH = 310;

// Unit grid (multi-select)
const GRID_ICON_SIZE = 36;
const GRID_ICON_GAP = 4;
const GRID_COLS = 12;
const GRID_ROWS = 3;

// Portrait (single-select)
const PORTRAIT_SIZE = 64;

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

  // Minimap position & size (inside the unified bottom bar)
  private minimapX: number = 5;
  private minimapY: number = 0; // Set dynamically in create/resize

  // ── Bottom bar (unified AoE2-style) ──────────────────────────────────
  private bottomBarBg!: Phaser.GameObjects.Rectangle;
  private bottomBarBorder!: Phaser.GameObjects.Graphics;

  // ── Selection panel elements ──────────────────────────────────────────
  private selectionPanelBg!: Phaser.GameObjects.Rectangle;
  private selectionTexts: Phaser.GameObjects.Text[] = [];
  private selectionGraphics: Phaser.GameObjects.GameObject[] = [];
  private selectionHpBar!: Phaser.GameObjects.Graphics;
  private currentSelection: any = null;
  private selectionType: 'none' | 'unit' | 'building' | 'multi' = 'none';
  private multiSelection: any[] = [];

  // ── Unit grid icons (multi-select, AoE2-style) ────────────────────────
  private unitGridIcons: {
    bg: Phaser.GameObjects.Rectangle;
    hpBar: Phaser.GameObjects.Graphics;
    border: Phaser.GameObjects.Rectangle;
    squad: any;
  }[] = [];

  // ── Action bar elements ───────────────────────────────────────────────
  private actionBarBg!: Phaser.GameObjects.Rectangle;
  private actionButtons: ActionButton[] = [];

  // ── Alerts ────────────────────────────────────────────────────────────
  private alerts: AlertEntry[] = [];

  // ── Game Timer (Feature 3) ──────────────────────────────────────────
  private gameTimer: number = 0;
  private timerText!: Phaser.GameObjects.Text;

  // ── Game Speed Display (Feature 5) ──────────────────────────────────
  private gameSpeedText!: Phaser.GameObjects.Text;
  private currentGameSpeed: number = 1.0;

  // ── Pause Overlay (Feature 4) ──────────────────────────────────────
  private pauseOverlay!: Phaser.GameObjects.Text;
  private isPaused: boolean = false;

  // ── Production Queue UI (Feature 1) ────────────────────────────────
  private productionQueueTexts: Phaser.GameObjects.Text[] = [];
  private productionProgressBar!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'UIScene' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════

  // ── Dynamic layout helpers (depend on current viewport size) ─────────

  /** Current viewport width from the scale manager. */
  private get viewW(): number { return this.scale.width; }
  /** Current viewport height from the scale manager. */
  private get viewH(): number { return this.scale.height; }
  /** Y coordinate where the bottom bar starts. */
  private get bottomBarY(): number { return this.viewH - BOTTOM_BAR_HEIGHT; }
  /** X coordinate of the info panel (center of bottom bar). */
  private get infoPanelX(): number { return MINIMAP_SIZE + 20; }
  /** Width of the info panel (fills space between minimap and command panel). */
  private get infoPanelWidth(): number { return this.viewW - MINIMAP_SIZE - COMMAND_PANEL_WIDTH - 30; }
  /** X coordinate of the command panel (right side of bottom bar). */
  private get commandPanelX(): number { return this.viewW - COMMAND_PANEL_WIDTH - 5; }

  create(): void {
    // Get reference to the game scene
    this.gameScene = this.scene.get('GameScene');

    // Fixed camera -- does not scroll with the game world
    this.cameras.main.setScroll(0, 0);

    // Compute initial minimap Y position
    this.minimapY = this.bottomBarY + (BOTTOM_BAR_HEIGHT - MINIMAP_SIZE) / 2 + 2;

    // Build all UI panels
    this.createResourceBar();
    this.createBottomBar();
    this.createMinimap();
    this.createSelectionPanel();
    this.createActionBar();
    this.createTimerDisplay();
    this.createPauseOverlay();
    this.createProductionQueueUI();

    // Register event listeners
    this.registerEventListeners();

    // ── Resize handler: reposition all UI elements when the window resizes ──
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.handleResize(gameSize.width, gameSize.height);
    });
  }

  /**
   * Reposition all UI elements for the new viewport dimensions.
   * Called whenever the browser window is resized or fullscreen is toggled.
   */
  private handleResize(width: number, height: number): void {
    // Keep the fixed camera at origin
    this.cameras.main.setScroll(0, 0);

    // Recompute minimap Y
    this.minimapY = this.bottomBarY + (BOTTOM_BAR_HEIGHT - MINIMAP_SIZE) / 2 + 2;

    // ── Resource bar (top of screen, full width) ──────────────────────────
    this.resourceBarBg.setPosition(width / 2, RESOURCE_BAR_HEIGHT / 2);
    this.resourceBarBg.setSize(width, RESOURCE_BAR_HEIGHT);

    const textY = RESOURCE_BAR_HEIGHT / 2;
    this.incomeRateText.setPosition(width / 2, textY);
    this.tierText.setPosition(width - 250, textY);
    this.tierButton.setPosition(width - 60, textY);
    this.tierButtonLabel.setPosition(width - 60, textY);

    // ── Bottom bar (full width, anchored to bottom) ──────────────────────
    this.bottomBarBg.setPosition(width / 2, this.bottomBarY + BOTTOM_BAR_HEIGHT / 2);
    this.bottomBarBg.setSize(width, BOTTOM_BAR_HEIGHT);

    // Redraw bottom bar border lines
    this.bottomBarBorder.clear();
    this.bottomBarBorder.lineStyle(2, 0x8B7355, 0.8);
    this.bottomBarBorder.lineBetween(0, this.bottomBarY, width, this.bottomBarY);
    this.bottomBarBorder.lineStyle(1, 0x444444, 0.4);
    this.bottomBarBorder.lineBetween(0, this.bottomBarY + 2, width, this.bottomBarY + 2);
    this.bottomBarBorder.lineStyle(1, 0x555555, 0.6);
    this.bottomBarBorder.lineBetween(
      MINIMAP_SIZE + 15, this.bottomBarY + 5,
      MINIMAP_SIZE + 15, height - 5,
    );
    this.bottomBarBorder.lineBetween(
      this.commandPanelX - 5, this.bottomBarY + 5,
      this.commandPanelX - 5, height - 5,
    );

    // ── Minimap (bottom-left inside bottom bar) ──────────────────────────
    this.minimapBg.setPosition(this.minimapX + MINIMAP_SIZE / 2, this.minimapY + MINIMAP_SIZE / 2);
    this.minimapBorder.setPosition(this.minimapX + MINIMAP_SIZE / 2, this.minimapY + MINIMAP_SIZE / 2);
    this.minimapTexture.setPosition(this.minimapX, this.minimapY);

    // ── Timer and speed display (top bar area) ───────────────────────────
    this.timerText.setPosition(width / 2 + 180, textY);
    this.gameSpeedText.setPosition(width / 2 + 240, textY);

    // ── Pause overlay (center of screen) ─────────────────────────────────
    this.pauseOverlay.setPosition(width / 2, height / 2);

    // ── Alerts (top-right) ────────────────────────────────────────────────
    // Alerts are ephemeral and will be created at the new positions naturally.
    // We reposition any existing alerts.
    const alertX = width - 300;
    for (const alert of this.alerts) {
      alert.background.x = alertX + 130;
      alert.text.x = alertX + 10;
    }

    // ── Refresh selection panel and action bar for new layout ─────────────
    this.updateSelectionPanel();
    this.updateActionBar();
    this.updateProductionQueueUI();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RESOURCE BAR (top of screen)
  // ═══════════════════════════════════════════════════════════════════════

  private createResourceBar(): void {
    // Background
    this.resourceBarBg = this.add.rectangle(
      this.viewW / 2,
      RESOURCE_BAR_HEIGHT / 2,
      this.viewW,
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
    this.incomeRateText = this.add.text(this.viewW / 2, textY, '+$0/min  +0g/min  +0i/min', {
      fontSize: '13px',
      fontFamily: FONT_FAMILY,
      color: '#AAAAAA',
    });
    this.incomeRateText.setOrigin(0.5, 0.5);
    this.incomeRateText.setDepth(UI_DEPTH + 1);

    // ── Right section: Tier info and button ──────────────────────────────
    this.tierText = this.add.text(this.viewW - 250, textY, 'TIER 1: Street Crew', {
      fontSize: '14px',
      fontFamily: FONT_FAMILY,
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    this.tierText.setOrigin(0, 0.5);
    this.tierText.setDepth(UI_DEPTH + 1);

    // Tier-up button
    this.tierButton = this.add.rectangle(
      this.viewW - 60,
      textY,
      100,
      28,
      0x336633,
      0.9,
    );
    this.tierButton.setDepth(UI_DEPTH + 1);
    this.tierButton.setInteractive({ useHandCursor: true });
    this.tierButton.on('pointerdown', () => this.onTierUpClicked());

    this.tierButtonLabel = this.add.text(this.viewW - 60, textY, 'TIER UP', {
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
  // BOTTOM BAR (unified AoE2-style panel)
  // ═══════════════════════════════════════════════════════════════════════

  private createBottomBar(): void {
    // Full-width dark background for the bottom panel
    this.bottomBarBg = this.add.rectangle(
      this.viewW / 2,
      this.bottomBarY + BOTTOM_BAR_HEIGHT / 2,
      this.viewW,
      BOTTOM_BAR_HEIGHT,
      0x0d0d0d,
      0.92,
    );
    this.bottomBarBg.setDepth(UI_DEPTH - 1);

    // Decorative top border (gold line like AoE2)
    this.bottomBarBorder = this.add.graphics();
    this.bottomBarBorder.setDepth(UI_DEPTH + 3);
    this.bottomBarBorder.lineStyle(2, 0x8B7355, 0.8);
    this.bottomBarBorder.lineBetween(0, this.bottomBarY, this.viewW, this.bottomBarY);
    // Subtle inner line
    this.bottomBarBorder.lineStyle(1, 0x444444, 0.4);
    this.bottomBarBorder.lineBetween(0, this.bottomBarY + 2, this.viewW, this.bottomBarY + 2);

    // Vertical divider after minimap
    this.bottomBarBorder.lineStyle(1, 0x555555, 0.6);
    this.bottomBarBorder.lineBetween(
      MINIMAP_SIZE + 15, this.bottomBarY + 5,
      MINIMAP_SIZE + 15, this.viewH - 5,
    );

    // Vertical divider before command panel
    this.bottomBarBorder.lineBetween(
      this.commandPanelX - 5, this.bottomBarY + 5,
      this.commandPanelX - 5, this.viewH - 5,
    );
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

  // ── Isometric minimap projection helpers ─────────────────────────────
  // Maps tile coords (tx, ty) into minimap pixel coords.
  // The diamond top is at (MAP_WIDTH/2, 0), right at (MAP_WIDTH, MAP_HEIGHT/2),
  // bottom at (MAP_WIDTH/2, MAP_HEIGHT), left at (0, MAP_HEIGHT/2).
  // We scale so the full diamond fits inside the MINIMAP_SIZE square.

  private tileToMinimap(tx: number, ty: number): { mx: number; my: number } {
    // Isometric projection: rotate tile grid 45 degrees
    const isoX = (tx - ty);          // range: -MAP_HEIGHT .. +MAP_WIDTH
    const isoY = (tx + ty);          // range: 0 .. MAP_WIDTH+MAP_HEIGHT

    // Scale to fit within MINIMAP_SIZE pixels
    // isoX range = MAP_WIDTH + MAP_HEIGHT (total span), center at 0
    // isoY range = MAP_WIDTH + MAP_HEIGHT (total span), starts at 0
    const span = MAP_WIDTH + MAP_HEIGHT; // 320 for 160x160

    const mx = (isoX / span) * MINIMAP_SIZE + MINIMAP_SIZE / 2;
    const my = (isoY / span) * MINIMAP_SIZE;

    return { mx, my };
  }

  private minimapToTile(mx: number, my: number): { tx: number; ty: number } {
    // Reverse the isometric projection
    const span = MAP_WIDTH + MAP_HEIGHT;

    const isoX = ((mx - MINIMAP_SIZE / 2) / MINIMAP_SIZE) * span;
    const isoY = (my / MINIMAP_SIZE) * span;

    // isoX = tx - ty, isoY = tx + ty  =>  tx = (isoX + isoY) / 2, ty = (isoY - isoX) / 2
    const tx = (isoX + isoY) / 2;
    const ty = (isoY - isoX) / 2;

    return { tx, ty };
  }

  private updateMinimap(time: number): void {
    // Only update periodically to save performance
    if (time - this.minimapLastUpdate < MINIMAP_UPDATE_INTERVAL) {
      this.updateMinimapViewport(); // Always update viewport rectangle
      return;
    }
    this.minimapLastUpdate = time;

    // Clear and redraw
    this.minimapTexture.clear();

    // Draw terrain using a temporary graphics object
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);

    // Draw a simplified terrain view (isometric diamond projection)
    // Sample every few tiles for performance
    const step = Math.max(1, Math.floor(MAP_WIDTH / (MINIMAP_SIZE / 2)));

    const gameScene = this.gameScene as any;
    const mapSystem = gameScene?.mapSystem;

    // Get fog of war visibility grid for current player (player 0)
    const fogSystem = gameScene?.fogOfWarSystem;
    const fogGrid: Uint8Array | null = fogSystem?.visibility?.[0] ?? null;

    if (mapSystem) {
      for (let ty = 0; ty < MAP_HEIGHT; ty += step) {
        for (let tx = 0; tx < MAP_WIDTH; tx += step) {
          // Respect fog of war: skip unexplored tiles entirely
          const vis = fogGrid ? fogGrid[ty * MAP_WIDTH + tx] : 2;
          if (vis === 0) continue; // Unexplored — black/hidden

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

          // Dim explored (but not currently visible) tiles
          const alpha = vis === 1 ? 0.5 : 1;

          // Project tile position to isometric minimap space
          const { mx, my } = this.tileToMinimap(tx, ty);
          const pw = Math.max(1, Math.ceil(step * MINIMAP_SIZE / (MAP_WIDTH + MAP_HEIGHT)));
          const ph = pw;

          gfx.fillStyle(color, alpha);
          gfx.fillRect(Math.floor(mx), Math.floor(my), pw, ph);
        }
      }
    }

    // Draw buildings as colored dots (isometric projection, fog-aware)
    const buildingSystem = gameScene?.buildingSystem;
    if (buildingSystem) {
      for (const building of buildingSystem.buildings.values()) {
        // Skip buildings in unexplored fog
        const bVis = fogGrid ? fogGrid[building.tileY * MAP_WIDTH + building.tileX] : 2;
        if (bVis === 0) continue;

        let bColor: number;
        if (building.owner === -1) {
          bColor = PLAYER_COLORS.neutral;
        } else {
          bColor = (PLAYER_COLORS as Record<number, number>)[building.owner] ?? PLAYER_COLORS.neutral;
        }

        const { mx, my } = this.tileToMinimap(building.tileX, building.tileY);
        const bw = Math.max(2, Math.ceil(building.stats.widthTiles * 1.5));
        const bh = Math.max(2, Math.ceil(building.stats.heightTiles * 1.5));

        gfx.fillStyle(bColor, bVis === 1 ? 0.5 : 1);
        gfx.fillRect(Math.floor(mx) - 1, Math.floor(my) - 1, bw, bh);
      }
    }

    // Draw units as bright dots (isometric projection, only visible ones)
    const unitSystem = gameScene?.unitSystem;
    if (unitSystem) {
      for (const squad of unitSystem.squads.values()) {
        // Only show own units or enemy units in visible (not just explored) tiles
        const sVis = fogGrid ? fogGrid[squad.tileY * MAP_WIDTH + squad.tileX] : 2;
        if (squad.owner !== 0 && sVis !== 2) continue;

        const uColor = (PLAYER_COLORS as Record<number, number>)[squad.owner] ?? 0xFFFFFF;
        const { mx, my } = this.tileToMinimap(squad.tileX, squad.tileY);

        // Make unit dots bright and slightly larger
        gfx.fillStyle(uColor, 1);
        gfx.fillRect(Math.floor(mx) - 1, Math.floor(my) - 1, 3, 3);
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
    const wv = cam.worldView;

    // Get the four corners of the camera's world view
    const corners = [
      { wx: wv.x, wy: wv.y },                           // top-left
      { wx: wv.x + wv.width, wy: wv.y },                // top-right
      { wx: wv.x + wv.width, wy: wv.y + wv.height },    // bottom-right
      { wx: wv.x, wy: wv.y + wv.height },                // bottom-left
    ];

    // Convert each corner from world coords to tile coords, then to minimap coords
    const mmCorners = corners.map(c => {
      const tile = worldToTile(c.wx, c.wy);
      const mm = this.tileToMinimap(tile.x, tile.y);
      return { x: this.minimapX + mm.mx, y: this.minimapY + mm.my };
    });

    // Draw the viewport as a quadrilateral (camera rect becomes a rotated shape in iso minimap)
    this.minimapViewport.lineStyle(1, 0xFFFFFF, 0.9);
    this.minimapViewport.beginPath();
    this.minimapViewport.moveTo(mmCorners[0].x, mmCorners[0].y);
    this.minimapViewport.lineTo(mmCorners[1].x, mmCorners[1].y);
    this.minimapViewport.lineTo(mmCorners[2].x, mmCorners[2].y);
    this.minimapViewport.lineTo(mmCorners[3].x, mmCorners[3].y);
    this.minimapViewport.closePath();
    this.minimapViewport.strokePath();
  }

  private onMinimapClick(pointer: Phaser.Input.Pointer): void {
    // Convert minimap click position to local minimap coords
    const localX = pointer.x - this.minimapX;
    const localY = pointer.y - this.minimapY;

    // Reverse the isometric minimap projection to get tile coords
    const { tx, ty } = this.minimapToTile(localX, localY);

    // Clamp to map bounds — ignore clicks outside the diamond
    const clampedTx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(tx)));
    const clampedTy = Math.max(0, Math.min(MAP_HEIGHT - 1, Math.round(ty)));

    // Convert tile coords to world pixel position using the isometric projection
    const worldPos = tileToWorld(clampedTx, clampedTy);

    // Center the game camera on this world position
    const gameScene = this.gameScene as any;
    if (gameScene?.cameras?.main) {
      gameScene.cameras.main.centerOn(worldPos.x, worldPos.y);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SELECTION PANEL (bottom-center)
  // ═══════════════════════════════════════════════════════════════════════

  private createSelectionPanel(): void {
    // The selection panel sits in the center of the bottom bar (no separate bg needed,
    // the unified bottom bar provides the background)
    this.selectionPanelBg = this.add.rectangle(0, 0, 1, 1, 0, 0);
    this.selectionPanelBg.setVisible(false);

    // HP bar graphics
    this.selectionHpBar = this.add.graphics();
    this.selectionHpBar.setDepth(UI_DEPTH + 1);
    this.selectionHpBar.setVisible(false);
  }

  private updateSelectionPanel(): void {
    // Clear previous elements
    for (const text of this.selectionTexts) {
      text.destroy();
    }
    this.selectionTexts = [];
    for (const gfx of this.selectionGraphics) {
      gfx.destroy();
    }
    this.selectionGraphics = [];
    this.clearUnitGrid();
    this.selectionHpBar.clear();
    this.selectionHpBar.setVisible(false);

    const panelX = this.infoPanelX;
    const panelY = this.bottomBarY + 8;
    const panelW = this.infoPanelWidth;

    const gameScene = this.gameScene as any;
    const unitSystem = gameScene?.unitSystem;
    const selected = unitSystem?.selectedSquads ?? [];
    const selectedBuilding = gameScene?.selectedBuilding;

    if (selected.length === 1) {
      // ══════════════════════════════════════════════════════════════════
      // SINGLE UNIT — AoE2-style portrait + stats
      // ══════════════════════════════════════════════════════════════════
      this.selectionType = 'unit';
      this.currentSelection = selected[0];

      const squad = selected[0];
      const stats = squad.stats;

      // ── Portrait box (left side) ──────────────────────────────────────
      const portraitX = panelX + 5;
      const portraitY = panelY + 5;
      const portraitBorder = this.add.rectangle(
        portraitX + PORTRAIT_SIZE / 2,
        portraitY + PORTRAIT_SIZE / 2,
        PORTRAIT_SIZE + 4, PORTRAIT_SIZE + 4,
        0x222222, 0.9,
      );
      portraitBorder.setStrokeStyle(2, 0x8B7355, 0.9);
      portraitBorder.setDepth(UI_DEPTH + 1);
      this.selectionGraphics.push(portraitBorder);

      // Portrait fill (unit color)
      const portrait = this.add.rectangle(
        portraitX + PORTRAIT_SIZE / 2,
        portraitY + PORTRAIT_SIZE / 2,
        PORTRAIT_SIZE, PORTRAIT_SIZE,
        stats.color, 0.7,
      );
      portrait.setDepth(UI_DEPTH + 1);
      this.selectionGraphics.push(portrait);

      // Unit type initial in portrait
      const initial = this.add.text(
        portraitX + PORTRAIT_SIZE / 2,
        portraitY + PORTRAIT_SIZE / 2 - 4,
        stats.isVehicle ? 'V' : stats.name.charAt(0),
        { fontSize: '28px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold' },
      );
      initial.setOrigin(0.5, 0.5);
      initial.setDepth(UI_DEPTH + 2);
      this.selectionTexts.push(initial);

      // Members count below initial
      const memLabel = this.add.text(
        portraitX + PORTRAIT_SIZE / 2,
        portraitY + PORTRAIT_SIZE / 2 + 18,
        `${squad.members}/${stats.squadSize}`,
        { fontSize: '11px', fontFamily: FONT_FAMILY, color: '#CCCCCC' },
      );
      memLabel.setOrigin(0.5, 0.5);
      memLabel.setDepth(UI_DEPTH + 2);
      this.selectionTexts.push(memLabel);

      // ── Info section (right of portrait) ──────────────────────────────
      const infoX = portraitX + PORTRAIT_SIZE + 14;
      const infoW = panelW - PORTRAIT_SIZE - 24;

      // Unit name
      const nameText = this.add.text(infoX, panelY + 5, stats.name, {
        fontSize: '16px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold',
      });
      nameText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(nameText);

      // State + Tier badge
      const stateColor = squad.state === 'idle' ? '#88FF88' : squad.state === 'attacking' ? '#FF6666' : '#FFCC44';
      const stateText = this.add.text(infoX, panelY + 24, `T${stats.tier}  ${squad.state.toUpperCase()}`, {
        fontSize: '11px', fontFamily: FONT_FAMILY, color: stateColor,
      });
      stateText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(stateText);

      // Veterancy stars
      const stars = '\u2605'.repeat(squad.veterancy) + '\u2606'.repeat(3 - squad.veterancy);
      const vetText = this.add.text(infoX + 100, panelY + 24, stars, {
        fontSize: '12px', fontFamily: FONT_FAMILY, color: '#FFD700',
      });
      vetText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(vetText);

      // HP bar
      this.drawSelectionHpBar(infoX, panelY + 42, infoW, 10, squad.hp, squad.maxHp);

      const hpLabel = this.add.text(infoX, panelY + 55, `${Math.ceil(squad.hp)} / ${squad.maxHp}`, {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#AAAAAA',
      });
      hpLabel.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(hpLabel);

      // ── Stat grid (AoE2-style rows) ───────────────────────────────────
      const statY = panelY + 72;
      const totalDps = squad.members * stats.dpsPerMember;
      const vetMult = 1 + squad.veterancy * 0.1;

      const statRows = [
        { icon: '\u2694', label: 'Attack', value: `${(totalDps * vetMult).toFixed(1)} DPS`, color: '#FF8888' },
        { icon: '\u25CE', label: 'Range', value: `${stats.range} tiles`, color: '#88AAFF' },
        { icon: '\u2192', label: 'Speed', value: `${stats.speed} t/s`, color: '#88FF88' },
        { icon: '\u25C9', label: 'Sight', value: `${stats.sightRange} tiles`, color: '#FFCC44' },
      ];

      for (let i = 0; i < statRows.length; i++) {
        const row = statRows[i];
        const col = i % 2;
        const rowIdx = Math.floor(i / 2);
        const sx = infoX + col * (infoW / 2);
        const sy = statY + rowIdx * 18;

        const iconText = this.add.text(sx, sy, `${row.icon} ${row.label}: `, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: '#888888',
        });
        iconText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(iconText);

        const valText = this.add.text(sx + 75, sy, row.value, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: row.color, fontStyle: 'bold',
        });
        valText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(valText);
      }

      // Carrying goods (if applicable)
      if (stats.canCarryGoods) {
        const goodsText = this.add.text(infoX, statY + 40, `Cargo: ${squad.carryingGoods}/${stats.goodsCapacity} goods`, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: '#CD853F',
        });
        goodsText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(goodsText);
      }

      // Description
      const descText = this.add.text(infoX, panelY + BOTTOM_BAR_HEIGHT - 35, stats.description, {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#666666', fontStyle: 'italic',
        wordWrap: { width: infoW },
      });
      descText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(descText);

    } else if (selected.length > 1) {
      // ══════════════════════════════════════════════════════════════════
      // MULTI-SELECT — AoE2-style unit icon grid
      // ══════════════════════════════════════════════════════════════════
      this.selectionType = 'multi';
      this.multiSelection = selected;

      // Header
      const countText = this.add.text(panelX + 5, panelY + 2, `${selected.length} Units Selected`, {
        fontSize: '13px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold',
      });
      countText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(countText);

      // Type summary text (compact)
      const typeCount = new Map<string, number>();
      for (const squad of selected) {
        const name = squad.stats.name;
        typeCount.set(name, (typeCount.get(name) ?? 0) + 1);
      }
      const summary = Array.from(typeCount.entries()).map(([n, c]) => `${n} x${c}`).join('  |  ');
      const summaryText = this.add.text(panelX + 5, panelY + 18, summary, {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#999999',
      });
      summaryText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(summaryText);

      // ── Unit icon grid ────────────────────────────────────────────────
      const gridStartX = panelX + 5;
      const gridStartY = panelY + 34;
      const maxVisible = GRID_COLS * GRID_ROWS;

      for (let i = 0; i < Math.min(selected.length, maxVisible); i++) {
        const squad = selected[i];
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        const iconX = gridStartX + col * (GRID_ICON_SIZE + GRID_ICON_GAP);
        const iconY = gridStartY + row * (GRID_ICON_SIZE + GRID_ICON_GAP + 2);

        this.createUnitGridIcon(iconX, iconY, squad, unitSystem);
      }

      // Overflow indicator
      if (selected.length > maxVisible) {
        const moreText = this.add.text(
          gridStartX + GRID_COLS * (GRID_ICON_SIZE + GRID_ICON_GAP) + 5,
          gridStartY,
          `+${selected.length - maxVisible}`,
          { fontSize: '12px', fontFamily: FONT_FAMILY, color: '#FFCC44', fontStyle: 'bold' },
        );
        moreText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(moreText);
      }

    } else if (selectedBuilding) {
      // ══════════════════════════════════════════════════════════════════
      // BUILDING SELECTED — Enhanced view
      // ══════════════════════════════════════════════════════════════════
      this.selectionType = 'building';
      this.currentSelection = selectedBuilding;

      const building = selectedBuilding;
      const stats = building.stats;

      // Portrait box
      const portraitX = panelX + 5;
      const portraitY = panelY + 5;
      const ownerColor = building.owner === -1 ? 0x888888 :
        building.owner === 0 ? 0xCC0000 : 0x0044CC;

      const portraitBorder = this.add.rectangle(
        portraitX + PORTRAIT_SIZE / 2, portraitY + PORTRAIT_SIZE / 2,
        PORTRAIT_SIZE + 4, PORTRAIT_SIZE + 4,
        0x222222, 0.9,
      );
      portraitBorder.setStrokeStyle(2, ownerColor, 0.9);
      portraitBorder.setDepth(UI_DEPTH + 1);
      this.selectionGraphics.push(portraitBorder);

      const portrait = this.add.rectangle(
        portraitX + PORTRAIT_SIZE / 2, portraitY + PORTRAIT_SIZE / 2,
        PORTRAIT_SIZE, PORTRAIT_SIZE,
        0x2a1f14, 0.8,
      );
      portrait.setDepth(UI_DEPTH + 1);
      this.selectionGraphics.push(portrait);

      const bldgIcon = this.add.text(
        portraitX + PORTRAIT_SIZE / 2, portraitY + PORTRAIT_SIZE / 2,
        'B', { fontSize: '28px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold' },
      );
      bldgIcon.setOrigin(0.5, 0.5);
      bldgIcon.setDepth(UI_DEPTH + 2);
      this.selectionTexts.push(bldgIcon);

      // Info section
      const infoX = portraitX + PORTRAIT_SIZE + 14;
      const infoW = panelW - PORTRAIT_SIZE - 24;

      const nameText = this.add.text(infoX, panelY + 5, stats.name, {
        fontSize: '16px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold',
      });
      nameText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(nameText);

      const ownerName = building.owner === -1 ? 'Neutral' : building.owner === 0 ? 'Player' : 'Enemy';
      const infoText = this.add.text(infoX, panelY + 24, `T${stats.tier}  |  ${ownerName}`, {
        fontSize: '11px', fontFamily: FONT_FAMILY, color: '#AAAAAA',
      });
      infoText.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(infoText);

      // HP bar
      this.drawSelectionHpBar(infoX, panelY + 42, infoW, 10, building.hp, building.maxHp);

      const hpLabel = this.add.text(infoX, panelY + 55, `${Math.ceil(building.hp)} / ${building.maxHp}`, {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#AAAAAA',
      });
      hpLabel.setDepth(UI_DEPTH + 1);
      this.selectionTexts.push(hpLabel);

      // Stat rows
      const statY = panelY + 72;
      const buildingStats = [
        { label: 'Cash', value: `$${stats.cashPerMin}/min`, color: '#FFD700' },
        { label: 'Goods', value: `${stats.goodsPerMin}/min`, color: '#CD853F' },
        { label: 'Influence', value: `${stats.influencePerMin}/min`, color: '#6495ED' },
      ];

      for (let i = 0; i < buildingStats.length; i++) {
        const s = buildingStats[i];
        const sx = infoX + i * (infoW / 3);
        const statLabel = this.add.text(sx, statY, `${s.label}: ${s.value}`, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: s.color,
        });
        statLabel.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(statLabel);
      }

      // Goods stored
      if (stats.canStoreGoods) {
        const goodsText = this.add.text(infoX, statY + 18, `Storage: ${building.goodsStored}/${stats.goodsStorage} goods`, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: '#CD853F',
        });
        goodsText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(goodsText);
      }

      // Garrison status
      if (stats.canGarrison) {
        const garrisonText = this.add.text(infoX, statY + (stats.canStoreGoods ? 36 : 18),
          `Garrison: ${building.garrisonedSquads.length}/${stats.garrisonSlots}`, {
          fontSize: '11px', fontFamily: FONT_FAMILY, color: '#88AAFF',
        });
        garrisonText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(garrisonText);
      }

      // Capture progress
      if (building.isBeingCaptured) {
        const captureText = this.add.text(infoX, panelY + BOTTOM_BAR_HEIGHT - 35,
          `CAPTURING: ${Math.floor(building.captureProgress * 100)}%`, {
          fontSize: '12px', fontFamily: FONT_FAMILY, color: '#FFD700', fontStyle: 'bold',
        });
        captureText.setDepth(UI_DEPTH + 1);
        this.selectionTexts.push(captureText);
      }

    } else {
      // ══════════════════════════════════════════════════════════════════
      // NOTHING SELECTED
      // ══════════════════════════════════════════════════════════════════
      this.selectionType = 'none';
      this.currentSelection = null;
    }
  }

  // ── Unit grid icon (AoE2-style clickable unit box in multi-select) ──

  private createUnitGridIcon(x: number, y: number, squad: any, unitSystem: any): void {
    // Icon background
    const bg = this.add.rectangle(
      x + GRID_ICON_SIZE / 2,
      y + GRID_ICON_SIZE / 2,
      GRID_ICON_SIZE, GRID_ICON_SIZE,
      squad.stats.color, 0.5,
    );
    bg.setDepth(UI_DEPTH + 1);

    // Border (gold for healthy, red for low HP)
    const hpRatio = squad.hp / squad.maxHp;
    const borderColor = hpRatio > 0.5 ? 0x8B7355 : hpRatio > 0.25 ? 0xCCCC00 : 0xCC0000;
    const border = this.add.rectangle(
      x + GRID_ICON_SIZE / 2,
      y + GRID_ICON_SIZE / 2,
      GRID_ICON_SIZE + 2, GRID_ICON_SIZE + 2,
      0, 0,
    );
    border.setStrokeStyle(1, borderColor, 0.8);
    border.setDepth(UI_DEPTH + 2);

    // Unit type letter
    const letter = this.add.text(
      x + GRID_ICON_SIZE / 2,
      y + GRID_ICON_SIZE / 2 - 3,
      squad.stats.isVehicle ? 'V' : squad.stats.name.charAt(0),
      { fontSize: '14px', fontFamily: FONT_FAMILY, color: '#FFFFFF', fontStyle: 'bold' },
    );
    letter.setOrigin(0.5, 0.5);
    letter.setDepth(UI_DEPTH + 2);
    this.selectionTexts.push(letter);

    // Members count
    const memText = this.add.text(
      x + GRID_ICON_SIZE / 2,
      y + GRID_ICON_SIZE / 2 + 10,
      `${squad.members}`,
      { fontSize: '9px', fontFamily: FONT_FAMILY, color: '#CCCCCC' },
    );
    memText.setOrigin(0.5, 0.5);
    memText.setDepth(UI_DEPTH + 2);
    this.selectionTexts.push(memText);

    // Tiny HP bar below icon
    const hpBar = this.add.graphics();
    hpBar.setDepth(UI_DEPTH + 2);
    const hpBarY = y + GRID_ICON_SIZE + 1;
    hpBar.fillStyle(0x333333, 0.9);
    hpBar.fillRect(x, hpBarY, GRID_ICON_SIZE, 3);
    const hpColor = hpRatio > 0.6 ? 0x00CC00 : hpRatio > 0.3 ? 0xCCCC00 : 0xCC0000;
    hpBar.fillStyle(hpColor, 1);
    hpBar.fillRect(x, hpBarY, GRID_ICON_SIZE * hpRatio, 3);

    // Make interactive: click to select just this unit
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
      border.setStrokeStyle(2, 0x00FF00, 1);
    });
    bg.on('pointerout', () => {
      border.setStrokeStyle(1, borderColor, 0.8);
    });
    bg.on('pointerdown', () => {
      if (unitSystem) {
        unitSystem.deselectAll();
        unitSystem.selectSquad(squad);
      }
    });

    this.unitGridIcons.push({ bg, hpBar, border, squad });
  }

  private clearUnitGrid(): void {
    for (const icon of this.unitGridIcons) {
      icon.bg.destroy();
      icon.hpBar.destroy();
      icon.border.destroy();
    }
    this.unitGridIcons = [];
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
    // Action bar sits in the right section of the unified bottom bar
    // No separate background needed — bottom bar provides it
    this.actionBarBg = this.add.rectangle(0, 0, 1, 1, 0, 0);
    this.actionBarBg.setVisible(false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GAME TIMER & SPEED DISPLAY (Feature 3 & 5)
  // ═══════════════════════════════════════════════════════════════════════

  private createTimerDisplay(): void {
    const textY = RESOURCE_BAR_HEIGHT / 2;

    // Game timer -- top-center-right area (between income rates and tier display)
    this.timerText = this.add.text(this.viewW / 2 + 180, textY, '00:00', {
      fontSize: '14px',
      fontFamily: FONT_FAMILY,
      color: '#FFFFFF',
      fontStyle: 'bold',
    });
    this.timerText.setOrigin(0.5, 0.5);
    this.timerText.setDepth(UI_DEPTH + 1);

    // Game speed display -- right of timer
    this.gameSpeedText = this.add.text(this.viewW / 2 + 240, textY, '1.0x', {
      fontSize: '13px',
      fontFamily: FONT_FAMILY,
      color: '#88FF88',
    });
    this.gameSpeedText.setOrigin(0.5, 0.5);
    this.gameSpeedText.setDepth(UI_DEPTH + 1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAUSE OVERLAY (Feature 4)
  // ═══════════════════════════════════════════════════════════════════════

  private createPauseOverlay(): void {
    this.pauseOverlay = this.add.text(this.viewW / 2, this.viewH / 2, 'PAUSED', {
      fontSize: '48px',
      fontFamily: FONT_FAMILY,
      color: '#FFFFFF',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
    });
    this.pauseOverlay.setOrigin(0.5, 0.5);
    this.pauseOverlay.setDepth(UI_DEPTH + 20);
    this.pauseOverlay.setVisible(false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTION QUEUE UI (Feature 1)
  // ═══════════════════════════════════════════════════════════════════════

  private createProductionQueueUI(): void {
    this.productionProgressBar = this.add.graphics();
    this.productionProgressBar.setDepth(UI_DEPTH + 1);
    this.productionProgressBar.setVisible(false);
  }

  private updateProductionQueueUI(): void {
    // Clear previous queue text elements
    for (const text of this.productionQueueTexts) {
      text.destroy();
    }
    this.productionQueueTexts = [];
    this.productionProgressBar.clear();
    this.productionProgressBar.setVisible(false);

    const gameScene = this.gameScene as any;
    const selectedBuilding = gameScene?.selectedBuilding;

    if (!selectedBuilding || !selectedBuilding.stats.canProduceUnits || selectedBuilding.owner !== 0) {
      return;
    }

    const queue = selectedBuilding.getQueue();
    if (!queue || queue.length === 0) return;

    const barX = this.commandPanelX;
    const barY = this.bottomBarY + 8;

    // Draw production queue below the production buttons
    const queueStartX = barX + 5;
    const queueStartY = barY + 130;

    // "Queue:" label
    const queueLabel = this.add.text(queueStartX, queueStartY, 'Queue:', {
      fontSize: '12px',
      fontFamily: FONT_FAMILY,
      color: '#AAAAAA',
      fontStyle: 'bold',
    });
    queueLabel.setDepth(UI_DEPTH + 2);
    this.productionQueueTexts.push(queueLabel);

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const unitDef = UNIT_DEFS[entry.unitType as keyof typeof UNIT_DEFS];
      const name = unitDef ? unitDef.name : entry.unitType;
      const yPos = queueStartY + 18 + i * 20;

      if (i === 0) {
        // Currently producing -- show progress
        const progress = Math.min(1, entry.progress / entry.totalTime);
        const progressPct = Math.floor(progress * 100);

        const text = this.add.text(queueStartX, yPos, `> ${name} (${progressPct}%)`, {
          fontSize: '11px',
          fontFamily: FONT_FAMILY,
          color: '#00FF00',
        });
        text.setDepth(UI_DEPTH + 2);
        this.productionQueueTexts.push(text);

        // Draw progress bar
        const pbX = queueStartX;
        const pbY = yPos + 14;
        const pbW = COMMAND_PANEL_WIDTH - 20;
        const pbH = 4;

        this.productionProgressBar.setVisible(true);
        this.productionProgressBar.fillStyle(0x333333, 0.9);
        this.productionProgressBar.fillRect(pbX, pbY, pbW, pbH);
        this.productionProgressBar.fillStyle(0x00CC00, 1);
        this.productionProgressBar.fillRect(pbX, pbY, pbW * progress, pbH);
      } else {
        // Queued -- show with cancel hint
        const text = this.add.text(queueStartX, yPos, `  ${i + 1}. ${name}`, {
          fontSize: '11px',
          fontFamily: FONT_FAMILY,
          color: '#CCCCCC',
        });
        text.setDepth(UI_DEPTH + 2);
        this.productionQueueTexts.push(text);
      }
    }

    // Rally point indicator
    if (selectedBuilding.rallyPoint) {
      const rpText = this.add.text(
        queueStartX,
        queueStartY + 18 + queue.length * 20 + 4,
        `Rally: (${selectedBuilding.rallyPoint.x}, ${selectedBuilding.rallyPoint.y})`,
        {
          fontSize: '10px',
          fontFamily: FONT_FAMILY,
          color: '#88AAFF',
        },
      );
      rpText.setDepth(UI_DEPTH + 2);
      this.productionQueueTexts.push(rpText);
    }
  }

  private updateActionBar(): void {
    // Clear existing buttons
    this.clearActionButtons();

    const barX = this.commandPanelX;
    const barY = this.bottomBarY + 8;

    const gameScene = this.gameScene as any;
    const unitSystem = gameScene?.unitSystem;
    const selected = unitSystem?.selectedSquads ?? [];
    const selectedBuilding = gameScene?.selectedBuilding;

    if (selectedBuilding && selectedBuilding.stats.canProduceUnits && selectedBuilding.owner === 0) {
      // ── Compound selected: Show unit production buttons (AoE2 grid) ──

      // Section label
      const label = this.add.text(barX + 5, barY - 2, 'PRODUCE', {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#8B7355', fontStyle: 'bold',
      });
      label.setDepth(UI_DEPTH + 2);
      this.actionButtons.push({ background: label as any, label: label, callback: () => {}, enabled: true });

      const produceableUnits = [
        { type: UnitType.RUNNER, hotkey: 'C-Q' },
        { type: UnitType.THUG, hotkey: '' },
        { type: UnitType.ENFORCER, hotkey: 'C-E' },
        { type: UnitType.ARSONIST, hotkey: '' },
        { type: UnitType.LOOKOUT, hotkey: '' },
      ];

      // AoE2-style grid: 3 columns × 2 rows of square buttons
      const btnSize = 52;
      const gap = 4;
      const gridX = barX + 5;
      const gridY = barY + 14;

      for (let i = 0; i < produceableUnits.length; i++) {
        const unit = produceableUnits[i];
        const def = UNIT_DEFS[unit.type];
        const col = i % 3;
        const row = Math.floor(i / 3);
        const bx = gridX + col * (btnSize + gap) + btnSize / 2;
        const by = gridY + row * (btnSize + gap) + btnSize / 2;
        const canAfford = this.playerCash >= def.cost;
        const tierOk = def.tier <= this.currentTier;
        const enabled = canAfford && tierOk;

        // Square button with unit color
        const bg = this.add.rectangle(bx, by, btnSize, btnSize, enabled ? 0x1a1a1a : 0x0d0d0d, 0.9);
        bg.setDepth(UI_DEPTH + 1);
        bg.setStrokeStyle(1, enabled ? 0x8B7355 : 0x333333, 0.8);

        // Unit color swatch
        const swatch = this.add.rectangle(bx, by - 8, btnSize - 12, 18, def.color, enabled ? 0.6 : 0.2);
        swatch.setDepth(UI_DEPTH + 2);
        this.selectionGraphics.push(swatch);

        // Unit name (abbreviated)
        const shortName = def.name.split(' ')[0].substring(0, 6);
        const nameLabel = this.add.text(bx, by + 8, shortName, {
          fontSize: '9px', fontFamily: FONT_FAMILY, color: enabled ? '#CCCCCC' : '#555555',
        });
        nameLabel.setOrigin(0.5, 0.5);
        nameLabel.setDepth(UI_DEPTH + 2);

        // Cost
        const costLabel = this.add.text(bx, by + 20, `$${def.cost}`, {
          fontSize: '9px', fontFamily: FONT_FAMILY, color: enabled ? '#FFD700' : '#444444',
        });
        costLabel.setOrigin(0.5, 0.5);
        costLabel.setDepth(UI_DEPTH + 2);

        if (enabled) {
          bg.setInteractive({ useHandCursor: true });
          bg.on('pointerover', () => bg.setStrokeStyle(2, 0x00FF00, 1));
          bg.on('pointerout', () => bg.setStrokeStyle(1, 0x8B7355, 0.8));
          bg.on('pointerdown', () => {
            const gs = this.gameScene as any;
            if (typeof gs?.handleProduceUnit === 'function') {
              gs.handleProduceUnit(unit.type);
            }
          });
        }

        this.actionButtons.push({ background: bg, label: nameLabel, callback: () => {}, enabled });
        // Track extra text for cleanup
        this.actionButtons.push({ background: costLabel as any, label: costLabel, callback: () => {}, enabled });
      }

      // Hotkey hints
      const hotkeyHint = this.add.text(barX + 5, gridY + 2 * (btnSize + gap) + 10,
        'Ctrl+Q: Runner  Ctrl+E: Enforcer', {
        fontSize: '9px', fontFamily: FONT_FAMILY, color: '#555555',
      });
      hotkeyHint.setDepth(UI_DEPTH + 1);
      this.actionButtons.push({ background: hotkeyHint as any, label: hotkeyHint, callback: () => {}, enabled: true });

    } else if (selected.length > 0) {
      // ── Units selected: Show command buttons (AoE2-style grid) ────────

      const label = this.add.text(barX + 5, barY - 2, 'COMMANDS', {
        fontSize: '10px', fontFamily: FONT_FAMILY, color: '#8B7355', fontStyle: 'bold',
      });
      label.setDepth(UI_DEPTH + 2);
      this.actionButtons.push({ background: label as any, label: label, callback: () => {}, enabled: true });

      const btnSize = 52;
      const gap = 4;
      const gridX = barX + 5;
      const gridY = barY + 14;

      const commands = [
        { icon: '\u25A0', name: 'Stop', key: 'X', color: 0xCC4444, cb: () => gameScene?.handleStopSelected?.() },
        { icon: '\u2190', name: 'Retreat', key: 'R', color: 0xCCAA44, cb: () => gameScene?.handleRetreat?.() },
        { icon: '\u25B2', name: 'Garrison', key: 'G', color: 0x4488CC, cb: () => gameScene?.handleGarrison?.() },
      ];

      // Add route button if any carrier selected
      const hasCarrier = selected.some((s: any) => s.stats.canCarryGoods);
      if (hasCarrier) {
        commands.push({
          icon: '\u2192', name: 'Route', key: '', color: 0xCD853F,
          cb: () => EventBus.emit(GameEvents.TRANSPORT_GOODS, null, selected.filter((s: any) => s.stats.canCarryGoods)),
        });
      }

      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const col = i % 3;
        const row = Math.floor(i / 3);
        const bx = gridX + col * (btnSize + gap) + btnSize / 2;
        const by = gridY + row * (btnSize + gap) + btnSize / 2;

        const bg = this.add.rectangle(bx, by, btnSize, btnSize, 0x1a1a1a, 0.9);
        bg.setDepth(UI_DEPTH + 1);
        bg.setStrokeStyle(1, 0x8B7355, 0.8);
        bg.setInteractive({ useHandCursor: true });

        // Icon
        const icon = this.add.text(bx, by - 6, cmd.icon, {
          fontSize: '18px', fontFamily: FONT_FAMILY, color: `#${cmd.color.toString(16).padStart(6, '0')}`,
        });
        icon.setOrigin(0.5, 0.5);
        icon.setDepth(UI_DEPTH + 2);

        // Label
        const nameLabel = this.add.text(bx, by + 12, cmd.name, {
          fontSize: '9px', fontFamily: FONT_FAMILY, color: '#CCCCCC',
        });
        nameLabel.setOrigin(0.5, 0.5);
        nameLabel.setDepth(UI_DEPTH + 2);

        // Hotkey
        if (cmd.key) {
          const keyLabel = this.add.text(bx + btnSize / 2 - 2, by - btnSize / 2 + 2, cmd.key, {
            fontSize: '8px', fontFamily: FONT_FAMILY, color: '#888888',
          });
          keyLabel.setOrigin(1, 0);
          keyLabel.setDepth(UI_DEPTH + 2);
          this.actionButtons.push({ background: keyLabel as any, label: keyLabel, callback: () => {}, enabled: true });
        }

        bg.on('pointerover', () => bg.setStrokeStyle(2, 0x00FF00, 1));
        bg.on('pointerout', () => bg.setStrokeStyle(1, 0x8B7355, 0.8));
        bg.on('pointerdown', () => cmd.cb());

        this.actionButtons.push({ background: bg, label: nameLabel, callback: cmd.cb, enabled: true });
        this.actionButtons.push({ background: icon as any, label: icon, callback: () => {}, enabled: true });
      }
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
    const alertX = this.viewW - 300;
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
    // EconomySystem emits objects: { player, cash, delta }
    EventBus.on(GameEvents.CASH_CHANGED, (data: { player: number; cash: number }) => {
      if (data?.player === 0) {
        this.playerCash = data.cash;
      }
    });

    EventBus.on(GameEvents.GOODS_CHANGED, (data: { player: number; goods: number }) => {
      if (data?.player === 0) {
        this.playerGoods = data.goods;
      }
    });

    EventBus.on(GameEvents.INFLUENCE_CHANGED, (data: { player: number; influence: number }) => {
      if (data?.player === 0) {
        this.playerInfluence = data.influence;
      }
    });

    // EconomySystem emits: { players: [{ player, cash, goods, influence, incomePerMin }] }
    EventBus.on(GameEvents.INCOME_TICK, (data: { players: Array<{ player: number; incomePerMin: number }> }) => {
      if (!data?.players) return;
      const p0 = data.players.find((p) => p.player === 0);
      if (p0) {
        this.incomeRate = p0.incomePerMin ?? 0;
        // goodsRate and influenceRate are not in the tick payload; leave at 0
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

    // EconomySystem emits: { player, newTier }
    EventBus.on(GameEvents.TIER_ADVANCED, (data: { player: number; newTier: number }) => {
      const playerIndex = data?.player ?? (typeof data === 'number' ? data : -1);
      const newTier = data?.newTier ?? 0;
      if (playerIndex === 0 && newTier > 0) {
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

    // ── Pause / Resume (Feature 4) ──────────────────────────────────────
    EventBus.on(GameEvents.GAME_PAUSED, () => {
      this.isPaused = true;
      this.pauseOverlay.setVisible(true);
    });

    EventBus.on(GameEvents.GAME_RESUMED, () => {
      this.isPaused = false;
      this.pauseOverlay.setVisible(false);
    });

    // ── Game Speed (Feature 5) ───────────────────────────────────────────
    EventBus.on(GameEvents.GAME_SPEED_CHANGED, (speed: number) => {
      this.currentGameSpeed = speed;
    });

    // ── Unit Produced Alert (Feature 1) ──────────────────────────────────
    EventBus.on(GameEvents.UNIT_PRODUCED, (data: { unitType: string }) => {
      const unitDef = UNIT_DEFS[data.unitType as keyof typeof UNIT_DEFS];
      const name = unitDef ? unitDef.name : data.unitType;
      this.pushAlert(`${name} trained!`, '#00FF00');
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
      const gameOverText = this.add.text(this.viewW / 2, this.viewH / 2, winner, {
        fontSize: '64px',
        fontFamily: FONT_FAMILY,
        color,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 4,
      });
      gameOverText.setOrigin(0.5, 0.5);
      gameOverText.setDepth(UI_DEPTH + 10);

      const reasonText = this.add.text(this.viewW / 2, this.viewH / 2 + 50, data.reason, {
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

    // Selection panel and action bar are updated via event listeners
    // (UNIT_SELECTED, UNIT_DESELECTED, BUILDING_SELECTED, SELECTION_CLEARED)
    // — no need to rebuild every frame.

    // Update production queue UI (Feature 1)
    this.updateProductionQueueUI();

    // Update minimap periodically
    this.updateMinimap(time);

    // ── Game Timer (Feature 3) ──────────────────────────────────────────
    if (!this.isPaused) {
      this.gameTimer += delta;
    }
    const totalSeconds = Math.floor(this.gameTimer / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);

    // ── Game Speed Display (Feature 5) ──────────────────────────────────
    this.gameSpeedText.setText(`${this.currentGameSpeed.toFixed(1)}x`);
    // Highlight speed if not 1.0x
    if (this.currentGameSpeed !== 1.0) {
      this.gameSpeedText.setColor('#FFFF00');
    } else {
      this.gameSpeedText.setColor('#88FF88');
    }
  }
}
