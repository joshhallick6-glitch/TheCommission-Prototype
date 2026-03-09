// ─── Menu Scene ─────────────────────────────────────────────────────────────
// Noir-styled title screen with rain effect and vignette. Entry point of the
// game — clicking START GAME transitions to the LobbyScene.

import Phaser from 'phaser';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from '../data/config';

/** Number of rain lines to animate on the title screen. */
const RAIN_LINE_COUNT = 30;

/** Per-raindrop state tracked across frames. */
interface RainLine {
  x: number;
  y: number;
  length: number;
  speed: number;
}

export class MenuScene extends Phaser.Scene {
  private rainLines: RainLine[] = [];
  private rainGfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    // Solid dark background
    this.cameras.main.setBackgroundColor('#0a0a0a');

    // ── Rain effect (behind everything else) ──────────────────────────────
    this.rainGfx = this.add.graphics();
    this.rainLines = [];
    for (let i = 0; i < RAIN_LINE_COUNT; i++) {
      this.rainLines.push(this.spawnRainLine(true));
    }

    // ── Vignette overlay (dark gradient around edges) ─────────────────────
    this.createVignette();

    // ── Title text ────────────────────────────────────────────────────────
    this.add
      .text(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT * 0.3, 'THE COMMISSION', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '72px',
        color: '#DAA520',
        align: 'center',
      })
      .setOrigin(0.5);

    // ── Subtitle ──────────────────────────────────────────────────────────
    this.add
      .text(
        VIEWPORT_WIDTH / 2,
        VIEWPORT_HEIGHT * 0.3 + 60,
        'A Prohibition-Era Crime Empire',
        {
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: '20px',
          color: '#888888',
          align: 'center',
        },
      )
      .setOrigin(0.5);

    // ── START GAME button ─────────────────────────────────────────────────
    this.createStartButton();

    // ── Version label ─────────────────────────────────────────────────────
    this.add
      .text(VIEWPORT_WIDTH - 16, VIEWPORT_HEIGHT - 16, 'v0.2', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#555555',
      })
      .setOrigin(1, 1);
  }

  update(): void {
    this.drawRain();
  }

  // ── Rain helpers ──────────────────────────────────────────────────────────

  /** Create a single rain line with randomized properties. */
  private spawnRainLine(randomizeY: boolean): RainLine {
    return {
      x: Phaser.Math.Between(0, VIEWPORT_WIDTH),
      y: randomizeY
        ? Phaser.Math.Between(-VIEWPORT_HEIGHT, VIEWPORT_HEIGHT)
        : Phaser.Math.Between(-60, -10),
      length: Phaser.Math.Between(10, 30),
      speed: Phaser.Math.FloatBetween(3, 7),
    };
  }

  /** Advance and redraw all rain lines each frame. */
  private drawRain(): void {
    this.rainGfx.clear();
    this.rainGfx.lineStyle(1, 0x444444, 0.3);

    for (const line of this.rainLines) {
      line.y += line.speed;

      // Reset when off-screen
      if (line.y > VIEWPORT_HEIGHT + line.length) {
        const fresh = this.spawnRainLine(false);
        line.x = fresh.x;
        line.y = fresh.y;
        line.length = fresh.length;
        line.speed = fresh.speed;
      }

      this.rainGfx.beginPath();
      this.rainGfx.moveTo(line.x, line.y);
      this.rainGfx.lineTo(line.x, line.y + line.length);
      this.rainGfx.strokePath();
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  /** Draw a dark radial vignette around the screen edges. */
  private createVignette(): void {
    const vignetteGfx = this.add.graphics();
    const cx = VIEWPORT_WIDTH / 2;
    const cy = VIEWPORT_HEIGHT / 2;
    const outerRadius = Math.max(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Layer concentric semi-transparent black rings
    const steps = 8;
    for (let i = steps; i >= 1; i--) {
      const alpha = (i / steps) * 0.5;
      const radius = outerRadius * (i / steps);
      vignetteGfx.fillStyle(0x000000, alpha);
      vignetteGfx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      // Punch out a clear ellipse in the center
      vignetteGfx.fillStyle(0x0a0a0a, 1);
      vignetteGfx.fillEllipse(cx, cy, radius * 1.2, radius * 0.8);
    }

    // Simpler approach: just darken the edges with four gradient-like rects
    vignetteGfx.clear();
    const edgeSize = 120;
    const edgeAlpha = 0.4;

    // Top edge
    for (let i = 0; i < edgeSize; i++) {
      const a = edgeAlpha * (1 - i / edgeSize);
      vignetteGfx.fillStyle(0x000000, a);
      vignetteGfx.fillRect(0, i, VIEWPORT_WIDTH, 1);
    }
    // Bottom edge
    for (let i = 0; i < edgeSize; i++) {
      const a = edgeAlpha * (1 - i / edgeSize);
      vignetteGfx.fillStyle(0x000000, a);
      vignetteGfx.fillRect(0, VIEWPORT_HEIGHT - 1 - i, VIEWPORT_WIDTH, 1);
    }
    // Left edge
    for (let i = 0; i < edgeSize; i++) {
      const a = edgeAlpha * (1 - i / edgeSize);
      vignetteGfx.fillStyle(0x000000, a);
      vignetteGfx.fillRect(i, 0, 1, VIEWPORT_HEIGHT);
    }
    // Right edge
    for (let i = 0; i < edgeSize; i++) {
      const a = edgeAlpha * (1 - i / edgeSize);
      vignetteGfx.fillStyle(0x000000, a);
      vignetteGfx.fillRect(VIEWPORT_WIDTH - 1 - i, 0, 1, VIEWPORT_HEIGHT);
    }

    vignetteGfx.setDepth(1);
  }

  /** Create the START GAME button with hover effects. */
  private createStartButton(): void {
    const btnX = VIEWPORT_WIDTH / 2;
    const btnY = VIEWPORT_HEIGHT * 0.6;
    const btnW = 240;
    const btnH = 50;

    const btnGfx = this.add.graphics();
    const borderColor = 0x888888;
    const fillColor = 0x1a1a1a;
    const hoverFill = 0x111111;

    // Draw initial button state
    const drawButton = (fill: number, border: number): void => {
      btnGfx.clear();
      btnGfx.fillStyle(fill, 1);
      btnGfx.fillRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH);
      btnGfx.lineStyle(2, border, 1);
      btnGfx.strokeRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH);
    };

    drawButton(fillColor, borderColor);

    const label = this.add
      .text(btnX, btnY, 'START GAME', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '24px',
        color: '#DAA520',
        align: 'center',
      })
      .setOrigin(0.5);

    // Interactive zone
    const hitZone = this.add
      .zone(btnX, btnY, btnW, btnH)
      .setInteractive({ useHandCursor: true });

    hitZone.on('pointerover', () => {
      drawButton(hoverFill, 0xdaa520);
      label.setColor('#FFD700');
    });

    hitZone.on('pointerout', () => {
      drawButton(fillColor, borderColor);
      label.setColor('#DAA520');
    });

    hitZone.on('pointerdown', () => {
      this.scene.start('LobbyScene');
    });

    // Ensure button elements sit above vignette
    btnGfx.setDepth(2);
    label.setDepth(2);
    hitZone.setDepth(2);
  }
}
