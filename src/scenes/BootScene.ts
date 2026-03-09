// ─── Boot Scene ─────────────────────────────────────────────────────────────
// Runs first. Generates all game textures procedurally so no external assets
// are required. Transitions to GameScene when finished.
//
// All terrain tiles are 64x32 isometric diamonds (2:1 ratio, AoE2-style).
// Building sprites are isometric 3D boxes. Unit sprites are isometric-perspective.

import Phaser from 'phaser';
import { TILE_WIDTH, TILE_HEIGHT, TerrainType } from '../data/config';
import { BUILDING_DEFS, BuildingType } from '../data/buildings';
import { UNIT_DEFS, UnitType } from '../data/units';

// Number of terrain tile indices in the generated tileset
const TERRAIN_TILE_COUNT = 9; // one per TerrainType value (0-8)

// Isometric diamond tile dimensions
const TW = TILE_WIDTH;   // 64
const TH = TILE_HEIGHT;  // 32
const HALF_TW = TW / 2;  // 32
const HALF_TH = TH / 2;  // 16

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Nothing to load -- everything is procedural
  }

  create(): void {
    this.generateTerrainTileset();
    this.generateUnitSprites();
    this.generateBuildingSprites();
    this.generateUIElements();
    this.generateParticleTextures();

    // Done -- move to the game
    this.scene.start('GameScene');
  }

  // ── Terrain Tileset ─────────────────────────────────────────────────────────

  /**
   * Generates a single tileset image containing one 64x32 isometric diamond
   * tile per TerrainType, arranged in a horizontal strip. The tile index
   * matches the TerrainType enum value, so the tilemap can reference tiles
   * directly by terrain type.
   *
   * Each tile is a diamond: top=(32,0), right=(64,16), bottom=(32,32), left=(0,16).
   * Pixels outside the diamond are transparent (alpha 0).
   */
  private generateTerrainTileset(): void {
    const stripWidth = TW * TERRAIN_TILE_COUNT; // 576
    const canvas = this.textures.createCanvas(
      'terrain-tileset',
      stripWidth,
      TH,
    );
    if (!canvas) return;

    const ctx = canvas.context;

    // Clear entire strip to transparent
    ctx.clearRect(0, 0, stripWidth, TH);

    // Helper: clip to diamond shape at given x-offset, then run draw function
    const drawDiamondTile = (
      index: number,
      fillColor: string,
      borderColor: string,
      detailFn?: (ctx: CanvasRenderingContext2D, x: number) => void,
    ): void => {
      const x = index * TW;

      // Define diamond path
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + HALF_TW, 0);           // top
      ctx.lineTo(x + TW, HALF_TH);          // right
      ctx.lineTo(x + HALF_TW, TH);          // bottom
      ctx.lineTo(x, HALF_TH);               // left
      ctx.closePath();

      // Clip to diamond -- only pixels inside will be drawn
      ctx.clip();

      // Fill the diamond
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, 0, TW, TH);

      // Draw any detail texture inside the diamond
      if (detailFn) {
        detailFn(ctx, x);
      }

      ctx.restore();

      // Draw diamond border (outside clip so it's crisp on the edge)
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + HALF_TW, 0);
      ctx.lineTo(x + TW, HALF_TH);
      ctx.lineTo(x + HALF_TW, TH);
      ctx.lineTo(x, HALF_TH);
      ctx.closePath();
      ctx.stroke();
    };

    // ROAD (0) -- dark gray with subtle center line
    drawDiamondTile(TerrainType.ROAD, '#444444', '#333333', (c, x) => {
      c.strokeStyle = '#555555';
      c.setLineDash([3, 4]);
      c.lineWidth = 0.5;
      // Diagonal center line (following iso diamond direction)
      c.beginPath();
      c.moveTo(x + HALF_TW - 8, HALF_TH - 4);
      c.lineTo(x + HALF_TW + 8, HALF_TH + 4);
      c.stroke();
      c.setLineDash([]);
    });

    // SIDEWALK (1) -- medium gray with subtle grid
    drawDiamondTile(TerrainType.SIDEWALK, '#666666', '#555555', (c, x) => {
      c.strokeStyle = '#737373';
      c.lineWidth = 0.3;
      // Draw a cross-hatch pattern inside the diamond
      for (let i = 0; i < TW; i += 16) {
        c.beginPath();
        c.moveTo(x + i, 0);
        c.lineTo(x + i, TH);
        c.stroke();
      }
      for (let i = 0; i < TH; i += 8) {
        c.beginPath();
        c.moveTo(x, i);
        c.lineTo(x + TW, i);
        c.stroke();
      }
    });

    // BUILDING_FLOOR (2) -- grey
    drawDiamondTile(TerrainType.BUILDING_FLOOR, '#555555', '#444444', (c, x) => {
      // Subtle plank lines following iso direction
      c.strokeStyle = '#4a4a4a';
      c.lineWidth = 0.4;
      for (let i = 4; i < TH; i += 6) {
        c.beginPath();
        c.moveTo(x, i);
        c.lineTo(x + TW, i);
        c.stroke();
      }
    });

    // WALL (3) -- dark with lighter border
    drawDiamondTile(TerrainType.WALL, '#333333', '#4a4a4a');

    // ALLEY (4) -- very dark with dashed center
    drawDiamondTile(TerrainType.ALLEY, '#3a3a3a', '#2a2a2a', (c, x) => {
      c.strokeStyle = '#505050';
      c.setLineDash([2, 4]);
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(x + HALF_TW - 10, HALF_TH - 5);
      c.lineTo(x + HALF_TW + 10, HALF_TH + 5);
      c.stroke();
      c.setLineDash([]);
    });

    // PARK (5) -- dark green with grass tufts
    drawDiamondTile(TerrainType.PARK, '#2d5a1e', '#1e4a12', (c, x) => {
      c.fillStyle = '#3a7a28';
      // Small grass tuft dots scattered inside diamond
      c.fillRect(x + 20, 10, 3, 2);
      c.fillRect(x + 38, 14, 3, 2);
      c.fillRect(x + 28, 22, 3, 2);
      c.fillRect(x + 44, 8, 2, 2);
      c.fillRect(x + 14, 18, 2, 2);
    });

    // WATER (6) -- dark blue with wave lines
    drawDiamondTile(TerrainType.WATER, '#1a3a5c', '#143050', (c, x) => {
      c.strokeStyle = '#2a4a6c';
      c.lineWidth = 0.5;
      for (let i = 8; i < TH; i += 8) {
        c.beginPath();
        c.moveTo(x + 8, i);
        c.quadraticCurveTo(x + HALF_TW / 2, i - 2, x + HALF_TW, i);
        c.quadraticCurveTo(x + HALF_TW + HALF_TW / 2, i + 2, x + TW - 8, i);
        c.stroke();
      }
    });

    // BRIDGE (7) -- brown with cross planks
    drawDiamondTile(TerrainType.BRIDGE, '#5a4a3a', '#4a3a2a', (c, x) => {
      c.strokeStyle = '#6a5a4a';
      c.lineWidth = 1;
      // Cross planks following iso direction
      for (let i = 6; i < TW - 6; i += 10) {
        c.beginPath();
        c.moveTo(x + i, HALF_TH - 6);
        c.lineTo(x + i, HALF_TH + 6);
        c.stroke();
      }
    });

    // COVER_OBJECT (8) -- olive/brown with object rectangle
    drawDiamondTile(TerrainType.COVER_OBJECT, '#4a4a2a', '#3a3a1a', (c, x) => {
      // Small isometric box shape in the center representing the cover object
      c.fillStyle = '#6a6a3a';
      c.beginPath();
      c.moveTo(x + HALF_TW, HALF_TH - 6);
      c.lineTo(x + HALF_TW + 10, HALF_TH - 1);
      c.lineTo(x + HALF_TW, HALF_TH + 4);
      c.lineTo(x + HALF_TW - 10, HALF_TH - 1);
      c.closePath();
      c.fill();
      c.strokeStyle = '#5a5a2a';
      c.lineWidth = 0.5;
      c.stroke();
    });

    canvas.refresh();
  }

  // ── Unit Sprites ────────────────────────────────────────────────────────────

  private generateUnitSprites(): void {
    for (const unitType of Object.values(UnitType)) {
      const stats = UNIT_DEFS[unitType];
      if (!stats) continue;

      if (stats.isVehicle) {
        this.generateVehicleSprite(stats.type, stats.color);
      } else {
        this.generateInfantrySprite(stats.type, stats.color, stats.squadSize);
      }
    }
  }

  /**
   * Infantry: isometric-perspective figure. Ellipse body (wider than tall to
   * match iso view) with a head circle on top. Each squad member is ~16x20px,
   * arranged in a formation cluster.
   */
  private generateInfantrySprite(
    type: string,
    color: number,
    squadSize: number,
  ): void {
    // Each member figure is 16 wide x 20 tall
    const memberW = 16;
    const memberH = 20;
    const spacing = 14;

    // Arrange in a small grid (max 2 columns)
    const cols = Math.min(squadSize, 2);
    const rows = Math.ceil(squadSize / cols);
    const totalW = cols * spacing + memberW;
    const totalH = rows * spacing + memberH;

    const gfx = this.make.graphics({ x: 0, y: 0 }, false);

    for (let i = 0; i < squadSize; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = memberW / 2 + col * spacing;
      const cy = memberH / 2 + row * spacing + 4; // offset down for head

      // Body: ellipse (wider than tall for iso perspective)
      gfx.fillStyle(color, 1);
      gfx.fillEllipse(cx, cy + 2, 12, 8);
      gfx.lineStyle(1, darkenColor(color, 0.5), 1);
      gfx.strokeEllipse(cx, cy + 2, 12, 8);

      // Head: small circle above body
      gfx.fillStyle(lightenColor(color, 0.3), 1);
      gfx.fillCircle(cx, cy - 5, 3);
      gfx.lineStyle(1, darkenColor(color, 0.4), 1);
      gfx.strokeCircle(cx, cy - 5, 3);
    }

    // Directional indicator: small triangle at top-center
    const triX = totalW / 2;
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillTriangle(triX, 0, triX - 3, 5, triX + 3, 5);

    gfx.generateTexture(`unit-${type}`, totalW, totalH);
    gfx.destroy();
  }

  /**
   * Vehicles: isometric parallelogram shape with visible top face.
   * Trucks: 36x24, Cars: 32x20.
   */
  private generateVehicleSprite(type: string, color: number): void {
    const isTruck =
      type === UnitType.DELIVERY_TRUCK || type === UnitType.ARMORED_TRUCK;
    const vw = isTruck ? 36 : 32;
    const vh = isTruck ? 24 : 20;

    const gfx = this.make.graphics({ x: 0, y: 0 }, false);

    // Top face (lighter, diamond/parallelogram shape)
    const topColor = lightenColor(color, 0.25);
    gfx.fillStyle(topColor, 1);
    gfx.beginPath();
    gfx.moveTo(vw / 2, 0);                    // top
    gfx.moveTo(vw * 0.15, vh * 0.25);         // left
    gfx.lineTo(vw * 0.5, vh * 0.05);          // top
    gfx.lineTo(vw * 0.85, vh * 0.25);         // right
    gfx.lineTo(vw * 0.5, vh * 0.45);          // bottom
    gfx.closePath();
    gfx.fillPath();

    // Right side (darker shade)
    const rightColor = darkenColor(color, 0.6);
    gfx.fillStyle(rightColor, 1);
    gfx.beginPath();
    gfx.moveTo(vw * 0.85, vh * 0.25);
    gfx.lineTo(vw * 0.5, vh * 0.45);
    gfx.lineTo(vw * 0.5, vh * 0.75);
    gfx.lineTo(vw * 0.85, vh * 0.55);
    gfx.closePath();
    gfx.fillPath();

    // Left side (medium shade)
    gfx.fillStyle(color, 1);
    gfx.beginPath();
    gfx.moveTo(vw * 0.15, vh * 0.25);
    gfx.lineTo(vw * 0.5, vh * 0.45);
    gfx.lineTo(vw * 0.5, vh * 0.75);
    gfx.lineTo(vw * 0.15, vh * 0.55);
    gfx.closePath();
    gfx.fillPath();

    // Outline
    gfx.lineStyle(1, darkenColor(color, 0.4), 1);
    // Top face outline
    gfx.beginPath();
    gfx.moveTo(vw * 0.15, vh * 0.25);
    gfx.lineTo(vw * 0.5, vh * 0.05);
    gfx.lineTo(vw * 0.85, vh * 0.25);
    gfx.lineTo(vw * 0.5, vh * 0.45);
    gfx.closePath();
    gfx.strokePath();

    // Directional indicator (front -- lower-right, pointing to iso-right)
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillTriangle(
      vw * 0.85, vh * 0.25,
      vw * 0.75, vh * 0.18,
      vw * 0.75, vh * 0.32,
    );

    gfx.generateTexture(`unit-${type}`, vw, vh);
    gfx.destroy();
  }

  // ── Building Sprites ────────────────────────────────────────────────────────

  /**
   * Generates isometric 3D box building sprites. Each building has:
   * - TOP face: diamond in lighter shade of building color
   * - LEFT wall: parallelogram in base color (medium shade)
   * - RIGHT wall: parallelogram in darker shade
   *
   * The diamond base is (widthTiles * TILE_WIDTH) x (heightTiles * TILE_HEIGHT).
   * Walls extend downward to give a 3D height illusion.
   */
  private generateBuildingSprites(): void {
    for (const bType of Object.values(BuildingType)) {
      const def = BUILDING_DEFS[bType];
      if (!def) continue;

      // Isometric diamond dimensions for this building
      const isoW = def.widthTiles * TW;     // e.g. 2 tiles = 128px wide
      const isoH = def.heightTiles * TH;    // e.g. 2 tiles = 64px tall
      const halfW = isoW / 2;
      const halfH = isoH / 2;

      // Wall height in pixels (taller buildings get more wall depth)
      const wallHeight = Math.max(16, Math.min(32, def.widthTiles * 8));

      // Total sprite size: diamond + wall extension below
      const spriteW = isoW;
      const spriteH = isoH + wallHeight;

      const gfx = this.make.graphics({ x: 0, y: 0 }, false);

      // Diamond top-face corners (centered horizontally at halfW, top at 0)
      const topX = halfW;
      const topY = 0;
      const rightX = isoW;
      const rightY = halfH;
      const bottomX = halfW;
      const bottomY = isoH;
      const leftX = 0;
      const leftY = halfH;

      // ── LEFT wall (medium shade) ──────────────────────────────────────
      gfx.fillStyle(def.color, 1);
      gfx.beginPath();
      gfx.moveTo(leftX, leftY);
      gfx.lineTo(bottomX, bottomY);
      gfx.lineTo(bottomX, bottomY + wallHeight);
      gfx.lineTo(leftX, leftY + wallHeight);
      gfx.closePath();
      gfx.fillPath();

      // ── RIGHT wall (darker shade) ─────────────────────────────────────
      gfx.fillStyle(darkenColor(def.color, 0.6), 1);
      gfx.beginPath();
      gfx.moveTo(rightX, rightY);
      gfx.lineTo(bottomX, bottomY);
      gfx.lineTo(bottomX, bottomY + wallHeight);
      gfx.lineTo(rightX, rightY + wallHeight);
      gfx.closePath();
      gfx.fillPath();

      // ── TOP face (lighter shade diamond) ──────────────────────────────
      gfx.fillStyle(lightenColor(def.color, 0.3), 1);
      gfx.beginPath();
      gfx.moveTo(topX, topY);
      gfx.lineTo(rightX, rightY);
      gfx.lineTo(bottomX, bottomY);
      gfx.lineTo(leftX, leftY);
      gfx.closePath();
      gfx.fillPath();

      // ── Outlines ──────────────────────────────────────────────────────
      gfx.lineStyle(1, darkenColor(def.color, 0.4), 1);

      // Top face outline
      gfx.beginPath();
      gfx.moveTo(topX, topY);
      gfx.lineTo(rightX, rightY);
      gfx.lineTo(bottomX, bottomY);
      gfx.lineTo(leftX, leftY);
      gfx.closePath();
      gfx.strokePath();

      // Left wall outline
      gfx.beginPath();
      gfx.moveTo(leftX, leftY);
      gfx.lineTo(leftX, leftY + wallHeight);
      gfx.lineTo(bottomX, bottomY + wallHeight);
      gfx.lineTo(bottomX, bottomY);
      gfx.strokePath();

      // Right wall outline
      gfx.beginPath();
      gfx.moveTo(rightX, rightY);
      gfx.lineTo(rightX, rightY + wallHeight);
      gfx.lineTo(bottomX, bottomY + wallHeight);
      gfx.lineTo(bottomX, bottomY);
      gfx.strokePath();

      gfx.generateTexture(`building-${bType}`, spriteW, spriteH);
      gfx.destroy();

      // Stamp identifying label on the top face
      this.addBuildingLabel(bType, spriteW, spriteH, halfW, halfH, def.color);
    }
  }

  /**
   * Draws a short identifying label on the building's top face using a
   * CanvasTexture for real text rendering.
   */
  private addBuildingLabel(
    type: string,
    w: number,
    h: number,
    centerX: number,
    centerY: number,
    bgColor: number,
  ): void {
    const key = `building-${type}`;
    const tex = this.textures.get(key);
    if (!tex || tex.key === '__MISSING') return;

    const canvas = this.textures.createCanvas(`${key}-tmp`, w, h);
    if (!canvas) return;
    const ctx = canvas.context;

    // Draw existing texture image onto this canvas
    const srcCanvas = tex.getSourceImage() as HTMLCanvasElement;
    ctx.drawImage(srcCanvas, 0, 0);

    // Determine a contrasting text color
    const brightness = getBrightness(bgColor);
    ctx.fillStyle = brightness > 128 ? '#000000' : '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const label = getBuildingLabel(type);
    // Place text at the center of the top diamond face
    ctx.fillText(label, centerX, centerY);

    canvas.refresh();

    // Replace original texture with labeled version
    this.textures.remove(key);
    this.textures.renameTexture(`${key}-tmp`, key);
  }

  // ── UI Elements ─────────────────────────────────────────────────────────────

  private generateUIElements(): void {
    // Selection ellipse (green ring, wider than tall for iso perspective)
    this.makeGraphicTexture('ui-selection', 48, 28, (gfx) => {
      gfx.lineStyle(2, 0x00ff00, 0.8);
      gfx.strokeEllipse(24, 14, 44, 24);
    });

    // Health bar background (red, 24x4)
    this.makeGraphicTexture('ui-healthbar-bg', 24, 4, (gfx) => {
      gfx.fillStyle(0xcc0000, 1);
      gfx.fillRect(0, 0, 24, 4);
    });

    // Health bar fill (green, 24x4)
    this.makeGraphicTexture('ui-healthbar-fill', 24, 4, (gfx) => {
      gfx.fillStyle(0x00cc00, 1);
      gfx.fillRect(0, 0, 24, 4);
    });

    // Capture progress bar (blue, 32x4)
    this.makeGraphicTexture('ui-capture-bar', 32, 4, (gfx) => {
      gfx.fillStyle(0x0066cc, 1);
      gfx.fillRect(0, 0, 32, 4);
    });

    // Street corner marker (small iso diamond, 12x8)
    this.makeGraphicTexture('ui-corner-marker', 12, 8, (gfx) => {
      gfx.fillStyle(0xffcc00, 0.9);
      gfx.beginPath();
      gfx.moveTo(6, 0);   // top
      gfx.lineTo(12, 4);  // right
      gfx.lineTo(6, 8);   // bottom
      gfx.lineTo(0, 4);   // left
      gfx.closePath();
      gfx.fillPath();
    });

    // Minimap frame (4px border, 200x200 -- just the border texture)
    this.makeGraphicTexture('ui-minimap-frame', 200, 200, (gfx) => {
      gfx.lineStyle(4, 0xaaaaaa, 1);
      gfx.strokeRect(2, 2, 196, 196);
    });
  }

  // ── Particle / Effect Textures ──────────────────────────────────────────────

  private generateParticleTextures(): void {
    // Bullet tracer (tiny yellow line, 4x1)
    this.makeGraphicTexture('fx-bullet-tracer', 4, 2, (gfx) => {
      gfx.fillStyle(0xffee00, 1);
      gfx.fillRect(0, 0, 4, 2);
    });

    // Muzzle flash (small orange star, 6x6)
    this.makeGraphicTexture('fx-muzzle-flash', 6, 6, (gfx) => {
      gfx.fillStyle(0xff8800, 1);
      // Simple star shape using overlapping rects
      gfx.fillRect(1, 0, 4, 6);
      gfx.fillRect(0, 1, 6, 4);
      gfx.fillStyle(0xffcc44, 1);
      gfx.fillRect(2, 2, 2, 2);
    });

    // Explosion (orange-red circle, 16x16)
    this.makeGraphicTexture('fx-explosion', 16, 16, (gfx) => {
      gfx.fillStyle(0xff4400, 0.9);
      gfx.fillCircle(8, 8, 8);
      gfx.fillStyle(0xff8800, 0.8);
      gfx.fillCircle(8, 8, 5);
      gfx.fillStyle(0xffcc00, 0.7);
      gfx.fillCircle(8, 8, 2);
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Convenience wrapper: create a Graphics object, run a draw callback,
   * generate a texture from it, then destroy the graphics.
   */
  private makeGraphicTexture(
    key: string,
    width: number,
    height: number,
    draw: (gfx: Phaser.GameObjects.Graphics) => void,
  ): void {
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    draw(gfx);
    gfx.generateTexture(key, width, height);
    gfx.destroy();
  }
}

// ─── Utility functions (module-private) ───────────────────────────────────────

/** Darken a hex color by a factor (0 = black, 1 = unchanged). */
function darkenColor(hex: number, factor: number): number {
  const r = Math.floor(((hex >> 16) & 0xff) * factor);
  const g = Math.floor(((hex >> 8) & 0xff) * factor);
  const b = Math.floor((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Lighten a hex color by a factor (adds factor * remaining toward white). */
function lightenColor(hex: number, factor: number): number {
  const r = Math.min(
    255,
    ((hex >> 16) & 0xff) + Math.floor((255 - ((hex >> 16) & 0xff)) * factor),
  );
  const g = Math.min(
    255,
    ((hex >> 8) & 0xff) + Math.floor((255 - ((hex >> 8) & 0xff)) * factor),
  );
  const b = Math.min(
    255,
    (hex & 0xff) + Math.floor((255 - (hex & 0xff)) * factor),
  );
  return (r << 16) | (g << 8) | b;
}

/** Perceived brightness (0-255). */
function getBrightness(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Short label for each building type used as a center identifier. */
function getBuildingLabel(type: string): string {
  const labels: Record<string, string> = {
    compound: 'HQ',
    speakeasy: 'SK',
    corner_store: 'CS',
    back_alley_still: 'AS',
    bookie_joint: 'BK',
    warehouse: 'WH',
    boxing_gym: 'BG',
    nightclub: 'NC',
    distillery: 'DT',
    trucking_depot: 'TD',
    pawn_shop: 'PS',
    casino: 'CA',
    import_dock: 'ID',
    city_hall_contact: 'CH',
    newspaper_office: 'NP',
  };
  return labels[type] ?? '?';
}
