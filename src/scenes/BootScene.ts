// ─── Boot Scene ─────────────────────────────────────────────────────────────
// Runs first. Generates all game textures procedurally so no external assets
// are required. Transitions to GameScene when finished.

import Phaser from 'phaser';
import { TILE_SIZE, TerrainType } from '../data/config';
import { BUILDING_DEFS, BuildingType } from '../data/buildings';
import { UNIT_DEFS, UnitType } from '../data/units';

// Number of terrain tile indices in the generated tileset
const TERRAIN_TILE_COUNT = 9; // one per TerrainType value (0-8)

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
   * Generates a single tileset image containing one 32x32 tile per TerrainType,
   * arranged in a horizontal strip. The tile index matches the TerrainType enum
   * value, so the tilemap can reference tiles directly by terrain type.
   */
  private generateTerrainTileset(): void {
    const ts = TILE_SIZE;
    const canvas = this.textures.createCanvas(
      'terrain-tileset',
      ts * TERRAIN_TILE_COUNT,
      ts,
    );
    if (!canvas) return;

    const ctx = canvas.context;

    // Helper: draw a single tile at the correct x-offset
    const drawTile = (index: number, drawFn: (x: number) => void): void => {
      drawFn(index * ts);
    };

    // ROAD (0) -- dark gray
    drawTile(TerrainType.ROAD, (x) => {
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x, 0, ts, ts);
      // Subtle lane dashes
      ctx.strokeStyle = '#4a4a4a';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(x + ts / 2, 0);
      ctx.lineTo(x + ts / 2, ts);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // SIDEWALK (1) -- medium gray
    drawTile(TerrainType.SIDEWALK, (x) => {
      ctx.fillStyle = '#555555';
      ctx.fillRect(x, 0, ts, ts);
      // Grid lines for pavement texture
      ctx.strokeStyle = '#606060';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x + 1, 1, ts - 2, ts - 2);
      ctx.beginPath();
      ctx.moveTo(x + ts / 2, 0);
      ctx.lineTo(x + ts / 2, ts);
      ctx.stroke();
      ctx.lineWidth = 1;
    });

    // BUILDING_FLOOR (2) -- dark brown
    drawTile(TerrainType.BUILDING_FLOOR, (x) => {
      ctx.fillStyle = '#2a1f14';
      ctx.fillRect(x, 0, ts, ts);
      // Subtle plank lines
      ctx.strokeStyle = '#332618';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < ts; i += 8) {
        ctx.beginPath();
        ctx.moveTo(x, i);
        ctx.lineTo(x + ts, i);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    });

    // WALL (3) -- dark brown-black with 1px lighter border
    drawTile(TerrainType.WALL, (x) => {
      ctx.fillStyle = '#1a1208';
      ctx.fillRect(x, 0, ts, ts);
      ctx.strokeStyle = '#3a2a18';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, 0.5, ts - 1, ts - 1);
    });

    // ALLEY (4) -- darker gray with subtle dashed center line
    drawTile(TerrainType.ALLEY, (x) => {
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(x, 0, ts, ts);
      ctx.strokeStyle = '#444444';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x + ts / 2, 0);
      ctx.lineTo(x + ts / 2, ts);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // PARK (5) -- dark green
    drawTile(TerrainType.PARK, (x) => {
      ctx.fillStyle = '#1a3a1a';
      ctx.fillRect(x, 0, ts, ts);
      // A few lighter "grass tufts"
      ctx.fillStyle = '#255a25';
      ctx.fillRect(x + 6, 8, 3, 3);
      ctx.fillRect(x + 20, 14, 3, 3);
      ctx.fillRect(x + 12, 24, 3, 3);
    });

    // WATER (6) -- dark blue
    drawTile(TerrainType.WATER, (x) => {
      ctx.fillStyle = '#1a2a4a';
      ctx.fillRect(x, 0, ts, ts);
      // Wave lines
      ctx.strokeStyle = '#2a3a5a';
      ctx.lineWidth = 0.5;
      for (let i = 8; i < ts; i += 10) {
        ctx.beginPath();
        ctx.moveTo(x, i);
        ctx.quadraticCurveTo(x + ts / 4, i - 3, x + ts / 2, i);
        ctx.quadraticCurveTo(x + (3 * ts) / 4, i + 3, x + ts, i);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    });

    // BRIDGE (7) -- gray-brown with rail lines
    drawTile(TerrainType.BRIDGE, (x) => {
      ctx.fillStyle = '#4a4a3a';
      ctx.fillRect(x, 0, ts, ts);
      // Rails on each side
      ctx.strokeStyle = '#6a6a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, 0);
      ctx.lineTo(x + 4, ts);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + ts - 4, 0);
      ctx.lineTo(x + ts - 4, ts);
      ctx.stroke();
      // Cross planks
      ctx.lineWidth = 1;
      for (let i = 4; i < ts; i += 8) {
        ctx.beginPath();
        ctx.moveTo(x + 4, i);
        ctx.lineTo(x + ts - 4, i);
        ctx.stroke();
      }
    });

    // COVER_OBJECT (8) -- tan (cars, crates, sandbags)
    drawTile(TerrainType.COVER_OBJECT, (x) => {
      ctx.fillStyle = '#555555'; // road underneath
      ctx.fillRect(x, 0, ts, ts);
      // The cover object itself
      ctx.fillStyle = '#8a7a5a';
      ctx.fillRect(x + 4, 4, ts - 8, ts - 8);
      ctx.strokeStyle = '#6a5a3a';
      ctx.strokeRect(x + 4, 4, ts - 8, ts - 8);
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
   * Infantry: colored circles arranged in a small formation.
   * Canvas is sized to fit all members in a loose cluster.
   */
  private generateInfantrySprite(
    type: string,
    color: number,
    squadSize: number,
  ): void {
    const memberDiameter = 8;
    const spacing = 10;
    // Arrange in a small grid (max 2 columns)
    const cols = Math.min(squadSize, 2);
    const rows = Math.ceil(squadSize / cols);
    const w = cols * spacing + memberDiameter;
    const h = rows * spacing + memberDiameter;

    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    const r = memberDiameter / 2;
    const hexColor = color;

    for (let i = 0; i < squadSize; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = r + col * spacing;
      const cy = r + row * spacing;
      gfx.fillStyle(hexColor, 1);
      gfx.fillCircle(cx, cy, r);
      // Darker outline
      gfx.lineStyle(1, darkenColor(hexColor, 0.5), 1);
      gfx.strokeCircle(cx, cy, r);
    }

    // Directional indicator: small triangle at the top-center
    const triX = w / 2;
    const triY = -2;
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillTriangle(triX, triY, triX - 3, triY + 5, triX + 3, triY + 5);

    gfx.generateTexture(`unit-${type}`, w, h);
    gfx.destroy();
  }

  /**
   * Vehicles: colored rectangles with a directional triangle.
   * Cars: 16x10, Trucks: 20x12
   */
  private generateVehicleSprite(type: string, color: number): void {
    const isTruck =
      type === UnitType.DELIVERY_TRUCK || type === UnitType.ARMORED_TRUCK;
    const vw = isTruck ? 20 : 16;
    const vh = isTruck ? 12 : 10;

    const gfx = this.make.graphics({ x: 0, y: 0 }, false);

    // Body
    gfx.fillStyle(color, 1);
    gfx.fillRect(0, 0, vw, vh);
    gfx.lineStyle(1, darkenColor(color, 0.5), 1);
    gfx.strokeRect(0, 0, vw, vh);

    // Directional indicator (front triangle)
    gfx.fillStyle(0xffffff, 0.8);
    gfx.fillTriangle(vw, vh / 2, vw - 4, vh / 2 - 3, vw - 4, vh / 2 + 3);

    gfx.generateTexture(`unit-${type}`, vw, vh);
    gfx.destroy();
  }

  // ── Building Sprites ────────────────────────────────────────────────────────

  private generateBuildingSprites(): void {
    for (const bType of Object.values(BuildingType)) {
      const def = BUILDING_DEFS[bType];
      if (!def) continue;

      const w = def.widthTiles * TILE_SIZE;
      const h = def.heightTiles * TILE_SIZE;

      const gfx = this.make.graphics({ x: 0, y: 0 }, false);

      // Fill
      gfx.fillStyle(def.color, 1);
      gfx.fillRect(0, 0, w, h);

      // 2px border, slightly lighter
      gfx.lineStyle(2, lightenColor(def.color, 0.3), 1);
      gfx.strokeRect(1, 1, w - 2, h - 2);

      // Center letter identifying the building type
      gfx.generateTexture(`building-${bType}`, w, h);
      gfx.destroy();

      // We cannot easily draw text with Graphics, so stamp a letter via
      // a canvas texture overlay.
      this.addBuildingLabel(bType, w, h, def.color);
    }
  }

  /**
   * Draws a single identifying letter on top of the building texture using
   * a CanvasTexture so we get real text rendering.
   */
  private addBuildingLabel(
    type: string,
    w: number,
    h: number,
    bgColor: number,
  ): void {
    const key = `building-${type}`;
    // The texture already exists from generateTexture; get its canvas
    const tex = this.textures.get(key);
    if (!tex || tex.key === '__MISSING') return;

    // Create a temporary canvas and composite the letter
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
    ctx.fillText(label, w / 2, h / 2);

    canvas.refresh();

    // Replace original texture with labeled version
    this.textures.remove(key);
    this.textures.renameTexture(`${key}-tmp`, key);
  }

  // ── UI Elements ─────────────────────────────────────────────────────────────

  private generateUIElements(): void {
    // Selection circle (green ring, 32px)
    this.makeGraphicTexture('ui-selection', 32, 32, (gfx) => {
      gfx.lineStyle(2, 0x00ff00, 0.8);
      gfx.strokeCircle(16, 16, 14);
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

    // Street corner marker (small diamond, 12x12)
    this.makeGraphicTexture('ui-corner-marker', 12, 12, (gfx) => {
      gfx.fillStyle(0xffcc00, 0.9);
      gfx.fillTriangle(6, 0, 12, 6, 6, 12);
      gfx.fillTriangle(6, 0, 0, 6, 6, 12);
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
