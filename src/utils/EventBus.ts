// ─── Global Event Bus ────────────────────────────────────────────────────────
// Typed event system for decoupled communication between game systems.

type EventCallback = (...args: any[]) => void;

class EventBusClass {
  private listeners: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx !== -1) cbs.splice(idx, 1);
    }
  }

  emit(event: string, ...args: any[]): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        cb(...args);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const EventBus = new EventBusClass();

// ─── Event Names (type-safe constants) ───────────────────────────────────────

export const GameEvents = {
  // Selection
  UNIT_SELECTED: 'unit:selected',
  UNIT_DESELECTED: 'unit:deselected',
  BUILDING_SELECTED: 'building:selected',
  SELECTION_CLEARED: 'selection:cleared',
  SELECTION_BOX: 'selection:box',

  // Commands
  MOVE_ORDER: 'command:move',
  ATTACK_ORDER: 'command:attack',
  CAPTURE_ORDER: 'command:capture',
  RETREAT_ORDER: 'command:retreat',
  PRODUCE_UNIT: 'command:produce',
  TRANSPORT_GOODS: 'command:transport',

  // Economy
  CASH_CHANGED: 'economy:cash',
  GOODS_CHANGED: 'economy:goods',
  INFLUENCE_CHANGED: 'economy:influence',
  INCOME_TICK: 'economy:tick',

  // Territory
  CORNER_CAPTURED: 'territory:corner_captured',
  CORNER_LOST: 'territory:corner_lost',
  INFLUENCE_UPDATED: 'territory:influence_updated',

  // Buildings
  BUILDING_CAPTURED: 'building:captured',
  BUILDING_LOST: 'building:lost',
  BUILDING_DESTROYED: 'building:destroyed',
  BUILDING_DAMAGED: 'building:damaged',
  CAPTURE_STARTED: 'building:capture_started',
  CAPTURE_PROGRESS: 'building:capture_progress',

  // Combat
  UNIT_DAMAGED: 'combat:unit_damaged',
  UNIT_KILLED: 'combat:unit_killed',
  SQUAD_WIPED: 'combat:squad_wiped',
  COMBAT_STARTED: 'combat:started',

  // Logistics
  TRUCK_DESTROYED: 'logistics:truck_destroyed',
  GOODS_DROPPED: 'logistics:goods_dropped',
  GOODS_DELIVERED: 'logistics:goods_delivered',
  GOODS_PICKED_UP: 'logistics:goods_picked_up',

  // Tier
  TIER_ADVANCED: 'tier:advanced',
  TIER_RESEARCH_STARTED: 'tier:research_started',

  // Production
  UNIT_PRODUCED: 'production:unit_produced',

  // Game state
  GAME_STARTED: 'game:started',
  GAME_OVER: 'game:over',
  GAME_PAUSED: 'game:paused',
  GAME_RESUMED: 'game:resumed',
  GAME_SPEED_CHANGED: 'game:speed_changed',
  PLAYER_ELIMINATED: 'game:player_eliminated',
} as const;
