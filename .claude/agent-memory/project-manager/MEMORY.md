# The Commission Prototype -- Project Manager Memory

## Project Overview
- **Type**: Phaser 3 + TypeScript RTS game prototype (1920s organized crime theme)
- **Repo**: `joshhallick6-glitch/TheCommission-Prototype` on GitHub
- **Location**: `C:\Users\jhhal\Desktop\Claude\TheCommission-Prototype\`
- **GDD**: `C:\Users\jhhal\Desktop\Claude\TheCommission\GDD_TheCommission.md`

## Tech Stack
- Phaser 3.90+ (game engine), TypeScript, Vite 7
- EasyStar.js for A* pathfinding
- No external art assets -- all textures generated in BootScene

## Architecture
- `src/main.ts` -- Entry point, Phaser game config (1280x720, pixelArt mode)
- `src/data/config.ts` -- All game constants (map 160x160, economy, combat, terrain)
- `src/data/units.ts` -- 14 unit types (UnitType enum + UNIT_DEFS record)
- `src/data/buildings.ts` -- 15 building types (BuildingType enum + BUILDING_DEFS record)
- `src/utils/EventBus.ts` -- Typed pub/sub (GameEvents constants)
- Three scenes: BootScene -> GameScene -> UIScene (overlay)

## GitHub Issue Tracking
- **Labels**: `system`, `milestone`, `follow-up`
- **Milestone**: "Vertical Slice v0.1" (milestone #1, 13 issues)
- Issues #1-6: Core systems (BootScene+Map, Unit, Building, Combat, Economy+Logistics, UI)
- Issues #7-13: Integration milestones (first render, unit, capture, fight, economy, logistics, playable)
- Issues #14-17: Follow-up work (AI gangs, fog of war, sound, multiplayer)

## Key Constants
- Map: 160x160 tiles, 32px tile size = 5120x5120 world
- Starting resources: $500 cash, 0 goods, 0 influence
- Economy tick: 1000ms
- Capture: 5s neutral, 10s enemy
- Cover: 40% reduction, Garrison: 60%, Flank: +30%
