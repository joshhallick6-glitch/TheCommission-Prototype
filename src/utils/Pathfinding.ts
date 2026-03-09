// ─── A* Pathfinding System ───────────────────────────────────────────────────
// Wraps easystarjs to provide async pathfinding for infantry and vehicles.
// Each unit type has its own EasyStar instance with a separate walkability grid.

import EasyStar from 'easystarjs';

class PathfindingSystem {
  private infantryFinder: EasyStar.js;
  private vehicleFinder: EasyStar.js;

  constructor() {
    this.infantryFinder = new EasyStar.js();
    this.vehicleFinder = new EasyStar.js();

    // Allow diagonal movement for more natural paths
    this.infantryFinder.enableDiagonals();
    this.vehicleFinder.enableDiagonals();

    // Prevent cutting corners around walls
    this.infantryFinder.disableCornerCutting();
    this.vehicleFinder.disableCornerCutting();

    // Process up to 1000 iterations per frame for responsiveness
    this.infantryFinder.setIterationsPerCalculation(1000);
    this.vehicleFinder.setIterationsPerCalculation(1000);
  }

  /**
   * Initialize both pathfinding grids.
   * Grid values: 0 = walkable, 1 = blocked.
   */
  setGrid(walkableGrid: number[][], vehicleGrid: number[][]): void {
    this.infantryFinder.setGrid(walkableGrid);
    this.infantryFinder.setAcceptableTiles([0]);

    this.vehicleFinder.setGrid(vehicleGrid);
    this.vehicleFinder.setAcceptableTiles([0]);
  }

  /**
   * Find a path from (startX, startY) to (endX, endY) in tile coordinates.
   * Uses the vehicle grid when isVehicle is true, infantry grid otherwise.
   * Resolves with an array of {x, y} tile coords, or an empty array if no path.
   */
  findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    isVehicle: boolean,
  ): Promise<{ x: number; y: number }[]> {
    const finder = isVehicle ? this.vehicleFinder : this.infantryFinder;

    return new Promise((resolve) => {
      finder.findPath(startX, startY, endX, endY, (path) => {
        if (path === null) {
          resolve([]);
        } else {
          resolve(path);
        }
      });
    });
  }

  /**
   * Must be called every frame to advance path calculations.
   */
  update(): void {
    this.infantryFinder.calculate();
    this.vehicleFinder.calculate();
  }
}

export const pathfinding = new PathfindingSystem();
