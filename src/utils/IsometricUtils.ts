// ─── Isometric Coordinate Utilities ──────────────────────────────────────────
// Standard 2:1 isometric projection (AoE2-style diamond map).
//
// Coordinate spaces:
//   TILE (cartesian): (tileX, tileY) — integer grid positions [0..MAP_WIDTH)
//   WORLD (isometric pixel): (worldX, worldY) — screen-space pixel positions
//     where worldX goes right, worldY goes down.
//
// The isometric projection maps the cartesian grid into diamond-shaped tiles:
//   - Tile (0,0) is at the top center of the world
//   - Increasing tileX goes to the lower-right
//   - Increasing tileY goes to the lower-left

import { TILE_WIDTH, TILE_HEIGHT, MAP_WIDTH, MAP_HEIGHT } from '../data/config';

const HALF_W = TILE_WIDTH / 2;   // 32
const HALF_H = TILE_HEIGHT / 2;  // 16

// ─── Tile → World (center of tile) ──────────────────────────────────────────

export function tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
  return {
    x: (tileX - tileY) * HALF_W + (MAP_HEIGHT * HALF_W),
    y: (tileX + tileY) * HALF_H,
  };
}

// ─── World → Tile ───────────────────────────────────────────────────────────

export function worldToTile(worldX: number, worldY: number): { x: number; y: number } {
  const adjustedX = worldX - (MAP_HEIGHT * HALF_W);
  const tileX = (adjustedX / HALF_W + worldY / HALF_H) / 2;
  const tileY = (worldY / HALF_H - adjustedX / HALF_W) / 2;
  return { x: Math.floor(tileX), y: Math.floor(tileY) };
}

// ─── World → Tile (float, for sub-tile precision) ───────────────────────────

export function worldToTileFloat(worldX: number, worldY: number): { x: number; y: number } {
  const adjustedX = worldX - (MAP_HEIGHT * HALF_W);
  return {
    x: (adjustedX / HALF_W + worldY / HALF_H) / 2,
    y: (worldY / HALF_H - adjustedX / HALF_W) / 2,
  };
}

// ─── Tile distance (Euclidean in tile space) ────────────────────────────────

export function tileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Depth sorting value ────────────────────────────────────────────────────
// Objects with higher depth values render in front of objects with lower.
// In isometric, depth = tileX + tileY (further from camera = higher sum).

export function isoDepth(tileX: number, tileY: number, layer: number = 0): number {
  return (tileX + tileY) * 10 + layer;
}

// ─── Check if tile is within map bounds ─────────────────────────────────────

export function isInBounds(tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileX < MAP_WIDTH && tileY >= 0 && tileY < MAP_HEIGHT;
}

// ─── Get the 4 corner points of an isometric tile (for drawing diamonds) ────

export function getTileDiamondPoints(tileX: number, tileY: number): { top: {x: number, y: number}, right: {x: number, y: number}, bottom: {x: number, y: number}, left: {x: number, y: number} } {
  const center = tileToWorld(tileX, tileY);
  return {
    top:    { x: center.x,          y: center.y - HALF_H },
    right:  { x: center.x + HALF_W, y: center.y },
    bottom: { x: center.x,          y: center.y + HALF_H },
    left:   { x: center.x - HALF_W, y: center.y },
  };
}

// ─── Interpolate world position between two tiles (for smooth movement) ─────

export function lerpTilePosition(
  fromTileX: number, fromTileY: number,
  toTileX: number, toTileY: number,
  t: number
): { x: number; y: number } {
  const from = tileToWorld(fromTileX, fromTileY);
  const to = tileToWorld(toTileX, toTileY);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}
