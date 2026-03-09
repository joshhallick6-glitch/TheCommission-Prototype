// ─── Game Configuration Constants ────────────────────────────────────────────

// Isometric tile dimensions (AoE2-style 2:1 diamond ratio)
export const TILE_WIDTH = 64;    // Isometric tile width (horizontal span)
export const TILE_HEIGHT = 32;   // Isometric tile height (vertical span)
export const TILE_SIZE = 32;     // Legacy: used for pathfinding grid spacing

export const MAP_WIDTH = 160;    // tiles
export const MAP_HEIGHT = 160;   // tiles

// Isometric world bounds: the diamond-shaped map projects into a larger rect
// Width = (MAP_WIDTH + MAP_HEIGHT) * TILE_WIDTH / 2
// Height = (MAP_WIDTH + MAP_HEIGHT) * TILE_HEIGHT / 2
export const WORLD_WIDTH = (MAP_WIDTH + MAP_HEIGHT) * (TILE_WIDTH / 2);   // 10240px
export const WORLD_HEIGHT = (MAP_WIDTH + MAP_HEIGHT) * (TILE_HEIGHT / 2); // 5120px

export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 720;

export const CAMERA_SCROLL_SPEED = 12;
export const CAMERA_EDGE_ZONE = 40;  // px from edge to trigger scroll
export const CAMERA_ZOOM_MIN = 0.25;
export const CAMERA_ZOOM_MAX = 2.0;
export const CAMERA_ZOOM_STEP = 0.1;

// ─── Timing ──────────────────────────────────────────────────────────────────

export const TICK_RATE = 1000;              // ms per economy tick
export const CAPTURE_TIME_BASE = 5000;      // ms to capture a neutral building
export const CAPTURE_TIME_ENEMY = 10000;    // ms to capture an enemy building

// ─── Economy ─────────────────────────────────────────────────────────────────

export const STARTING_CASH = 500;
export const STARTING_GOODS = 0;
export const STARTING_INFLUENCE = 0;
export const BUILDING_MAINTENANCE = 5;  // $/min per building

// ─── Tier Advancement ────────────────────────────────────────────────────────

export const TIER_COSTS = {
  2: { cash: 400, goods: 100, influence: 30, time: 60000 },
  3: { cash: 1200, goods: 350, influence: 100, time: 90000 },
  4: { cash: 3000, goods: 800, influence: 250, time: 120000 },
} as const;

// ─── Territory ───────────────────────────────────────────────────────────────

export const STREET_CORNER_RADIUS = 4;    // tiles
export const INFLUENCE_PER_CORNER = 1;    // per minute

// ─── Combat ──────────────────────────────────────────────────────────────────

export const COVER_DAMAGE_REDUCTION = 0.4;     // 40% less damage in cover
export const GARRISON_DAMAGE_REDUCTION = 0.6;  // 60% less damage garrisoned
export const FLANK_DAMAGE_BONUS = 0.3;         // 30% more damage from flank
export const RETREAT_SPEED_MULTIPLIER = 1.5;
export const RETREAT_DPS_MULTIPLIER = 0.3;
export const VETERANCY_BONUS = 0.1;  // 10% per level, max 3 levels

// ─── Colors (player identification) ──────────────────────────────────────────

export const PLAYER_COLORS = {
  0: 0xCC0000,  // Player 1: deep red
  1: 0x0044CC,  // Player 2: deep blue
  neutral: 0x888888,
  gang: 0x44AA44,
} as const;

// ─── Map Terrain Types ───────────────────────────────────────────────────────

export enum TerrainType {
  ROAD = 0,
  SIDEWALK = 1,
  BUILDING_FLOOR = 2,
  WALL = 3,
  ALLEY = 4,         // passable by infantry only
  PARK = 5,
  WATER = 6,         // impassable
  BRIDGE = 7,
  COVER_OBJECT = 8,  // car, crate, sandbag — provides cover
}

// ─── Pathfinding costs per terrain ───────────────────────────────────────────

export const TERRAIN_COSTS: Record<TerrainType, number> = {
  [TerrainType.ROAD]: 1,
  [TerrainType.SIDEWALK]: 1.2,
  [TerrainType.BUILDING_FLOOR]: 1.5,
  [TerrainType.WALL]: Infinity,
  [TerrainType.ALLEY]: 1.3,
  [TerrainType.PARK]: 1.4,
  [TerrainType.WATER]: Infinity,
  [TerrainType.BRIDGE]: 1,
  [TerrainType.COVER_OBJECT]: 1.5,
};

// passability for vehicles (can't use alleys or building interiors)
export const VEHICLE_TERRAIN_COSTS: Record<TerrainType, number> = {
  [TerrainType.ROAD]: 1,
  [TerrainType.SIDEWALK]: 1.5,
  [TerrainType.BUILDING_FLOOR]: Infinity,
  [TerrainType.WALL]: Infinity,
  [TerrainType.ALLEY]: Infinity,
  [TerrainType.PARK]: Infinity,
  [TerrainType.WATER]: Infinity,
  [TerrainType.BRIDGE]: 1,
  [TerrainType.COVER_OBJECT]: Infinity,
};
