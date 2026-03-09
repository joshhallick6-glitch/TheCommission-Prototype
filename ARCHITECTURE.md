# Architecture Reference -- The Commission Prototype

This document maps the full dependency graph, event system, initialization
order, update pipeline, and data flow for the Phaser 3 / TypeScript prototype.

---

## 1. Scene Flow

```
MenuScene --> LobbyScene --> BootScene --> GameScene (+ UIScene overlay)
```

| Scene | Key | Purpose |
|---|---|---|
| **MenuScene** | `MenuScene` | Noir title screen with rain effect. Click START GAME to proceed. |
| **LobbyScene** | `LobbyScene` | Family selection (Morellis, Ashfords, Korvaks, Solomons). Stores `selectedFamily` index in `this.registry`. |
| **BootScene** | `BootScene` | Generates ALL game textures procedurally (terrain tileset, unit sprites, building sprites, UI elements, particle textures). No external assets. Transitions to GameScene on completion. |
| **GameScene** | `GameScene` | Main gameplay. Creates all systems, handles input (camera, selection, commands), drives update loop. |
| **UIScene** | `UIScene` | HUD overlay launched in parallel by GameScene (`this.scene.launch('UIScene')`). Fixed camera. Resource bar, minimap, selection panel, action bar, alerts. |

**Data handoff between scenes:**
- LobbyScene writes `this.registry.set('selectedFamily', index)` before starting BootScene.
- BootScene reads nothing; it generates textures then starts GameScene.
- GameScene launches UIScene; UIScene grabs a reference via `this.scene.get('GameScene')`.

---

## 2. File Structure and Dependency Map

### 2a. Data Layer (`src/data/`)

#### `config.ts`
Exports: `TILE_WIDTH`, `TILE_HEIGHT`, `TILE_SIZE`, `MAP_WIDTH`, `MAP_HEIGHT`, `WORLD_WIDTH`, `WORLD_HEIGHT`, viewport/camera constants, timing constants (`TICK_RATE`, `CAPTURE_TIME_BASE`, `CAPTURE_TIME_ENEMY`), economy constants (`STARTING_CASH`, `STARTING_GOODS`, `STARTING_INFLUENCE`, `BUILDING_MAINTENANCE`), `TIER_COSTS`, territory constants, combat constants (`COVER_DAMAGE_REDUCTION`, etc.), `PLAYER_COLORS`, `TerrainType` enum, `TERRAIN_COSTS`, `VEHICLE_TERRAIN_COSTS`.

**Imported by:**
`Squad.ts`, `Building.ts`, `MapSystem.ts`, `UnitSystem.ts`, `CombatSystem.ts`, `EconomySystem.ts`, `LogisticsSystem.ts`, `TerritorySystem.ts`, `FogOfWarSystem.ts`, `IsometricUtils.ts`, `BootScene.ts`, `GameScene.ts`, `UIScene.ts`

#### `units.ts`
Exports: `UnitType` enum, `UnitStats` interface, `UNIT_DEFS` record.

**Imported by:**
`Squad.ts`, `Building.ts`, `BootScene.ts`, `GameScene.ts`, `UIScene.ts`

#### `buildings.ts`
Exports: `BuildingType` enum, `BuildingStats` interface, `BUILDING_DEFS` record.

**Imported by:**
`Building.ts`, `MapSystem.ts`, `BuildingSystem.ts`, `BootScene.ts`, `GameScene.ts`

#### `families.ts`
Exports: `FamilyData` interface, `FAMILIES` array.

**Imported by:**
`LobbyScene.ts`

---

### 2b. Entities (`src/entities/`)

#### `Squad.ts`
**Imports from:** `config.ts` (TILE_SIZE, TILE_WIDTH, TILE_HEIGHT, PLAYER_COLORS), `units.ts` (UnitType, UnitStats, UNIT_DEFS), `Pathfinding.ts` (pathfinding), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld, isoDepth)

**Imported by:** `UnitSystem.ts`, `FogOfWarSystem.ts`

**Exports:** `UnitStance` type (`'aggressive' | 'defensive' | 'stand_ground'`)

**Key fields:**
- `stance: UnitStance` -- defaults to `'aggressive'`. Controls auto-engage behavior:
  - **aggressive:** Auto-engages nearby enemies when idle (via enemy scan callback).
  - **defensive:** Fights back when attacked (needs `attacker` param in `takeDamage()`), then returns to original position via `defensiveReturnPosition`.
  - **stand_ground:** Attacks only current target, never chases or auto-engages.
- `setStance(newStance)` -- updates stance and emits `STANCE_CHANGED`.

**Events emitted:** `UNIT_SELECTED`, `UNIT_DESELECTED`, `SQUAD_WIPED`, `STANCE_CHANGED`

**Notable:**
- Exports `setEnemyScanCallback()` which UnitSystem calls to inject enemy proximity scanning for attack-move behavior.
- `takeDamage(amount, attacker?)` accepts an optional `attacker: Squad` reference. CombatSystem passes the attacking squad so defensive-stance units know who to fight back against.

#### `Building.ts`
**Imports from:** `config.ts` (TILE_WIDTH, TILE_HEIGHT, CAPTURE_TIME_BASE, CAPTURE_TIME_ENEMY, PLAYER_COLORS), `buildings.ts` (BuildingType, BuildingStats, BUILDING_DEFS), `units.ts` (UNIT_DEFS), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld, isoDepth, worldToTile)

**Imported by:** `BuildingSystem.ts`, `FogOfWarSystem.ts`

**Events emitted:** `CAPTURE_STARTED`, `CAPTURE_PROGRESS`, `BUILDING_CAPTURED`, `BUILDING_DAMAGED`, `BUILDING_DESTROYED`, `UNIT_PRODUCED`

---

### 2c. Systems (`src/systems/`)

#### `MapSystem.ts`
**Imports from:** `config.ts` (TILE_WIDTH, TILE_HEIGHT, MAP_WIDTH, MAP_HEIGHT, TerrainType, TERRAIN_COSTS, VEHICLE_TERRAIN_COSTS), `buildings.ts` (BuildingType, BUILDING_DEFS)

**Imported by:** `GameScene.ts`

**Exports (types):** `BuildingPlacement`, `StreetCornerPlacement`, `CityBlock` interfaces

**Events emitted:** None (pure data generation)

#### `UnitSystem.ts`
**Imports from:** `config.ts` (TILE_SIZE), `units.ts` (UnitType), `Squad.ts` (Squad, setEnemyScanCallback), `Pathfinding.ts` (pathfinding), `EventBus.ts` (EventBus, GameEvents)

**Imported by:** `GameScene.ts`

**Events listened:** `MOVE_ORDER`, `ATTACK_ORDER`, `SQUAD_WIPED`

**Events emitted:** `SELECTION_CLEARED`, `COMBAT_STARTED`

#### `BuildingSystem.ts`
**Imports from:** `buildings.ts` (BuildingType), `Building.ts` (Building), `EventBus.ts` (EventBus, GameEvents)

**Imported by:** `GameScene.ts`

**Events listened:** `BUILDING_DESTROYED`

**Events emitted:** None directly (delegates to Building entity)

#### `CombatSystem.ts`
**Imports from:** `config.ts` (TILE_SIZE, TerrainType, COVER_DAMAGE_REDUCTION, GARRISON_DAMAGE_REDUCTION, FLANK_DAMAGE_BONUS, RETREAT_DPS_MULTIPLIER, VETERANCY_BONUS), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld)

**Imported by:** `GameScene.ts`

**Events emitted:** `COMBAT_STARTED`, `UNIT_DAMAGED`, `UNIT_KILLED`

**Notable:** Uses `any` types for squad references via `setSquadLookup()`. Reads terrain from `(this.scene as any).tilemap`.

#### `EconomySystem.ts`
**Imports from:** `config.ts` (STARTING_CASH, STARTING_GOODS, STARTING_INFLUENCE, BUILDING_MAINTENANCE, TICK_RATE, TIER_COSTS), `EventBus.ts` (EventBus, GameEvents)

**Imported by:** `GameScene.ts`

**Events emitted:** `CASH_CHANGED`, `GOODS_CHANGED`, `INFLUENCE_CHANGED`, `INCOME_TICK`, `TIER_RESEARCH_STARTED`, `TIER_ADVANCED`

#### `LogisticsSystem.ts`
**Imports from:** `config.ts` (TILE_SIZE), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld)

**Imported by:** `GameScene.ts`

**Events emitted:** `TRUCK_DESTROYED`, `GOODS_DROPPED`, `GOODS_DELIVERED`, `GOODS_PICKED_UP`

**Notable:** Uses `any` types for squad and building references passed via callbacks.

#### `TerritorySystem.ts`
**Imports from:** `config.ts` (TILE_SIZE, TILE_WIDTH, TILE_HEIGHT, STREET_CORNER_RADIUS, PLAYER_COLORS), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld)

**Imported by:** `GameScene.ts`

**Events emitted:** `CORNER_CAPTURED`, `CORNER_LOST`, `INFLUENCE_UPDATED`

#### `FogOfWarSystem.ts`
**Imports from:** `config.ts` (MAP_WIDTH, MAP_HEIGHT, TILE_WIDTH, TILE_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT), `Squad.ts` (Squad), `Building.ts` (Building), `IsometricUtils.ts` (tileToWorld, worldToTile)

**Imported by:** `GameScene.ts`

**Events emitted:** None

---

### 2d. Scenes (`src/scenes/`)

#### `MenuScene.ts`
**Imports from:** Phaser only (no project imports)

#### `LobbyScene.ts`
**Imports from:** `families.ts` (FAMILIES, FamilyData)

#### `BootScene.ts`
**Imports from:** `config.ts` (TILE_WIDTH, TILE_HEIGHT, TerrainType), `buildings.ts` (BUILDING_DEFS, BuildingType), `units.ts` (UNIT_DEFS, UnitType)

#### `GameScene.ts`
**Imports from:** `config.ts` (MAP_WIDTH, MAP_HEIGHT, TILE_WIDTH, TILE_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, camera constants, TIER_COSTS, STARTING_CASH, STARTING_GOODS, STARTING_INFLUENCE), `units.ts` (UnitType, UNIT_DEFS), `buildings.ts` (BuildingType), `MapSystem.ts`, `UnitSystem.ts`, `BuildingSystem.ts`, `CombatSystem.ts`, `EconomySystem.ts`, `LogisticsSystem.ts`, `TerritorySystem.ts`, `FogOfWarSystem.ts`, `Pathfinding.ts` (pathfinding), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld, worldToTile, isoDepth)

**Events listened:** `UNIT_PRODUCED`, `TRANSPORT_GOODS`, `SQUAD_WIPED`

**Events emitted:** `GAME_STARTED`, `GAME_OVER`, `MOVE_ORDER`, `ATTACK_ORDER`, `PRODUCE_UNIT`, `CAPTURE_ORDER`, `RETREAT_ORDER`, `TRANSPORT_GOODS`, `BUILDING_SELECTED`, `SELECTION_BOX`, `GAME_PAUSED`, `GAME_RESUMED`, `GAME_SPEED_CHANGED`

#### `UIScene.ts`
**Imports from:** `config.ts` (MAP_WIDTH, MAP_HEIGHT, PLAYER_COLORS, TIER_COSTS, STARTING_CASH, STARTING_GOODS, STARTING_INFLUENCE), `units.ts` (UnitType, UNIT_DEFS), `EventBus.ts` (EventBus, GameEvents), `IsometricUtils.ts` (tileToWorld, worldToTile)

**Events listened:** `CASH_CHANGED`, `GOODS_CHANGED`, `INFLUENCE_CHANGED`, `INCOME_TICK`, `UNIT_SELECTED`, `UNIT_DESELECTED`, `BUILDING_SELECTED`, `SELECTION_CLEARED`, `STANCE_CHANGED`, `BUILDING_CAPTURED`, `TRUCK_DESTROYED`, `GOODS_DELIVERED`, `TIER_ADVANCED`, `COMBAT_STARTED`, `SQUAD_WIPED`, `GAME_PAUSED`, `GAME_RESUMED`, `GAME_SPEED_CHANGED`, `UNIT_PRODUCED`, `TRANSPORT_GOODS`, `GAME_OVER`

---

### 2e. Utilities (`src/utils/`)

#### `EventBus.ts`
Exports: `EventBus` singleton (global event bus), `GameEvents` constants object.

**Imported by:** `Squad.ts`, `Building.ts`, `UnitSystem.ts`, `BuildingSystem.ts`, `CombatSystem.ts`, `EconomySystem.ts`, `LogisticsSystem.ts`, `TerritorySystem.ts`, `GameScene.ts`, `UIScene.ts`

#### `IsometricUtils.ts`
Exports: `tileToWorld()`, `worldToTile()`, `worldToTileFloat()`, `tileDistance()`, `isoDepth()`, `isInBounds()`, `getTileDiamondPoints()`, `lerpTilePosition()`.

**Imports from:** `config.ts` (TILE_WIDTH, TILE_HEIGHT, MAP_WIDTH, MAP_HEIGHT)

**Imported by:** `Squad.ts`, `Building.ts`, `CombatSystem.ts`, `LogisticsSystem.ts`, `TerritorySystem.ts`, `FogOfWarSystem.ts`, `GameScene.ts`, `UIScene.ts`

#### `Pathfinding.ts`
Exports: `pathfinding` singleton (wraps easystarjs, separate infantry/vehicle grids).

**Imports from:** `easystarjs` (external library)

**Imported by:** `Squad.ts`, `UnitSystem.ts`, `GameScene.ts`

---

## 3. Event Bus Event Map

Every event in `GameEvents`, who emits it, who listens, and the argument signature.

### Selection Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `UNIT_SELECTED` | `Squad.select()` | `UIScene` | `(squad: Squad)` |
| `UNIT_DESELECTED` | `Squad.deselect()` | `UIScene` | `(squad: Squad)` |
| `BUILDING_SELECTED` | `GameScene` (mouse input) | `UIScene` | `(building: Building)` |
| `SELECTION_CLEARED` | `UnitSystem.deselectAll()` | `UIScene` | `()` (no args) |
| `SELECTION_BOX` | `GameScene` (mouse drag) | `UIScene` | `(rect: { x1, y1, x2, y2 })` |

### Command Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `MOVE_ORDER` | `GameScene` (right-click) | `UnitSystem` | `(tileX: number, tileY: number)` |
| `ATTACK_ORDER` | `GameScene` (right-click on enemy) | `UnitSystem` | `(target: Squad)` |
| `CAPTURE_ORDER` | `GameScene` (right-click on building) | `GameScene` (internal handler) | `(buildingId: string, squadIds: string[])` |
| `RETREAT_ORDER` | `GameScene` (R key) | `GameScene` (internal handler) | `(squadIds: string[])` |
| `PRODUCE_UNIT` | `GameScene` (action bar / hotkeys) | `GameScene` (internal handler) | `(data: { buildingId: string, unitType: string })` |
| `TRANSPORT_GOODS` | `GameScene` (action bar) | `GameScene`, `UIScene` | `(data: { buildingId: string, squads: string[] })` |

### Economy Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `CASH_CHANGED` | `EconomySystem` | `UIScene` | `({ player: number, cash: number, delta: number })` |
| `GOODS_CHANGED` | `EconomySystem` | `UIScene` | `({ player: number, goods: number, delta: number })` |
| `INFLUENCE_CHANGED` | `EconomySystem` | `UIScene` | `({ player: number, influence: number, delta: number })` |
| `INCOME_TICK` | `EconomySystem` | `UIScene` | `({ players: Array<{ player, cash, goods, influence, incomePerMin }> })` |

### Territory Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `CORNER_CAPTURED` | `TerritorySystem` | (none currently) | `(cornerId: number, player: number, neighborhood: string)` |
| `CORNER_LOST` | `TerritorySystem` | (none currently) | `(cornerId: number, player: number, neighborhood: string)` |
| `INFLUENCE_UPDATED` | `TerritorySystem` | (none currently) | `()` (no args) |

### Building Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `BUILDING_CAPTURED` | `Building.completeCapture()` | `UIScene` | `({ buildingId, newOwner, previousOwner, type })` |
| `BUILDING_LOST` | (not explicitly emitted) | (none) | -- |
| `BUILDING_DESTROYED` | `Building.destroy()` | `BuildingSystem` | `({ buildingId, type, owner })` |
| `BUILDING_DAMAGED` | `Building.takeDamage()` | (none currently) | `({ buildingId, hp, maxHp })` |
| `CAPTURE_STARTED` | `Building.startCapture()` | (none currently) | `({ buildingId, playerIndex })` |
| `CAPTURE_PROGRESS` | `Building.updateCapture()` | (none currently) | `({ buildingId, progress, playerIndex })` |

### Combat Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `UNIT_DAMAGED` | `Squad.takeDamage()`, `CombatSystem` | (none currently) | `(squad/targetId, amount, [attackerId])` |
| `UNIT_KILLED` | `CombatSystem` | (none currently) | `(targetId: string, attackerId: string)` |
| `SQUAD_WIPED` | `Squad.die()` | `UnitSystem`, `GameScene`, `UIScene` | `(squad: Squad)` |
| `COMBAT_STARTED` | `UnitSystem.attackWithSelected()`, `CombatSystem.engageTarget()` | `UIScene` | `(attackerSquads/attackerId, target/targetId)` |

### Stance Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `STANCE_CHANGED` | `Squad.setStance()` | `UIScene` | `({ squadId: string, stance: UnitStance })` |

### Logistics Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `TRUCK_DESTROYED` | `LogisticsSystem.onTruckDestroyed()` | `UIScene` | `({ squadId, routeId, owner, tileX, tileY, goodsCarried, goodsDropped, goodsLost })` |
| `GOODS_DROPPED` | `LogisticsSystem` (private) | (none currently) | `({ id, tileX, tileY, amount })` |
| `GOODS_DELIVERED` | `LogisticsSystem` (unloading) | `UIScene` | `({ player, amount, routeId, squadId })` |
| `GOODS_PICKED_UP` | `LogisticsSystem` (pickup) | (none currently) | `({ droppedId, squadId, player, amount, tileX, tileY })` |

### Tier Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `TIER_ADVANCED` | `EconomySystem.completeTierResearch()` | `UIScene` | `({ player: number, newTier: number })` |
| `TIER_RESEARCH_STARTED` | `EconomySystem.startTierResearch()` | (none currently) | `({ player: number, targetTier: number })` |

### Production Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `UNIT_PRODUCED` | `Building.updateProduction()` | `GameScene`, `UIScene` | `({ buildingId, unitType, tileX, tileY, rallyPoint })` |

### Game State Events

| Event | Emitted by | Listened by | Arguments |
|---|---|---|---|
| `GAME_STARTED` | `GameScene.create()` | (none currently) | `()` |
| `GAME_OVER` | `GameScene.checkWinConditions()` | `UIScene` | `({ winner: number, reason: string })` |
| `GAME_PAUSED` | `GameScene` (P key) | `UIScene` | `()` |
| `GAME_RESUMED` | `GameScene` (P key) | `UIScene` | `()` |
| `GAME_SPEED_CHANGED` | `GameScene` (+/- keys) | `UIScene` | `(speed: number)` |
| `PLAYER_ELIMINATED` | (not emitted yet) | (none) | -- |

---

## 4. System Initialization Order (GameScene.create)

The order systems are created matters because later systems depend on data
or references from earlier ones.

```
Step  System/Action                        Why this order
----  -----------                          ---------------
 1    MapSystem(scene, seed=42)            Generates the tile grid first. Everything
      mapSystem.generateCity()             else places on top of the grid.
      mapSystem.renderMap() -> tilemap     Creates the Phaser tilemap + layer.

 2    Camera setup                         Needs WORLD_WIDTH/HEIGHT from config.
      physics.world.setBounds()

 3    BuildingSystem(scene)                Needs the scene; does not depend on
      mapSystem.placeBuildings()           other systems, but must run AFTER
      buildingSystem.initializeFromPlace.. MapSystem generates the grid so that
      createCityBlockVisuals()             building placements reference valid tiles.

 4    UnitSystem(scene)                    Needs the scene. Registers EventBus
      pathfinding.setGrid(walk, vehicle)   listeners (MOVE_ORDER, ATTACK_ORDER,
                                           SQUAD_WIPED). Pathfinding grids come
                                           from MapSystem, so MapSystem must exist.

 5    CombatSystem(scene)                  Needs a live reference to the unit
      combatSystem.setSquadLookup(         system's squad map so it can resolve
        unitSystem.squads)                 IDs to objects each tick.

 6    EconomySystem(scene, playerCount=2)  Standalone; just needs scene + player count.

 7    LogisticsSystem(scene)               Standalone; callbacks are injected at
                                           update time, not construction.

 8    TerritorySystem(scene)               Needs scene. Corner placements come
      mapSystem.placeStreetCorners()       from MapSystem (must exist).
      territorySystem.initializeCorners()

 8b   FogOfWarSystem(scene, playerCount=2) Must exist AFTER buildings and units
      fogOfWarSystem.revealRect(...)       so that initial reveal can correctly
      fogOfWarSystem.revealArea(...)       show the starting neighborhood.
      fogOfWarSystem.immediateUpdate(...)  Runs one visibility pass so the first
                                           frame is not fully fogged.

 9    Camera center on P0 compound         Needs BuildingSystem to look up compound.

10    EventBus listeners                   UNIT_PRODUCED: spawns squads (needs
      (UNIT_PRODUCED, TRANSPORT_GOODS,     UnitSystem). TRANSPORT_GOODS: creates
       SQUAD_WIPED)                        logistics routes (needs LogisticsSystem).

11    spawnStartingUnits()                 Spawns 3 Runners + 4 Thugs per player
                                           near their compound.

12    setupKeyboardInput()                 Input handling registered last so all
      setupMouseInput()                    systems exist when commands are issued.

13    scene.launch('UIScene')              UIScene runs in parallel; grabs
                                           GameScene via scene.get().

14    EventBus.emit(GAME_STARTED)          Signals game is fully initialized.
```

---

## 5. System Update Order (GameScene.update)

Called every frame. The order of updates affects which data is "fresh" for
downstream systems.

```
Step  System.update(scaledDelta)          Dependencies & Notes
----  --------------------------          ---------------------
 0    updateCameraScroll(delta)           Always runs (even when paused). Uses raw
                                          delta, not scaled delta.

      -- if paused, return early --

 1    unitSystem.update(scaledDelta)      Calls pathfinding.update() internally,
                                          then updates every squad (movement,
                                          attack-move scanning, combat state,
                                          visual sync). Must run BEFORE combat
                                          so positions are current.

 2    buildingSystem.update(scaledDelta)  Advances production queues for all
                                          buildings. Emits UNIT_PRODUCED when
                                          training completes. Does NOT advance
                                          capture (that is in step 7).

 3    combatSystem.update(scaledDelta)    Accumulates timer; every 500ms resolves
                                          damage for all combat pairs. Reads
                                          squad positions (from step 1) and
                                          terrain from tilemap.

 4    economySystem.update(...)           Runs on TICK_RATE (1000ms). Calculates
                                          income from buildings, subtracts
                                          maintenance. Receives callbacks for:
                                          - getBuildingsByOwner (from BuildingSystem)
                                          - getInfluenceMultiplier (from TerritorySystem)
                                          - getNeighborhoodAt (from MapSystem)
                                          Advances tier research if active.

 5    logisticsSystem.update(...)         Updates truck routes (loading/unloading
                                          state machine), accumulates goods at
                                          production buildings, checks dropped
                                          goods expiry/pickup. Receives callbacks:
                                          - getSquad (from UnitSystem.squads)
                                          - getBuilding (from BuildingSystem.buildings)
                                          - addGoods (from EconomySystem)
                                          - getAllSquads, getAllBuildings

 6    territorySystem.update(...)         Checks each street corner for nearby
                                          squads, updates ownership, recalculates
                                          neighborhood influence every 2s. Receives
                                          callback: getSquadsNearTile (from UnitSystem).

 7    fogOfWarSystem.update(...)          Recalculates visibility grid every 200ms.
                                          Renders fog overlay only when dirty
                                          (visibility changed) OR camera moved.
                                          Skips redraw when stationary + unchanged.
                                          Hides/shows enemy entities at 200ms rate.
                                          Needs all squads + buildings arrays.

 8    Hide garrisoned units               Post-processing: hides sprite/healthbar
                                          for squads in 'garrisoned' state.

 9    buildingSystem.validateCaptures(..) Advances capture timers for buildings
                                          being captured. Checks if capturing
                                          player still has units nearby; cancels
                                          capture if not. Uses UnitSystem.getSquadsAt.

10    checkWinConditions()                Checks if either player has zero buildings.
                                          Emits GAME_OVER if so.
```

**Why this order matters:**
- Units must move before combat resolves (step 1 before 3) so range checks use current positions.
- Buildings must update production before economy ticks (step 2 before 4) so newly produced units spend resources correctly.
- Economy needs territory influence data (step 4 needs 6 from PREVIOUS frame) for income multipliers.
- Fog of war runs last among systems (step 7) so it has the most up-to-date positions for visibility.
- Capture validation (step 9) runs after systems but uses the same frame's squad positions.

---

## 6. Data Flow Diagram

```
                            +-----------+
                            |  Registry |
                            | (family   |
                            |  index)   |
                            +-----+-----+
                                  |
                                  v
                           +------+------+
                           | LobbyScene  |
                           +------+------+
                                  |
                                  v
                           +------+------+
                           |  BootScene  |  (generates textures)
                           +------+------+
                                  |
                                  v
        +----------------------------------------------------+
        |                    GameScene                        |
        |                                                    |
        |  +-----------+    +-------------+    +----------+  |
        |  | MapSystem |--->| Pathfinding |    | Building |  |
        |  | (grid,    |    | (EasyStar)  |    | System   |  |
        |  |  terrain) |    +------+------+    +----+-----+  |
        |  +-----+-----+          ^                 |        |
        |        |                 |                 |        |
        |        |    grid data    |    squad lookup |        |
        |        +--------+-------+                 |        |
        |                 |                         |        |
        |           +-----+------+                  |        |
        |           | UnitSystem |<----- MOVE/ATTACK orders  |
        |           +-----+------+                  |        |
        |                 |                         |        |
        |                 | squad refs              |        |
        |                 v                         v        |
        |           +-----+------+    +-------+----------+   |
        |           |  Combat    |    | Economy | Logist. |   |
        |           |  System    |    | System  | System  |   |
        |           +-----+------+    +----+----+----+----+   |
        |                 |                |         |        |
        |                 |  damage events |  goods  |        |
        |                 v                v  flow   v        |
        |           +-----+------+    +----+----------+      |
        |           |  Territory |    |  FogOfWar     |      |
        |           |  System    |    |  System       |      |
        |           +-----+------+    +-------+-------+      |
        |                 |                   |              |
        +----------------------------------------------------+
                          |                   |
              influence   |     hide/show     |
              multiplier  |     entities      |
                          v                   v
                    +-----+-----+   +---------+----------+
                    |  Economy   |   |   Entities         |
                    |  (income   |   | (Squad, Building)  |
                    |   calc)    |   | sprites visible/   |
                    +-----+-----+   | hidden by fog      |
                          |         +--------------------+
                          |
              events      |
                          v
        +----------------------------------------------------+
        |                    UIScene                          |
        |                                                    |
        |  +----------+  +-----------+  +--------+           |
        |  | Resource |  | Selection |  | Action |           |
        |  | Bar      |  | Panel     |  | Bar    |           |
        |  +----------+  +-----------+  +--------+           |
        |                                                    |
        |  +----------+  +-----------+                       |
        |  | Minimap  |  | Alerts    |                       |
        |  +----------+  +-----------+                       |
        +----------------------------------------------------+
```

**Key data flows:**

1. **Map -> Pathfinding:** MapSystem generates walkable/vehicle grids; these initialize the EasyStar instances in Pathfinding.
2. **Input -> EventBus -> UnitSystem:** Player clicks emit MOVE_ORDER or ATTACK_ORDER; UnitSystem listens and commands squads.
3. **Buildings -> Economy:** EconomySystem calls `getBuildingsByOwner()` each tick to calculate income from owned buildings.
4. **Territory -> Economy:** TerritorySystem's `getInfluenceMultiplier()` scales building income based on neighborhood control.
5. **Logistics -> Economy:** When a truck delivers goods, LogisticsSystem calls `addGoods()` callback provided by EconomySystem.
6. **Buildings -> LogisticsSystem:** Goods accumulate at production buildings (`goodsStored`); trucks pick them up.
7. **All Systems -> EventBus -> UIScene:** All resource changes, alerts, and state updates flow through events to the HUD.
8. **FogOfWar -> Entities:** FogOfWarSystem directly sets `sprite.setVisible()` on enemy squads and buildings based on visibility state.

---

## 7. Key Gotchas

### EventBus is a Global Singleton
The `EventBus` is a module-level singleton (`new EventBusClass()` exported directly). Listeners persist across scene restarts unless explicitly removed. Systems with arrow-function handlers (UnitSystem, BuildingSystem) clean up in their `destroy()` methods. **If a scene restarts without calling `EventBus.clear()` or per-system cleanup, stale listeners will fire on dead objects.**

### `any` Types for Cross-System References
Several systems use `any` for cross-references to avoid circular imports:
- `CombatSystem.squadLookup: Map<string, any>` -- resolves squad IDs to objects
- `CombatSystem.engageTarget(attackerSquad: any, targetSquad: any)`
- `LogisticsSystem.update()` callbacks return `any | null`
- `EconomySystem.update()` receives `getBuildingsByOwner: (owner: number) => any[]`
- `GameScene.economySystem: any`, `logisticsSystem: any`, `territorySystem: any`

This means TypeScript cannot catch mismatched property access at compile time. Treat these interfaces carefully.

### TILE_SIZE (32) is Legacy
`TILE_SIZE = 32` exists in config.ts for backward compatibility with pathfinding grid spacing and some hit-detection code (UnitSystem.getSquadAtPixel, LogisticsSystem.drawDroppedGoodsSprite). **For isometric rendering and coordinate conversion, always use `TILE_WIDTH` (64) and `TILE_HEIGHT` (32).** The isometric projection uses a 2:1 diamond ratio.

### Isometric Tilemap Orientation Patch
Phaser's `make.tilemap({ data })` always creates an ORTHOGONAL map internally. MapSystem patches the orientation to `Phaser.Tilemaps.Orientation.ISOMETRIC` on both the Tilemap and its LayerData objects before calling `createLayer()`. This is a necessary workaround because `Parse2DArray` does not support an orientation parameter.

### CombatSystem Reads Terrain via Scene Cast
`CombatSystem.getTerrainAt()` reads terrain by casting `this.scene` to `any` and accessing `.tilemap`. GameScene sets `(this as any).tilemap = this.tilemap` in its create method to make this work.

### Dual UNIT_DAMAGED Emission
Both `Squad.takeDamage()` and `CombatSystem.resolveCombatTick()` emit `UNIT_DAMAGED` with different argument signatures. The Squad emits `(squad, amount)` while CombatSystem emits `(targetId, amount, attackerId)`. Any listener must handle both shapes.

### Dual COMBAT_STARTED Emission
Both `UnitSystem.attackWithSelected()` and `CombatSystem.engageTarget()` emit `COMBAT_STARTED` with different argument signatures. UnitSystem passes `(selectedSquads[], targetSquad)` while CombatSystem passes `(attackerId, targetId)`.

### Building.update() vs BuildingSystem.validateCaptures()
Building.update() advances the production queue but does NOT advance capture progress. Capture is solely driven by `BuildingSystem.validateCaptures()`, which is called separately in GameScene.update() with a callback that counts nearby squads. This split exists so capture speed scales with squad proximity.

### Fog of War Rendering is Optimized with Dirty Flags
FogOfWarSystem recalculates the visibility grid only every 200ms (not every frame). The fog overlay is **not** redrawn every frame -- it uses a multi-layer dirty-flag system to skip unnecessary redraws:

1. **Dirty flag:** Set when `updateVisibility()` runs (every 200ms) or when `revealArea()`/`revealRect()`/`immediateUpdate()` are called.
2. **Camera movement detection:** Tracks the last camera viewport position. The fog is redrawn only when the camera moves more than 1px (avoids sub-pixel jitter redraws).
3. **Viewport snapshot comparison:** When the dirty flag fires but the camera hasn't moved, the system compares the current visibility values within the viewport against a saved snapshot. If nothing on-screen actually changed (e.g., no units moved into/out of sight), the redraw is skipped entirely.

When the camera is stationary and visibility hasn't changed, Phaser reuses the existing Graphics command buffer at zero additional cost -- no `clear()` + rebuild cycle. This eliminates the ~22,000 Graphics API calls per frame that previously ran on every frame.

Entity visibility (hide/show enemy sprites) is also only updated at the 200ms interval.

### Pathfinding is Asynchronous
`pathfinding.findPath()` returns a Promise. Path calculations are advanced by calling `pathfinding.update()` (done inside `UnitSystem.update()`). If many paths are requested simultaneously, they may not all resolve in the same frame (capped at 1000 iterations per frame per EasyStar instance).

### Game Speed Multiplier
When game speed is changed (+/- keys), `delta` is multiplied by `gameSpeed` to produce `scaledDelta`. All system updates use `scaledDelta`. Camera scrolling uses raw `delta` so it remains responsive regardless of game speed. Pause (P key) short-circuits the update loop entirely.

### UIScene Reads GameScene via scene.get()
UIScene gets a reference to GameScene with `this.scene.get('GameScene')` and casts it to `any` to call methods like `handleTierAdvance()`. This is a loose coupling point.

### Minimap Reads Fog State Directly
UIScene's minimap renderer reads `fogOfWarSystem.visibility[]` directly (the array is public) to determine which areas to dim on the minimap, rather than going through events.

### Unit Stance System
Squads have a `stance` field (`UnitStance` type: `'aggressive' | 'defensive' | 'stand_ground'`) that controls automatic engagement and movement behavior:

- **Aggressive** (default): Idle squads automatically scan for and engage nearby enemies within sight range using `enemyScanFn`. This is in addition to the existing attack-move scan that runs while units are moving toward a destination.
- **Defensive**: Squads do not auto-engage enemies. When attacked (via `takeDamage` receiving an `attacker` argument from CombatSystem), the squad saves its current tile position as `defensiveReturnPosition`, sets the attacker as its target, and enters the `attacking` state. After combat ends (target dies), the squad navigates back to the saved position instead of going idle immediately.
- **Stand Ground**: Squads attack enemies in range but never chase. In `updateCombat()`, if the target moves out of weapon range, the squad drops the target and returns to `idle` instead of pathfinding toward the enemy. Squads can still be ordered to move; they move to the new position then resume standing ground.

Stance is changed via `Squad.setStance()`, which emits `STANCE_CHANGED`. The UIScene action bar shows three stance buttons (A/D/S) when units are selected, with the active stance highlighted. Clicking a stance button sets it on all selected squads.
