# QA Tester Memory — TheCommission-Prototype

## Project Type
Phaser 3.90.0 + TypeScript RTS game. No Python code — ruff/mypy/pytest all N/A.
Vite bundler, ESM modules, `esModuleInterop: true`.

## Known Bug Patterns

### System Constructor/Call Signature Mismatches (confirmed, fixed 2026-03-08)
- `EconomySystem` constructor is `(scene, playerCount)` — GameScene was calling it wrong
- `EconomySystem.update()` expects callback functions, not system instances
- `LogisticsSystem.update()` expects callback functions, not system instances
- `TerritorySystem.update()` expects a callback function, not system instances
- Root cause: systems are designed with dependency injection (callbacks), not direct references

### EventBus Payload Shape Mismatches (confirmed, fixed 2026-03-08)
- `EconomySystem` emits objects `{ player, cash, delta }` but UIScene listeners expected positional args
- `CombatSystem` was emitting `SQUAD_WIPED` with string IDs; `UnitSystem` expected Squad object
- Always check the emitter's `EventBus.emit()` call to confirm payload shape, not just the listener

### ESM / require() (confirmed, fixed 2026-03-08)
- Vite builds are ESM — `require()` calls crash at runtime with "require is not defined"
- GameScene had try/catch blocks using `require()` for EconomySystem/LogisticsSystem/TerritorySystem
- Fix: use static ESM imports; all three systems exist in the codebase

### Texture Key Naming (confirmed, fixed 2026-03-08)
- BootScene generates unit textures as `unit-${type}` (hyphen)
- Squad.ts was looking for `unit_${type}` (underscore) — always used fallback
- Pattern: BootScene uses hyphen separators for all generated texture keys

## Files That Are Error-Prone
- `src/scenes/GameScene.ts` — orchestrator that wires all systems; signature mismatches collect here
- `src/scenes/UIScene.ts` — EventBus listener payload shapes are a frequent mismatch point
- `src/systems/EconomySystem.ts` — uses dependency injection callbacks, not direct system refs

## Architecture Notes
- All systems use EventBus for decoupled communication (see `src/utils/EventBus.ts`)
- Systems accept callbacks for cross-system data access (not direct references) to avoid circular deps
- Squad entity has a fallback texture generator — texture key mismatches won't crash but will look wrong
- `easystarjs` exports `{ js: ... }` as CommonJS; `import EasyStar from 'easystarjs'` + `new EasyStar.js()` works with esModuleInterop

## Test Coverage
No test directory exists. This is a browser game with no automated tests.
