// ─── Lobby Scene ────────────────────────────────────────────────────────────
// Family selection screen. Players pick one of four mafia families before
// starting a match. Selection is stored in the registry and forwarded to
// BootScene → GameScene.

import Phaser from 'phaser';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../data/config';
import { FAMILIES, FamilyData } from '../data/families';

/** Layout constants for family panels. */
const PANEL_WIDTH = 250;
const PANEL_HEIGHT = 350;
const PANEL_GAP = 20;
const PANEL_TOP = 130;

/** Convert a numeric hex color (0xRRGGBB) to a CSS hex string. */
function hexToString(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

export class LobbyScene extends Phaser.Scene {
  private selectedIndex: number = -1;
  private panelGraphics: Phaser.GameObjects.Graphics[] = [];
  private panelZones: Phaser.GameObjects.Zone[] = [];
  private startButton!: Phaser.GameObjects.Graphics;
  private startLabel!: Phaser.GameObjects.Text;
  private startZone!: Phaser.GameObjects.Zone;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    this.selectedIndex = -1;
    this.panelGraphics = [];
    this.panelZones = [];

    this.cameras.main.setBackgroundColor('#0a0a0a');

    // ── Title ─────────────────────────────────────────────────────────────
    this.add
      .text(VIEWPORT_WIDTH / 2, 50, 'CHOOSE YOUR FAMILY', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '36px',
        color: '#DAA520',
        align: 'center',
      })
      .setOrigin(0.5);

    // ── Family panels ─────────────────────────────────────────────────────
    const totalWidth =
      FAMILIES.length * PANEL_WIDTH + (FAMILIES.length - 1) * PANEL_GAP;
    const startX = (VIEWPORT_WIDTH - totalWidth) / 2;

    for (let i = 0; i < FAMILIES.length; i++) {
      const family = FAMILIES[i];
      const px = startX + i * (PANEL_WIDTH + PANEL_GAP);
      this.createFamilyPanel(family, px, PANEL_TOP, i);
    }

    // ── START MATCH button ────────────────────────────────────────────────
    this.createStartMatchButton();
  }

  // ── Panel creation ──────────────────────────────────────────────────────

  private createFamilyPanel(
    family: FamilyData,
    x: number,
    y: number,
    index: number,
  ): void {
    const gfx = this.add.graphics();
    this.panelGraphics.push(gfx);
    this.drawPanel(gfx, x, y, family.color, false);

    // Family name
    this.add
      .text(x + PANEL_WIDTH / 2, y + 20, family.name, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: hexToString(family.accentColor),
        align: 'center',
      })
      .setOrigin(0.5, 0);

    // Subtitle (italic)
    this.add
      .text(x + PANEL_WIDTH / 2, y + 48, family.subtitle, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '14px',
        fontStyle: 'italic',
        color: '#aaaaaa',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    // Description
    this.add
      .text(x + 16, y + 80, family.description, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '13px',
        color: '#cccccc',
        wordWrap: { width: PANEL_WIDTH - 32 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);

    // Bonuses (bullet list)
    const bonusText = family.bonuses.map((b) => '  \u2022 ' + b).join('\n');
    this.add
      .text(x + 16, y + 160, bonusText, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '12px',
        color: '#aaddaa',
        lineSpacing: 6,
      })
      .setOrigin(0, 0);

    // Interactive zone
    const zone = this.add
      .zone(x + PANEL_WIDTH / 2, y + PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT)
      .setInteractive({ useHandCursor: true });

    this.panelZones.push(zone);

    zone.on('pointerover', () => {
      if (this.selectedIndex !== index) {
        this.drawPanel(gfx, x, y, family.color, false, true);
      }
    });

    zone.on('pointerout', () => {
      if (this.selectedIndex !== index) {
        this.drawPanel(gfx, x, y, family.color, false, false);
      }
    });

    zone.on('pointerdown', () => {
      this.selectFamily(index);
    });
  }

  /** Draw (or redraw) a panel background and border. */
  private drawPanel(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    color: number,
    selected: boolean,
    hover: boolean = false,
  ): void {
    gfx.clear();

    // Background
    gfx.fillStyle(0x151515, 1);
    gfx.fillRect(x, y, PANEL_WIDTH, PANEL_HEIGHT);

    // Border
    const borderWidth = selected ? 3 : hover ? 2 : 1;
    const borderAlpha = selected ? 1 : hover ? 0.8 : 0.4;
    gfx.lineStyle(borderWidth, color, borderAlpha);
    gfx.strokeRect(x, y, PANEL_WIDTH, PANEL_HEIGHT);

    // Glow effect when selected (colored line inside)
    if (selected) {
      gfx.lineStyle(1, color, 0.3);
      gfx.strokeRect(x + 4, y + 4, PANEL_WIDTH - 8, PANEL_HEIGHT - 8);
    }
  }

  // ── Selection logic ─────────────────────────────────────────────────────

  private selectFamily(index: number): void {
    this.selectedIndex = index;

    // Redraw all panels: highlight selected, dim others
    const totalWidth =
      FAMILIES.length * PANEL_WIDTH + (FAMILIES.length - 1) * PANEL_GAP;
    const startX = (VIEWPORT_WIDTH - totalWidth) / 2;

    for (let i = 0; i < FAMILIES.length; i++) {
      const px = startX + i * (PANEL_WIDTH + PANEL_GAP);
      const isSelected = i === index;
      this.drawPanel(
        this.panelGraphics[i],
        px,
        PANEL_TOP,
        FAMILIES[i].color,
        isSelected,
      );

      // Dim non-selected panels by lowering alpha on their graphics
      this.panelGraphics[i].setAlpha(isSelected ? 1 : 0.5);
    }

    // Enable the start button
    this.updateStartButton(true);
  }

  // ── START MATCH button ────────────────────────────────────────────────

  private createStartMatchButton(): void {
    const btnX = VIEWPORT_WIDTH / 2;
    const btnY = VIEWPORT_HEIGHT - 70;
    const btnW = 200;
    const btnH = 45;

    this.startButton = this.add.graphics();
    this.drawStartButton(false);

    this.startLabel = this.add
      .text(btnX, btnY, 'START MATCH', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '20px',
        color: '#555555',
        align: 'center',
      })
      .setOrigin(0.5);

    this.startZone = this.add
      .zone(btnX, btnY, btnW, btnH)
      .setInteractive({ useHandCursor: true });

    this.startZone.on('pointerover', () => {
      if (this.selectedIndex >= 0) {
        this.drawStartButton(true, true);
        this.startLabel.setColor('#FFD700');
      }
    });

    this.startZone.on('pointerout', () => {
      if (this.selectedIndex >= 0) {
        this.drawStartButton(true, false);
        this.startLabel.setColor('#DAA520');
      }
    });

    this.startZone.on('pointerdown', () => {
      if (this.selectedIndex < 0) return;

      this.registry.set('selectedFamily', this.selectedIndex);
      this.scene.start('BootScene');
    });
  }

  /** Draw the start button in enabled or disabled state. */
  private drawStartButton(enabled: boolean, hover: boolean = false): void {
    const btnX = VIEWPORT_WIDTH / 2;
    const btnY = VIEWPORT_HEIGHT - 70;
    const btnW = 200;
    const btnH = 45;

    this.startButton.clear();

    if (enabled) {
      const fill = hover ? 0x111111 : 0x1a1a1a;
      const border = hover ? 0xdaa520 : 0x888888;
      this.startButton.fillStyle(fill, 1);
      this.startButton.fillRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH);
      this.startButton.lineStyle(2, border, 1);
      this.startButton.strokeRect(
        btnX - btnW / 2,
        btnY - btnH / 2,
        btnW,
        btnH,
      );
    } else {
      this.startButton.fillStyle(0x111111, 0.5);
      this.startButton.fillRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH);
      this.startButton.lineStyle(1, 0x333333, 1);
      this.startButton.strokeRect(
        btnX - btnW / 2,
        btnY - btnH / 2,
        btnW,
        btnH,
      );
    }
  }

  /** Enable or disable the start button visually. */
  private updateStartButton(enabled: boolean): void {
    this.drawStartButton(enabled);
    this.startLabel.setColor(enabled ? '#DAA520' : '#555555');
  }
}
