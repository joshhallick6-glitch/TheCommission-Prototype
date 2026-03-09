// ─── Game Scene ─────────────────────────────────────────────────────────────
// The main gameplay scene. Creates all systems, wires them together, handles
// input (camera, selection, commands), and drives the update loop.

import Phaser from 'phaser';
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  TILE_WIDTH,
  TILE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
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
import { BuildingType } from '../data/buildings';
import { CombatSystem } from '../systems/CombatSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { LogisticsSystem } from '../systems/LogisticsSystem';
import { TerritorySystem } from '../systems/TerritorySystem';
import { FogOfWarSystem } from '../systems/FogOfWarSystem';
import { pathfinding } from '../utils/Pathfinding';
import { EventBus, GameEvents } from '../utils/EventBus';
import { tileToWorld, worldToTile as isoWorldToTile, isoDepth } from '../utils/IsometricUtils';
import { CityBlock } from '../systems/MapSystem';

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

  // ── Win condition guard ──────────────────────────────────────────
  private gameOver: boolean = false;

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

    // ── 3b. Create visual skyscraper sprites for city blocks ──────────
    this.createCityBlockVisuals();

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

    // Reveal starting neighborhoods so players can see their compounds
    // and nearby buildings immediately (P1 Start: 0,120,40x40; P2 Start: 120,0,40x40)
    this.fogOfWarSystem.revealRect(0, 0, 120, 40, 40);   // Player 0 sees P1 Start
    this.fogOfWarSystem.revealRect(1, 120, 0, 40, 40);   // Player 1 sees P2 Start

    // Also reveal a generous radius around each player's compound for good measure
    for (let player = 0; player <= 1; player++) {
      const compound = this.buildingSystem.getCompound(player);
      if (compound) {
        const cx = compound.tileX + Math.floor(compound.stats.widthTiles / 2);
        const cy = compound.tileY + Math.floor(compound.stats.heightTiles / 2);
        this.fogOfWarSystem.revealArea(player, cx, cy, 15);
      }
    }

    // Run an immediate visibility update so the first frame is not fully fogged
    this.fogOfWarSystem.immediateUpdate(
      0,
      Array.from(this.unitSystem.squads.values()),
      Array.from(this.buildingSystem.buildings.values()),
    );

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

    // ── 10b. Listen for transport goods commands ───────────────────────
    EventBus.on(
      GameEvents.TRANSPORT_GOODS,
      (data: { buildingId: string; squads: string[] }) =>
        this.handleTransportGoods(data),
    );

    // ── 10c. Listen for squad wipes to handle goods carrier destruction ──
    EventBus.on(
      GameEvents.SQUAD_WIPED,
      (squad: any) => this.handleSquadWipedLogistics(squad),
    );

    // ── 11. Spawn starting units ────────────────────────────────────────
    this.spawnStartingUnits();

    // ── 12. Set up input handling ───────────────────────────────────────
    this.setupKeyboardInput();
    this.setupMouseInput();

    // ── 12b. Fullscreen toggle (F key) ───────────────────────────────────
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-F', () => {
        if (this.scale.isFullscreen) {
          this.scale.stopFullscreen();
        } else {
          this.scale.startFullscreen();
        }
      });
    }

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

    // Action keys (stop is on X, not S — S is camera scroll)
    this.actionKeys = {
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
      EventBus.emit(GameEvents.TRANSPORT_GOODS, {
        buildingId: building.id,
        squads: carriers.map((s: any) => s.id),
      });
    }

    // Move all selected units to the building
    const targetTileX = building.tileX + Math.floor(building.stats.widthTiles / 2);
    const targetTileY = building.tileY + building.stats.heightTiles;
    this.unitSystem.moveSelectedTo(targetTileX, targetTileY);
  }

  /**
   * Handle the TRANSPORT_GOODS event. Determines source and destination
   * buildings, then creates auto-repeating logistics routes for each carrier.
   */
  private handleTransportGoods(data: {
    buildingId: string;
    squads: string[];
  }): void {
    if (!this.logisticsSystem || !data) return;

    const targetBuilding = this.buildingSystem.buildings.get(data.buildingId);
    if (!targetBuilding) return;

    const targetStats = targetBuilding.stats;
    let sourceBuildingId: string | null = null;
    let destBuildingId: string | null = null;

    if (targetStats.goodsPerMin > 0) {
      // The target building produces goods — it is the SOURCE.
      // Auto-set the player's compound as the destination.
      sourceBuildingId = data.buildingId;
      const compound = this.buildingSystem.getCompound(0);
      if (compound) {
        destBuildingId = compound.id;
      }
    } else if (
      targetStats.type === BuildingType.COMPOUND ||
      targetStats.type === BuildingType.WAREHOUSE
    ) {
      // The target is a storage/destination building — find the nearest
      // goods-producing building owned by the player as the source.
      destBuildingId = data.buildingId;
      const ownedBuildings = this.buildingSystem.getBuildingsByOwner(0);
      let nearestDist = Infinity;

      for (const b of ownedBuildings) {
        if (b.stats.goodsPerMin <= 0) continue;
        const dx = b.tileX - targetBuilding.tileX;
        const dy = b.tileY - targetBuilding.tileY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          sourceBuildingId = b.id;
        }
      }
    }

    // If we could not determine both endpoints, abort
    if (!sourceBuildingId || !destBuildingId) return;

    // Create a route for each carrier squad in the data
    for (const squadId of data.squads) {
      const squad = this.unitSystem.squads.get(squadId);
      if (!squad || !squad.stats.canCarryGoods) continue;

      // Cancel any existing route for this squad first
      const existingRoute =
        this.logisticsSystem.getRouteForSquad(squadId);
      if (existingRoute) {
        this.logisticsSystem.cancelRoute(existingRoute.id);
      }

      this.logisticsSystem.createRoute(
        squadId,
        sourceBuildingId,
        destBuildingId,
        squad.owner,
        true, // autoRepeat
      );
    }
  }

  /**
   * Handle SQUAD_WIPED for goods carriers — drop carried goods on destruction.
   */
  private handleSquadWipedLogistics(squad: any): void {
    if (!this.logisticsSystem) return;
    if (!squad || !squad.stats?.canCarryGoods) return;
    if ((squad.carryingGoods ?? 0) <= 0) {
      // No goods to drop, but still clean up the route
      const route = this.logisticsSystem.getRouteForSquad(squad.id);
      if (route) {
        this.logisticsSystem.cancelRoute(route.id);
      }
      return;
    }

    this.logisticsSystem.onTruckDestroyed(squad.id, squad);
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
        // Move toward the building; garrison state is set but the unit
        // remains visible until it arrives. The update loop will hide
        // it once it stops moving and is still in 'garrisoned' state.
        squad.moveTo(nearest.tileX, nearest.tileY);
        squad.state = 'garrisoned';
        nearest.garrison(squad.id);
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
  // CITY BLOCK VISUALS (3D skyscraper rendering)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Detect all city blocks and draw 3D isometric skyscraper visuals on top
   * of the WALL terrain tiles. Purely cosmetic -- no interaction or gameplay.
   */
  private createCityBlockVisuals(): void {
    const blocks = this.mapSystem.detectCityBlocks();

    // Only LARGE buildings (area > 4 tiles) should replace a skyscraper.
    // Small storefronts sit at the base of the skyscraper and coexist.
    const largeBuildingTiles = new Set<string>();
    if (this.buildingSystem) {
      for (const b of this.buildingSystem.buildings.values()) {
        const area = b.stats.widthTiles * b.stats.heightTiles;
        if (area <= 4) continue; // small storefronts don't remove skyscrapers
        const bw = b.stats.widthTiles;
        const bh = b.stats.heightTiles;
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            largeBuildingTiles.add(`${b.tileX + dx},${b.tileY + dy}`);
          }
        }
      }
    }

    let drawn = 0;
    for (const block of blocks) {
      let overlapsLarge = false;
      outer:
      for (let dy = 0; dy < block.heightTiles; dy++) {
        for (let dx = 0; dx < block.widthTiles; dx++) {
          if (largeBuildingTiles.has(`${block.tileX + dx},${block.tileY + dy}`)) {
            overlapsLarge = true;
            break outer;
          }
        }
      }
      if (!overlapsLarge) {
        this.drawSkyscraper(block);
        drawn++;
      }
    }
    console.log(`GameScene: drew ${drawn}/${blocks.length} skyscraper visuals (${blocks.length - drawn} skipped for large buildings)`);
  }

  /**
   * Draw a single 3D isometric skyscraper box for a city block using
   * Phaser Graphics. Includes left wall, right wall, top face, outlines,
   * and a window grid pattern on both walls.
   *
   * Uses a seeded random based on block position for deterministic
   * colors and heights between sessions.
   */
  private drawSkyscraper(block: CityBlock): void {
    const HALF_W = TILE_WIDTH / 2;   // 32
    const HALF_H = TILE_HEIGHT / 2;  // 16

    // Seeded random from block position for consistent appearance
    const seed = block.tileX * 1000 + block.tileY;
    const seededRand = (offset: number = 0): number => {
      let s = (seed + offset) * 1664525 + 1013904223;
      s = (s >>> 0) / 0x100000000;
      return s;
    };

    // Vary building height based on block size + seeded randomness
    // Taller = more dramatic NYC skyscraper look
    const wallHeight = 50 + Math.floor(seededRand(1) * 60); // 50-110px

    // NYC palette: grays, browns, brick, tan
    const colors = [
      0x6B6B6B, 0x7B6B5B, 0x8B7355, 0x696969,
      0x808080, 0x5B5B5B, 0x8B4513, 0x7B5B3B,
    ];
    const baseColor = colors[Math.floor(seededRand(2) * colors.length)];

    // Compute the four diamond vertices of the block footprint (ground level).
    const tx = block.tileX;
    const ty = block.tileY;
    const w = block.widthTiles;
    const h = block.heightTiles;

    const topCenter = tileToWorld(tx, ty);
    const topVertex = { x: topCenter.x, y: topCenter.y - HALF_H };

    const rightCenter = tileToWorld(tx + w - 1, ty);
    const rightVertex = { x: rightCenter.x + HALF_W, y: rightCenter.y };

    const bottomCenter = tileToWorld(tx + w - 1, ty + h - 1);
    const bottomVertex = { x: bottomCenter.x, y: bottomCenter.y + HALF_H };

    const leftCenter = tileToWorld(tx, ty + h - 1);
    const leftVertex = { x: leftCenter.x - HALF_W, y: leftCenter.y };

    // Color shading helpers
    const darken = (hex: number, factor: number): number => {
      const r = Math.floor(((hex >> 16) & 0xff) * factor);
      const g = Math.floor(((hex >> 8) & 0xff) * factor);
      const b = Math.floor((hex & 0xff) * factor);
      return (r << 16) | (g << 8) | b;
    };
    const lighten = (hex: number, factor: number): number => {
      const r = Math.min(255, ((hex >> 16) & 0xff) + Math.floor((255 - ((hex >> 16) & 0xff)) * factor));
      const g = Math.min(255, ((hex >> 8) & 0xff) + Math.floor((255 - ((hex >> 8) & 0xff)) * factor));
      const b = Math.min(255, (hex & 0xff) + Math.floor((255 - (hex & 0xff)) * factor));
      return (r << 16) | (g << 8) | b;
    };

    const gfx = this.add.graphics();

    // Buildings rise UPWARD: walls go from ground level to roof (y - wallHeight).
    // Only the south-facing walls (left and right) are visible from the
    // isometric camera angle.

    // ── LEFT wall (south-west face, medium shade) ─────────────────────
    gfx.fillStyle(baseColor, 1);
    gfx.beginPath();
    gfx.moveTo(leftVertex.x, leftVertex.y);                      // ground left
    gfx.lineTo(bottomVertex.x, bottomVertex.y);                  // ground bottom
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);     // roof bottom
    gfx.lineTo(leftVertex.x, leftVertex.y - wallHeight);         // roof left
    gfx.closePath();
    gfx.fillPath();

    // ── RIGHT wall (south-east face, darker shade) ────────────────────
    gfx.fillStyle(darken(baseColor, 0.65), 1);
    gfx.beginPath();
    gfx.moveTo(bottomVertex.x, bottomVertex.y);                  // ground bottom
    gfx.lineTo(rightVertex.x, rightVertex.y);                    // ground right
    gfx.lineTo(rightVertex.x, rightVertex.y - wallHeight);       // roof right
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);     // roof bottom
    gfx.closePath();
    gfx.fillPath();

    // ── ROOF (top face, lightest shade diamond, elevated) ─────────────
    gfx.fillStyle(lighten(baseColor, 0.35), 1);
    gfx.beginPath();
    gfx.moveTo(topVertex.x, topVertex.y - wallHeight);
    gfx.lineTo(rightVertex.x, rightVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);
    gfx.lineTo(leftVertex.x, leftVertex.y - wallHeight);
    gfx.closePath();
    gfx.fillPath();

    // ── Window grid on LEFT wall ──────────────────────────────────────
    this.drawWindowGrid(
      gfx, leftVertex, bottomVertex, wallHeight, seededRand, 10,
    );

    // ── Window grid on RIGHT wall ─────────────────────────────────────
    this.drawWindowGrid(
      gfx, bottomVertex, rightVertex, wallHeight, seededRand, 100,
    );

    // ── Outlines ──────────────────────────────────────────────────────
    gfx.lineStyle(1, darken(baseColor, 0.4), 1);

    // Roof outline
    gfx.beginPath();
    gfx.moveTo(topVertex.x, topVertex.y - wallHeight);
    gfx.lineTo(rightVertex.x, rightVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);
    gfx.lineTo(leftVertex.x, leftVertex.y - wallHeight);
    gfx.closePath();
    gfx.strokePath();

    // Left wall outline
    gfx.beginPath();
    gfx.moveTo(leftVertex.x, leftVertex.y);
    gfx.lineTo(leftVertex.x, leftVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y);
    gfx.strokePath();

    // Right wall outline
    gfx.beginPath();
    gfx.moveTo(rightVertex.x, rightVertex.y);
    gfx.lineTo(rightVertex.x, rightVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);
    gfx.lineTo(bottomVertex.x, bottomVertex.y);
    gfx.strokePath();

    // Vertical edges at the three visible corners
    gfx.beginPath();
    gfx.moveTo(leftVertex.x, leftVertex.y);
    gfx.lineTo(leftVertex.x, leftVertex.y - wallHeight);
    gfx.moveTo(bottomVertex.x, bottomVertex.y);
    gfx.lineTo(bottomVertex.x, bottomVertex.y - wallHeight);
    gfx.moveTo(rightVertex.x, rightVertex.y);
    gfx.lineTo(rightVertex.x, rightVertex.y - wallHeight);
    gfx.strokePath();

    // Depth: above tilemap (0), below units/buildings (10+), below fog (45).
    // Use a small depth with tile-based offset for rough iso sorting.
    gfx.setDepth(2 + (tx + ty + w + h) * 0.001);
  }

  /**
   * Draw a grid of window rectangles on one wall face of a skyscraper.
   * Windows are small quads that follow the wall's isometric slant.
   * Some windows are randomly dark (unlit) for visual variety.
   *
   * @param gfx       Graphics object to draw on
   * @param startV    Starting vertex of the wall (top-left corner of the wall face)
   * @param endV      Ending vertex of the wall (top-right corner of the wall face)
   * @param wallH     Wall height in pixels
   * @param rng       Seeded random function
   * @param seedOff   Seed offset for this wall's randomness
   */
  private drawWindowGrid(
    gfx: Phaser.GameObjects.Graphics,
    startV: { x: number; y: number },
    endV: { x: number; y: number },
    wallH: number,
    rng: (offset: number) => number,
    seedOff: number,
  ): void {
    const windowSpacingH = 12; // horizontal spacing along the wall
    const windowSpacingV = 10; // vertical spacing
    const windowW = 5;         // window width (along the wall's direction)
    const windowH = 6;         // window height (vertical)

    // Wall direction vector (along the ground-level edge of the wall face)
    const dx = endV.x - startV.x;
    const dy = endV.y - startV.y;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen < windowSpacingH * 2) return; // too small for windows

    const cols = Math.max(1, Math.floor((wallLen - windowSpacingH) / windowSpacingH));
    const rows = Math.max(1, Math.floor((wallH - windowSpacingV) / windowSpacingV));

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Window position along the wall face
        const t = (col + 0.5) / cols; // 0..1 along wall
        // Windows go UPWARD from ground level (negative Y)
        const yOff = -(windowSpacingV + row * windowSpacingV);

        // Base position at ground level + offset along direction + offset up
        const wx = startV.x + dx * t;
        const wy = startV.y + dy * t + yOff;

        // Randomly decide if window is lit or dark
        const isLit = rng(seedOff + row * 100 + col) > 0.3;
        const color = isLit ? 0xFFDD88 : 0x333333;

        gfx.fillStyle(color, isLit ? 0.8 : 0.5);
        gfx.fillRect(
          wx - windowW / 2,
          wy - windowH / 2,
          windowW,
          windowH,
        );
      }
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

    // ── 6. Hide garrisoned units that have arrived ─────────────────────
    for (const squad of this.unitSystem.squads.values()) {
      if (squad.state === 'garrisoned' && !squad.isMoving) {
        squad.sprite.setVisible(false);
        squad.healthBar.setVisible(false);
        squad.selectionCircle.setVisible(false);
      }
    }

    // ── 7. Validate and advance captures (check unit proximity) ────────
    this.buildingSystem.validateCaptures(
      scaledDelta,
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

  private updateCameraScroll(delta: number): void {
    const cam = this.cameras.main;
    let scrollX = 0;
    let scrollY = 0;

    // Normalize scroll speed to 60fps so it feels consistent across frame rates
    const dtFactor = delta / 16.67;

    // ── Keyboard scrolling (WASD + arrows) ──────────────────────────────
    if (this.cameraKeys) {
      if (this.cameraKeys.A.isDown || this.cameraKeys.LEFT.isDown) scrollX -= CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.D.isDown || this.cameraKeys.RIGHT.isDown) scrollX += CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.W.isDown || this.cameraKeys.UP.isDown) scrollY -= CAMERA_SCROLL_SPEED;
      if (this.cameraKeys.S.isDown || this.cameraKeys.DOWN.isDown) scrollY += CAMERA_SCROLL_SPEED;
    }

    // ── Edge scrolling (mouse near screen edge) ─────────────────────────
    // Skip edge scroll when mouse is over the bottom UI bar (180px tall)
    const pointer = this.input.activePointer;
    if (pointer) {
      const px = pointer.x;
      const py = pointer.y;
      const viewW = this.scale.width;
      const viewH = this.scale.height;
      const bottomBarY = viewH - 180;

      if (px < CAMERA_EDGE_ZONE) scrollX -= CAMERA_SCROLL_SPEED;
      if (px > viewW - CAMERA_EDGE_ZONE) scrollX += CAMERA_SCROLL_SPEED;
      if (py < CAMERA_EDGE_ZONE) scrollY -= CAMERA_SCROLL_SPEED;
      // Only scroll down at bottom edge if mouse is ABOVE the bottom bar
      if (py > viewH - CAMERA_EDGE_ZONE && py < bottomBarY) scrollY += CAMERA_SCROLL_SPEED;
    }

    // Apply scroll (scaled by zoom and delta so speed feels consistent)
    if (scrollX !== 0 || scrollY !== 0) {
      const zoomFactor = 1 / cam.zoom;
      cam.scrollX += scrollX * zoomFactor * dtFactor;
      cam.scrollY += scrollY * zoomFactor * dtFactor;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WIN CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════

  private checkWinConditions(): void {
    if (this.gameOver) return;

    const p1Buildings = this.buildingSystem.getBuildingsByOwner(1);
    const p0Buildings = this.buildingSystem.getBuildingsByOwner(0);

    if (p1Buildings.length === 0 && this.buildingSystem.buildings.size > 0) {
      this.gameOver = true;
      EventBus.emit(GameEvents.GAME_OVER, { winner: 0, reason: 'All enemy buildings captured or destroyed' });
    } else if (p0Buildings.length === 0 && this.buildingSystem.buildings.size > 0) {
      this.gameOver = true;
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
