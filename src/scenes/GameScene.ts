// ─── Game Scene ─────────────────────────────────────────────────────────────
// The main gameplay scene. Creates all systems, wires them together, handles
// input (camera, selection, commands), and drives the update loop.

import Phaser from 'phaser';
import {
  TILE_SIZE,
  MAP_WIDTH,
  MAP_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  CAMERA_SCROLL_SPEED,
  CAMERA_EDGE_ZONE,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_STEP,
  TIER_COSTS,
  STARTING_CASH,
  STARTING_GOODS,
  STARTING_INFLUENCE,
} from '../data/config';
import { UnitType, UNIT_DEFS } from '../data/units';
import { MapSystem } from '../systems/MapSystem';
import { UnitSystem } from '../systems/UnitSystem';
import { BuildingSystem } from '../systems/BuildingSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { LogisticsSystem } from '../systems/LogisticsSystem';
import { TerritorySystem } from '../systems/TerritorySystem';
import { FogOfWarSystem } from '../systems/FogOfWarSystem';
import { pathfinding } from '../utils/Pathfinding';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld, worldToTile as isoWorldToTile } from '../utils/IsometricUtils';

// ─── Keyboard key references ────────────────────────────────────────────────

interface CameraKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
}

// ─── GameScene ──────────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
  // ── Systems (use `any` for systems that may not yet exist) ────────────
  mapSystem!: MapSystem;
  unitSystem!: UnitSystem;
  buildingSystem!: BuildingSystem;
  combatSystem!: CombatSystem;
  economySystem: any = null;
  logisticsSystem: any = null;
  territorySystem: any = null;
  fogOfWarSystem: FogOfWarSystem | null = null;

  // ── Tilemap reference ─────────────────────────────────────────────────
  tilemap!: Phaser.Tilemaps.Tilemap;

  // ── Selection state ───────────────────────────────────────────────────
  selectionBox: Phaser.GameObjects.Rectangle | null = null;
  selectionStart: { x: number; y: number } | null = null;
  isDragging: boolean = false;

  // ── Input ─────────────────────────────────────────────────────────────
  private cameraKeys!: CameraKeys;
  private actionKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private selectedBuilding: any = null;
  private spaceCycleIndex: number = 0;

  // ── Control Groups (Feature 2) ──────────────────────────────────────
  private controlGroups: Map<number, string[]> = new Map();
  private lastGroupKeyTime: Map<number, number> = new Map();

  // ── Double-Click Detection (Feature 7) ──────────────────────────────
  private lastClickTime: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;

  // ── Idle Unit Finder (Feature 8) ────────────────────────────────────
  private idleCycleIndex: number = 0;

  // ── Attack-Move Mode ──────────────────────────────────────────────
  private attackMoveMode: boolean = false;

  // ── Pause (Feature 4) ──────────────────────────────────────────────
  private isPaused: boolean = false;

  // ── Game Speed (Feature 5) ─────────────────────────────────────────
  private gameSpeed: number = 1.0;

  constructor() {
    super({ key: 'GameScene' });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════

  create(): void {
    // ── 1. Initialize map ───────────────────────────────────────────────
    this.mapSystem = new MapSystem(this, 42);
    this.mapSystem.generateCity();
    this.tilemap = this.mapSystem.renderMap();

    // Expose tilemap on the scene so CombatSystem can read terrain
    (this as any).tilemap = this.tilemap;

    // Set world bounds
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // ── 2. Initialize camera ────────────────────────────────────────────
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    cam.setZoom(1.0);

    // ── 3. Initialize building system ───────────────────────────────────
    this.buildingSystem = new BuildingSystem(this);
    const buildingPlacements = this.mapSystem.placeBuildings();
    this.buildingSystem.initializeFromPlacements(buildingPlacements);

    // ── 4. Initialize unit system & pathfinding ─────────────────────────
    this.unitSystem = new UnitSystem(this);

    // Feed pathfinding grids from the map
    const walkableGrid = this.mapSystem.getWalkableGrid();
    const vehicleGrid = this.mapSystem.getVehicleGrid();
    pathfinding.setGrid(walkableGrid, vehicleGrid);

    // ── 5. Initialize combat system ─────────────────────────────────────
    this.combatSystem = new CombatSystem(this);
    this.combatSystem.setSquadLookup(this.unitSystem.squads);

    // ── 6. Initialize economy system ────────────────────────────────────
    this.economySystem = new EconomySystem(this, 2);

    // ── 7. Initialize logistics system ──────────────────────────────────
    this.logisticsSystem = new LogisticsSystem(this);

    // ── 8. Initialize territory system ──────────────────────────────────
    this.territorySystem = new TerritorySystem(this);
    const corners = this.mapSystem.placeStreetCorners();
    this.territorySystem.initializeCorners(corners);

    // ── 8b. Initialize fog of war system ────────────────────────────────
    this.fogOfWarSystem = new FogOfWarSystem(this, 2);

    // ── 9. Center camera on Player 0's compound ─────────────────────────
    const p0Compound = this.buildingSystem.getCompound(0);
    if (p0Compound) {
      const centerTile = tileToWorld(
        p0Compound.tileX + Math.floor(p0Compound.stats.widthTiles / 2),
        p0Compound.tileY + Math.floor(p0Compound.stats.heightTiles / 2),
      );
      cam.centerOn(centerTile.x, centerTile.y);
    } else {
      // Fallback: center on map center
      const fallback = tileToWorld(80, 80);
      cam.centerOn(fallback.x, fallback.y);
    }

    // ── 10. Listen for unit production ──────────────────────────────────
    EventBus.on(GameEvents.UNIT_PRODUCED, (data: {
      buildingId: string;
      unitType: string;
      tileX: number;
      tileY: number;
      rallyPoint: { x: number; y: number } | null;
    }) => {
      // Spawn the new squad at the building's position
      const spawnPos = this.findNearbyWalkable(
        data.tileX + 2, // offset to spawn outside the building
        data.tileY + 2,
      );
      const newSquad = this.unitSystem.spawnSquad(
        data.unitType as UnitType,
        0, // player 0 -- only player buildings produce
        spawnPos.x,
        spawnPos.y,
      );

      // If rally point exists, issue a move command to it
      if (data.rallyPoint) {
        newSquad.moveTo(data.rallyPoint.x, data.rallyPoint.y);
      }
    });

    // ── 11. Spawn starting units ────────────────────────────────────────
    this.spawnStartingUnits();

    // ── 12. Set up input handling ───────────────────────────────────────
    this.setupKeyboardInput();
    this.setupMouseInput();

    // ── 13. Launch UI scene in parallel ─────────────────────────────────
    this.scene.launch('UIScene');

    // ── 14. Signal game started ─────────────────────────────────────────
    EventBus.emit(GameEvents.GAME_STARTED);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STARTING UNITS
  // ═══════════════════════════════════════════════════════════════════════

  private spawnStartingUnits(): void {
    // Spawn units near each player's compound
    for (let player = 0; player <= 1; player++) {
      const compound = this.buildingSystem.getCompound(player);
      if (!compound) continue;

      // Calculate spawn positions around the compound
      const baseTileX = compound.tileX + compound.stats.widthTiles + 1;
      const baseTileY = compound.tileY;

      // 3 Runner squads
      for (let i = 0; i < 3; i++) {
        const spawnX = this.findNearbyWalkable(baseTileX + i * 2, baseTileY);
        this.unitSystem.spawnSquad(UnitType.RUNNER, player, spawnX.x, spawnX.y);
      }

      // 4 Thug squads
      for (let i = 0; i < 4; i++) {
        const spawnX = this.findNearbyWalkable(baseTileX + i * 2, baseTileY + 2);
        this.unitSystem.spawnSquad(UnitType.THUG, player, spawnX.x, spawnX.y);
      }
    }
  }

  /**
   * Find a walkable tile near the given coordinates, spiraling outward.
   * Returns the tile coordinates of the nearest walkable tile.
   */
  private findNearbyWalkable(tileX: number, tileY: number): { x: number; y: number } {
    // Clamp to map bounds
    tileX = Math.max(0, Math.min(MAP_WIDTH - 1, tileX));
    tileY = Math.max(0, Math.min(MAP_HEIGHT - 1, tileY));

    if (this.mapSystem.isWalkable(tileX, tileY, false)) {
      return { x: tileX, y: tileY };
    }

    // Spiral search
    for (let r = 1; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
          const nx = tileX + dx;
          const ny = tileY + dy;
          if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
            if (this.mapSystem.isWalkable(nx, ny, false)) {
              return { x: nx, y: ny };
            }
          }
        }
      }
    }

    // Fallback
    return { x: tileX, y: tileY };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INPUT SETUP
  // ═══════════════════════════════════════════════════════════════════════

  private setupKeyboardInput(): void {
    if (!this.input.keyboard) return;

    // Camera movement keys
    this.cameraKeys = {
      W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      UP: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      DOWN: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      LEFT: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      RIGHT: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    };

    // Action keys
    this.actionKeys = {
      STOP: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      RETREAT: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      GARRISON: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G),
      TIER: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T),
      SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      TAB: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
    };

    // ── Standard action hotkeys ─────────────────────────────────────────
    this.input.keyboard.on('keydown-R', () => this.handleRetreat());
    this.input.keyboard.on('keydown-G', () => this.handleGarrison());
    this.input.keyboard.on('keydown-T', () => this.handleTierAdvance());
    this.input.keyboard.on('keydown-SPACE', () => this.handleSpaceCycle());
    this.input.keyboard.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      this.handleMinimapToggle();
    });

    // ── Stop command (X key, Feature 6) ─────────────────────────────────
    this.input.keyboard.on('keydown-X', () => this.handleStopSelected());

    // ── Pause (P key, Feature 4) ────────────────────────────────────────
    this.input.keyboard.on('keydown-P', () => this.handlePauseToggle());

    // ── Game speed (+/- keys, Feature 5) ────────────────────────────────
    this.input.keyboard.on('keydown-PLUS', () => this.handleSpeedChange(0.5));
    this.input.keyboard.on('keydown-MINUS', () => this.handleSpeedChange(-0.5));

    // ── Idle unit finder (Period key, Feature 8) ────────────────────────
    this.input.keyboard.on('keydown-PERIOD', () => this.handleIdleCycle());

    // ── Control groups (Ctrl+1-9 to assign, 1-9 to recall, Feature 2) ──
    // Also: Ctrl+Q/W/E/R/T for unit production shortcuts (replaces 1-5)
    const numberKeyNames = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
    for (let i = 0; i < 9; i++) {
      const keyName = numberKeyNames[i];
      const groupNum = i + 1;
      this.input.keyboard.on(`keydown-${keyName}`, (event: KeyboardEvent) => {
        if (event.ctrlKey) {
          // Ctrl+Number: Assign control group
          this.assignControlGroup(groupNum);
        } else {
          // Number only: Recall control group
          this.recallControlGroup(groupNum);
        }
      });
    }

    // ── Attack-Move toggle (A key tap with units selected) ─────────
    // The A key is also used for camera scrolling (held down). To avoid
    // conflict, attack-move mode only toggles on keyup if A was held
    // briefly (< 200ms), and only when the player has units selected.
    let aKeyDownTime = 0;
    this.input.keyboard.on('keydown-A', () => {
      aKeyDownTime = this.time.now;
    });
    this.input.keyboard.on('keyup-A', () => {
      const held = this.time.now - aKeyDownTime;
      if (held < 200 && this.unitSystem.selectedSquads.length > 0) {
        this.attackMoveMode = !this.attackMoveMode;
      }
    });

    // ── Cancel attack-move on ESC ────────────────────────────────────
    this.input.keyboard.on('keydown-ESC', () => {
      this.attackMoveMode = false;
    });

    // ── Production shortcuts via Ctrl+Q/W/E/R/T ────────────────────────
    this.input.keyboard.on('keydown-Q', (event: KeyboardEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this.handleProduceUnit(UnitType.RUNNER);
      }
    });
    // Note: Ctrl+W would close the browser tab, so we skip it
    this.input.keyboard.on('keydown-E', (event: KeyboardEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        this.handleProduceUnit(UnitType.ENFORCER);
      }
    });
    // Note: Ctrl+R would reload the page, so we use just the action bar for THUG/ARSONIST/LOOKOUT
  }

  private setupMouseInput(): void {
    // ── Mouse wheel zoom ────────────────────────────────────────────────
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      if (dy > 0) {
        cam.setZoom(Math.max(CAMERA_ZOOM_MIN, cam.zoom - CAMERA_ZOOM_STEP));
      } else if (dy < 0) {
        cam.setZoom(Math.min(CAMERA_ZOOM_MAX, cam.zoom + CAMERA_ZOOM_STEP));
      }
    });

    // ── Left click / drag selection ─────────────────────────────────────
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.handleLeftClickDown(pointer);
      } else if (pointer.rightButtonDown()) {
        this.handleRightClick(pointer);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown() && this.selectionStart) {
        this.handleDragSelection(pointer);
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonReleased()) {
        this.handleLeftClickUp(pointer);
      }
    });

    // Enable right-click context menu prevention
    this.input.mouse?.disableContextMenu();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MOUSE INPUT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  private handleLeftClickDown(pointer: Phaser.Input.Pointer): void {
    // Cancel attack-move mode on any left-click
    this.attackMoveMode = false;

    const worldPos = this.getPointerWorldPosition();
    this.selectionStart = { x: worldPos.x, y: worldPos.y };
    this.isDragging = false;
  }

  private handleDragSelection(pointer: Phaser.Input.Pointer): void {
    if (!this.selectionStart) return;

    const worldPos = this.getPointerWorldPosition();
    const dx = worldPos.x - this.selectionStart.x;
    const dy = worldPos.y - this.selectionStart.y;

    // Only start dragging after a minimum distance (5px)
    if (!this.isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
      this.isDragging = true;

      // Create selection box visual (AoE2-style green box)
      this.selectionBox = this.add.rectangle(
        this.selectionStart.x,
        this.selectionStart.y,
        1,
        1,
        0x00ff00,
        0.1,
      );
      this.selectionBox.setStrokeStyle(1.5, 0x00ff00, 0.9);
      this.selectionBox.setDepth(50);
      this.selectionBox.setOrigin(0, 0);
    }

    // Update selection box visual and preview highlighting
    if (this.isDragging && this.selectionBox) {
      const x = Math.min(this.selectionStart.x, worldPos.x);
      const y = Math.min(this.selectionStart.y, worldPos.y);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      this.selectionBox.setPosition(x, y);
      this.selectionBox.setSize(w, h);

      // Real-time drag preview: show selection circles for units inside the box
      this.updateDragPreview(x, y, x + w, y + h);
    }
  }

  /** Show/hide selection circles during drag to preview which units will be selected. */
  private updateDragPreview(x1: number, y1: number, x2: number, y2: number): void {
    for (const squad of this.unitSystem.squads.values()) {
      if (squad.owner !== 0) continue;
      const px = squad.getPixelX();
      const py = squad.getPixelY();
      const inBox = px >= x1 && px <= x2 && py >= y1 && py <= y2;

      if (inBox && !squad.isSelected) {
        // Preview: show selection circle temporarily
        squad.selectionCircle.setVisible(true);
        squad.selectionCircle.setAlpha(0.5);
      } else if (!inBox && !squad.isSelected) {
        // Not in box and not already selected: hide
        squad.selectionCircle.setVisible(false);
        squad.selectionCircle.setAlpha(1);
      }
    }
  }

  private handleLeftClickUp(pointer: Phaser.Input.Pointer): void {
    const worldPos = this.getPointerWorldPosition();
    const shiftHeld = pointer.event.shiftKey;

    if (this.isDragging && this.selectionStart) {
      // ── Box selection ─────────────────────────────────────────────────
      // Clean up drag preview highlighting
      this.clearDragPreview();

      if (!shiftHeld) {
        this.unitSystem.deselectAll();
        this.deselectBuilding();
      }

      this.unitSystem.selectInBox(
        this.selectionStart.x,
        this.selectionStart.y,
        worldPos.x,
        worldPos.y,
      );

      // Clean up selection box visual
      if (this.selectionBox) {
        this.selectionBox.destroy();
        this.selectionBox = null;
      }
    } else {
      // ── Single click ──────────────────────────────────────────────────
      this.handleSingleClick(worldPos.x, worldPos.y, shiftHeld);
    }

    this.selectionStart = null;
    this.isDragging = false;
  }

  /** Reset all drag preview selection circles to normal state. */
  private clearDragPreview(): void {
    for (const squad of this.unitSystem.squads.values()) {
      if (!squad.isSelected) {
        squad.selectionCircle.setVisible(false);
        squad.selectionCircle.setAlpha(1);
      }
    }
  }

  private handleSingleClick(worldX: number, worldY: number, shiftHeld: boolean): void {
    const now = this.time.now;
    const dx = worldX - this.lastClickX;
    const dy = worldY - this.lastClickY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const isDoubleClick = (now - this.lastClickTime < 300) && (dist < 10);

    // Update click tracking for next call
    this.lastClickTime = now;
    this.lastClickX = worldX;
    this.lastClickY = worldY;

    // Check if clicked on a squad (player 0 only)
    const squad = this.unitSystem.getSquadAtPixel(worldX, worldY);

    if (squad && squad.owner === 0) {
      // ── Double-click: select all of same type on screen (Feature 7) ──
      if (isDoubleClick) {
        const cam = this.cameras.main;
        const cameraBounds = new Phaser.Geom.Rectangle(
          cam.worldView.x,
          cam.worldView.y,
          cam.worldView.width,
          cam.worldView.height,
        );
        this.unitSystem.selectAllOfType(squad.stats.type, cameraBounds, 0);
        return;
      }

      if (shiftHeld) {
        this.unitSystem.addToSelection(squad);
      } else {
        this.deselectBuilding();
        this.unitSystem.selectSquad(squad);
      }
      return;
    }

    // Check if clicked on a building
    const building = this.buildingSystem.getBuildingAt(worldX, worldY);
    if (building) {
      if (!shiftHeld) {
        this.unitSystem.deselectAll();
      }
      this.selectBuilding(building);
      return;
    }

    // Clicked on empty ground -- deselect all
    if (!shiftHeld) {
      this.unitSystem.deselectAll();
      this.deselectBuilding();
    }
  }

  private handleRightClick(pointer: Phaser.Input.Pointer): void {
    const worldPos = this.getPointerWorldPosition();
    const tilePos = this.worldToTile(worldPos.x, worldPos.y);
    const shiftHeld = pointer.event.shiftKey;

    // ── Rally point: right-click while production building is selected ──
    if (
      this.selectedBuilding &&
      this.selectedBuilding.stats.canProduceUnits &&
      this.selectedBuilding.owner === 0 &&
      this.unitSystem.selectedSquads.length === 0
    ) {
      this.selectedBuilding.setRallyPoint(tilePos.x, tilePos.y);
      return;
    }

    // ── Attack-move mode: move to location but engage enemies en route ──
    if (this.attackMoveMode && this.unitSystem.selectedSquads.length > 0) {
      for (const squad of this.unitSystem.selectedSquads) {
        if (shiftHeld) {
          squad.queueCommand({ type: 'attackMove', target: { x: tilePos.x, y: tilePos.y } });
        } else {
          squad.attackMoveTo(tilePos.x, tilePos.y);
        }
      }
      this.attackMoveMode = false;
      return;
    }

    // Check what's at the target position
    const targetSquad = this.unitSystem.getSquadAtPixel(worldPos.x, worldPos.y);
    const targetBuilding = this.buildingSystem.getBuildingAt(worldPos.x, worldPos.y);

    if (targetSquad && targetSquad.owner !== 0) {
      // ── Right click on enemy squad: Attack order ──────────────────────
      if (shiftHeld) {
        for (const squad of this.unitSystem.selectedSquads) {
          squad.queueCommand({ type: 'attack', target: { x: targetSquad.tileX, y: targetSquad.tileY }, attackTarget: targetSquad });
        }
      } else {
        this.unitSystem.attackWithSelected(targetSquad);

        // Also register with combat system
        for (const squad of this.unitSystem.selectedSquads) {
          this.combatSystem.engageTarget(squad, targetSquad);
        }
      }

      EventBus.emit(GameEvents.ATTACK_ORDER, targetSquad);
    } else if (targetBuilding) {
      if (targetBuilding.owner !== 0 && targetBuilding.owner !== -1) {
        // ── Enemy building: Capture order ───────────────────────────────
        this.handleCaptureOrder(targetBuilding);
      } else if (targetBuilding.owner === -1) {
        // ── Neutral building: Capture order ─────────────────────────────
        this.handleCaptureOrder(targetBuilding);
      } else {
        // ── Friendly building ───────────────────────────────────────────
        this.handleFriendlyBuildingOrder(targetBuilding);
      }
    } else {
      // ── Empty ground: Move order ──────────────────────────────────────
      if (shiftHeld) {
        // Shift+right-click: queue a waypoint instead of replacing the current order
        for (const squad of this.unitSystem.selectedSquads) {
          squad.queueCommand({ type: 'move', target: { x: tilePos.x, y: tilePos.y } });
        }
      } else {
        this.unitSystem.moveSelectedTo(tilePos.x, tilePos.y);
      }
      EventBus.emit(GameEvents.MOVE_ORDER, tilePos.x, tilePos.y);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COMMAND HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  private handleCaptureOrder(building: any): void {
    // Move selected units near the building, then start capture
    const targetTileX = building.tileX + Math.floor(building.stats.widthTiles / 2);
    const targetTileY = building.tileY + building.stats.heightTiles;

    for (const squad of this.unitSystem.selectedSquads) {
      squad.state = 'capturing';
      squad.moveTo(targetTileX, targetTileY);
    }

    this.buildingSystem.tryCapture(building.id, 0, this.unitSystem.selectedSquads.length);
    EventBus.emit(GameEvents.CAPTURE_ORDER, building.id, 0);
  }

  private handleFriendlyBuildingOrder(building: any): void {
    // Check if any selected unit can carry goods -- set up transport route
    const carriers = this.unitSystem.selectedSquads.filter(
      (s) => s.stats.canCarryGoods,
    );

    if (carriers.length > 0) {
      // Transport route: move carriers to the building
      EventBus.emit(GameEvents.TRANSPORT_GOODS, building.id, carriers);
    }

    // Move all selected units to the building
    const targetTileX = building.tileX + Math.floor(building.stats.widthTiles / 2);
    const targetTileY = building.tileY + building.stats.heightTiles;
    this.unitSystem.moveSelectedTo(targetTileX, targetTileY);
  }

  handleRetreat(): void {
    if (this.unitSystem.selectedSquads.length === 0) return;

    for (const squad of this.unitSystem.selectedSquads) {
      // Find nearest owned building
      const ownedBuildings = this.buildingSystem.getBuildingsByOwner(squad.owner);
      if (ownedBuildings.length === 0) continue;

      let nearest = ownedBuildings[0];
      let nearestDist = Infinity;

      for (const b of ownedBuildings) {
        const dx = squad.tileX - b.tileX;
        const dy = squad.tileY - b.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = b;
        }
      }

      squad.state = 'retreating';
      squad.moveTo(nearest.tileX, nearest.tileY);
      this.combatSystem.disengageAll(squad.id);
    }

    EventBus.emit(GameEvents.RETREAT_ORDER);
  }

  handleGarrison(): void {
    if (this.unitSystem.selectedSquads.length === 0) return;

    for (const squad of this.unitSystem.selectedSquads) {
      // Find nearest friendly building that can garrison
      const ownedBuildings = this.buildingSystem.getBuildingsByOwner(squad.owner);
      let nearest: any = null;
      let nearestDist = Infinity;

      for (const b of ownedBuildings) {
        if (!b.stats.canGarrison) continue;
        if (b.garrisonedSquads.length >= b.stats.garrisonSlots) continue;

        const dx = squad.tileX - b.tileX;
        const dy = squad.tileY - b.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = b;
        }
      }

      if (nearest) {
        squad.moveTo(nearest.tileX, nearest.tileY);
        // Garrison will be completed when the unit arrives (handled by future logic)
        squad.state = 'garrisoned';
        nearest.garrison(squad.id);
        squad.sprite.setVisible(false);
        squad.healthBar.setVisible(false);
        squad.selectionCircle.setVisible(false);
      }
    }
  }

  handleTierAdvance(): void {
    if (!this.economySystem) return;

    // EconomySystem.startTierResearch() checks tier, affordability, and
    // deducts costs itself. Returns true if research was started.
    const started = this.economySystem.startTierResearch(0);
    if (started) {
      const economy = this.economySystem.getPlayerEconomy(0);
      EventBus.emit(GameEvents.TIER_RESEARCH_STARTED, 0, economy.tierResearchTarget);
    }
  }

  private handleSpaceCycle(): void {
    const selected = this.unitSystem.selectedSquads;

    if (selected.length > 0) {
      // Center camera on first selected unit
      const squad = selected[0];
      this.cameras.main.centerOn(squad.getPixelX(), squad.getPixelY());
    } else {
      // Cycle through owned buildings
      const ownedBuildings = this.buildingSystem.getBuildingsByOwner(0);
      if (ownedBuildings.length === 0) return;

      this.spaceCycleIndex = this.spaceCycleIndex % ownedBuildings.length;
      const building = ownedBuildings[this.spaceCycleIndex];
      const bldgCenter = tileToWorld(
        building.tileX + Math.floor(building.stats.widthTiles / 2),
        building.tileY + Math.floor(building.stats.heightTiles / 2),
      );
      const cx = bldgCenter.x;
      const cy = bldgCenter.y;
      this.cameras.main.centerOn(cx, cy);
      this.selectBuilding(building);
      this.spaceCycleIndex++;
    }
  }

  private handleMinimapToggle(): void {
    EventBus.emit('minimap:toggle');
  }

  // ── Control Group Handlers (Feature 2) ─────────────────────────────

  private assignControlGroup(groupNum: number): void {
    if (this.unitSystem.selectedSquads.length === 0) return;
    const ids = this.unitSystem.selectedSquads.map((s) => s.id);
    this.controlGroups.set(groupNum, ids);
  }

  private recallControlGroup(groupNum: number): void {
    const ids = this.controlGroups.get(groupNum);
    if (!ids || ids.length === 0) return;

    const now = this.time.now;
    const lastTime = this.lastGroupKeyTime.get(groupNum) ?? 0;
    const isDoubleTap = now - lastTime < 300;
    this.lastGroupKeyTime.set(groupNum, now);

    // Select the squads in the group
    this.unitSystem.selectSquadsById(ids);

    // Double-tap: center camera on group centroid
    if (isDoubleTap) {
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (const id of ids) {
        const squad = this.unitSystem.squads.get(id);
        if (squad) {
          cx += squad.getPixelX();
          cy += squad.getPixelY();
          count++;
        }
      }
      if (count > 0) {
        this.cameras.main.centerOn(cx / count, cy / count);
      }
    }
  }

  // ── Pause Handler (Feature 4) ─────────────────────────────────────

  private handlePauseToggle(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      EventBus.emit(GameEvents.GAME_PAUSED);
    } else {
      EventBus.emit(GameEvents.GAME_RESUMED);
    }
  }

  // ── Game Speed Handler (Feature 5) ────────────────────────────────

  private handleSpeedChange(delta: number): void {
    this.gameSpeed = Math.max(0.5, Math.min(3.0, this.gameSpeed + delta));
    EventBus.emit(GameEvents.GAME_SPEED_CHANGED, this.gameSpeed);
  }

  // ── Idle Unit Finder (Feature 8) ──────────────────────────────────

  private handleIdleCycle(): void {
    const idleSquads = this.unitSystem.getIdleSquads(0);
    if (idleSquads.length === 0) return;

    this.idleCycleIndex = this.idleCycleIndex % idleSquads.length;
    const squad = idleSquads[this.idleCycleIndex];

    // Select and center on the idle squad
    this.unitSystem.selectSquadsById([squad.id]);
    this.cameras.main.centerOn(squad.getPixelX(), squad.getPixelY());

    this.idleCycleIndex++;
  }

  private handleProduceUnit(unitType: UnitType): void {
    const compound = this.buildingSystem.getCompound(0);
    if (!compound) return;

    const unitDef = UNIT_DEFS[unitType];

    // Check tier requirement
    const currentTier = this.economySystem ? this.economySystem.getTier(0) : 1;
    if (unitDef.tier > currentTier) return;

    // Check if player can afford
    if (this.economySystem) {
      const cash = this.economySystem.getCash(0);
      if (cash < unitDef.cost) return;
      this.economySystem.spendCash(0, unitDef.cost);
    }

    // Queue the unit for production instead of instant spawn
    compound.queueUnit(unitType);

    EventBus.emit(GameEvents.PRODUCE_UNIT, unitType, 0);
  }

  handleStopSelected(): void {
    for (const squad of this.unitSystem.selectedSquads) {
      squad.stop();
      this.combatSystem.disengageAll(squad.id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUILDING SELECTION
  // ═══════════════════════════════════════════════════════════════════════

  private selectBuilding(building: any): void {
    this.deselectBuilding();
    this.selectedBuilding = building;
    building.select();
    EventBus.emit(GameEvents.BUILDING_SELECTED, building);
  }

  private deselectBuilding(): void {
    if (this.selectedBuilding) {
      this.selectedBuilding.deselect();
      this.selectedBuilding = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════

  update(time: number, delta: number): void {
    // ── 1. Camera scrolling from keyboard and edge (always responsive) ──
    this.updateCameraScroll(delta);

    // ── 2. If paused, skip all system updates (Feature 4) ───────────────
    if (this.isPaused) return;

    // ── 3. Apply game speed multiplier (Feature 5) ──────────────────────
    const scaledDelta = delta * this.gameSpeed;

    // ── 4. Update all systems ───────────────────────────────────────────
    // Pathfinding is updated inside unitSystem.update
    this.unitSystem.update(scaledDelta);
    this.buildingSystem.update(scaledDelta);
    this.combatSystem.update(scaledDelta);

    if (this.economySystem) {
      this.economySystem.update(
        scaledDelta,
        (owner: number) => this.buildingSystem.getBuildingsByOwner(owner),
        (neighborhood: string, player: number) =>
          this.territorySystem
            ? this.territorySystem.getInfluenceMultiplier(neighborhood, player)
            : 1.0,
        (x: number, y: number) => this.mapSystem.getNeighborhoodAt(x, y),
      );
    }

    if (this.logisticsSystem) {
      this.logisticsSystem.update(
        scaledDelta,
        (id: string) => this.unitSystem.squads.get(id) ?? null,
        (id: string) => this.buildingSystem.buildings.get(id) ?? null,
        (player: number, amount: number) => this.economySystem?.addGoods(player, amount),
        () => Array.from(this.unitSystem.squads.values()),
        () => Array.from(this.buildingSystem.buildings.values()),
        this.time.now,
      );
    }

    if (this.territorySystem) {
      this.territorySystem.update(
        scaledDelta,
        (x: number, y: number, radius: number) => this.unitSystem.getSquadsAt(x, y, radius),
      );
    }

    // ── 5. Update fog of war ────────────────────────────────────────────
    if (this.fogOfWarSystem) {
      this.fogOfWarSystem.update(
        scaledDelta,
        0, // player index (human player)
        Array.from(this.unitSystem.squads.values()),
        Array.from(this.buildingSystem.buildings.values()),
        this.cameras.main,
      );
    }

    // ── 6. Validate captures (check unit proximity) ─────────────────────
    this.buildingSystem.validateCaptures(
      (buildingId: string, playerIndex: number, radiusTiles: number) => {
        const building = this.buildingSystem.buildings.get(buildingId);
        if (!building) return 0;

        const squads = this.unitSystem.getSquadsAt(
          building.tileX + Math.floor(building.stats.widthTiles / 2),
          building.tileY + Math.floor(building.stats.heightTiles / 2),
          radiusTiles + Math.max(building.stats.widthTiles, building.stats.heightTiles),
        );

        return squads.filter((s) => s.owner === playerIndex).length;
      },
    );

    // ── 5. Check win conditions ─────────────────────────────────────────
    this.checkWinConditions();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CAMERA SCROLLING
  // ═══════════════════════════════════════════════════════════════════════

  private updateCameraScroll(_delta: number): void {
    const cam = this.cameras.main;
    let scrollX = 0;
    let scrollY = 0;

    // ── Keyboard scrolling (WASD + arrows) ──────────────────────────────
    if (this.cameraKeys) {
      if (this.cameraKeys.A.isDown || this.cameraKeys.LEFT.isDown) scrollX -= CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.D.isDown || this.cameraKeys.RIGHT.isDown) scrollX += CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.W.isDown || this.cameraKeys.UP.isDown) scrollY -= CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.S.isDown || this.cameraKeys.DOWN.isDown) scrollY += CAMERA_SCROLL_SPEED;
    }

    // ── Edge scrolling (mouse near screen edge) ─────────────────────────
    const pointer = this.input.activePointer;
    if (pointer) {
      // Use the pointer position relative to the game canvas, not world position
      const px = pointer.x;
      const py = pointer.y;

      if (px < CAMERA_EDGE_ZONE) scrollX -= CAMERA_SCROLL_SPEED;
      if (px > VIEWPORT_WIDTH - CAMERA_EDGE_ZONE) scrollX += CAMERA_SCROLL_SPEED;
      if (py < CAMERA_EDGE_ZONE) scrollY -= CAMERA_SCROLL_SPEED;
      if (py > VIEWPORT_HEIGHT - CAMERA_EDGE_ZONE) scrollY += CAMERA_SCROLL_SPEED;
    }

    // Apply scroll (scaled by zoom so speed feels consistent)
    if (scrollX !== 0 || scrollY !== 0) {
      const zoomFactor = 1 / cam.zoom;
      cam.scrollX += scrollX * zoomFactor;
      cam.scrollY += scrollY * zoomFactor;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WIN CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════

  private checkWinConditions(): void {
    // Check if all enemy buildings are destroyed/captured
    const p1Buildings = this.buildingSystem.getBuildingsByOwner(1);
    const p0Buildings = this.buildingSystem.getBuildingsByOwner(0);

    if (p1Buildings.length === 0 && this.buildingSystem.buildings.size > 0) {
      EventBus.emit(GameEvents.GAME_OVER, { winner: 0, reason: 'All enemy buildings captured or destroyed' });
    } else if (p0Buildings.length === 0 && this.buildingSystem.buildings.size > 0) {
      EventBus.emit(GameEvents.GAME_OVER, { winner: 1, reason: 'All player buildings captured or destroyed' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COORDINATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /** Convert a world pixel position to tile coordinates (isometric). */
  worldToTile(pixelX: number, pixelY: number): { x: number; y: number } {
    return isoWorldToTile(pixelX, pixelY);
  }

  /** Convert tile coordinates to world pixel position (isometric). */
  tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
    return tileToWorld(tileX, tileY);
  }

  /**
   * Get the mouse position in world coordinates, accounting for camera
   * scroll and zoom.
   */
  getPointerWorldPosition(): { x: number; y: number } {
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const worldPoint = cam.getWorldPoint(pointer.x, pointer.y);
    return { x: worldPoint.x, y: worldPoint.y };
  }
}
