// ─── Family Data ──────────────────────────────────────────────────────────────
// Defines the four playable mafia families, their lore, and gameplay bonuses.

export interface FamilyData {
  id: string;
  name: string;
  subtitle: string; // e.g. "The Old Guard"
  description: string; // 1-2 sentence playstyle description
  bonuses: string[]; // list of faction bonuses
  color: number; // hex color
  accentColor: number; // lighter accent
  /** Numeric gameplay modifiers (1.0 = no change, 1.15 = +15%, etc.) */
  modifiers: FamilyModifiers;
}

export interface FamilyModifiers {
  buildingHpMultiplier: number;       // Morellis: 1.15
  garrisonReductionBonus: number;     // Morellis: 0.10 (added to base)
  influenceGainMultiplier: number;    // Ashfords: 1.20
  unitDpsMultiplier: number;          // Ashfords: 0.90, Korvaks: 1.10
  coverDpsBonus: number;              // Ashfords: 0.05 (extra DPS when in cover)
  trainTimeMultiplier: number;        // Korvaks: 0.88 for T2+
  unitCostMultiplier: number;         // Korvaks: 1.05
  cashIncomeMultiplier: number;       // Solomons: 1.15
  truckCapacityBonus: number;         // Solomons: 5
}

/** Default modifiers (no family bonus). */
export const DEFAULT_MODIFIERS: FamilyModifiers = {
  buildingHpMultiplier: 1.0,
  garrisonReductionBonus: 0,
  influenceGainMultiplier: 1.0,
  unitDpsMultiplier: 1.0,
  coverDpsBonus: 0,
  trainTimeMultiplier: 1.0,
  unitCostMultiplier: 1.0,
  cashIncomeMultiplier: 1.0,
  truckCapacityBonus: 0,
};

export const FAMILIES: FamilyData[] = [
  {
    id: 'morellis',
    name: 'The Morellis',
    subtitle: 'The Old Guard',
    description:
      'Traditional Sicilian family. Defensive playstyle — fortify positions and grind enemies down.',
    bonuses: [
      '+15% building HP',
      '+10% garrison damage reduction',
      'Compound repair rate doubled',
    ],
    color: 0xcc0000,
    accentColor: 0xff3333,
    modifiers: {
      ...DEFAULT_MODIFIERS,
      buildingHpMultiplier: 1.15,
      garrisonReductionBonus: 0.10,
    },
  },
  {
    id: 'ashfords',
    name: 'The Ashfords',
    subtitle: 'The Politicians',
    description:
      'Old money Anglo family with political connections. Control the city through influence and manipulation.',
    bonuses: [
      '+20% Influence gain',
      '-10% unit DPS (but +5% in cover)',
      'City Hall Contact costs halved',
    ],
    color: 0x0044cc,
    accentColor: 0x3377ff,
    modifiers: {
      ...DEFAULT_MODIFIERS,
      influenceGainMultiplier: 1.20,
      unitDpsMultiplier: 0.90,
      coverDpsBonus: 0.05,
    },
  },
  {
    id: 'korvaks',
    name: 'The Korvaks',
    subtitle: 'The Enforcers',
    description:
      'Eastern European syndicate. Aggressive rush playstyle — hit fast and hit hard.',
    bonuses: [
      '-12% training time (T2+ only)',
      '+10% unit DPS',
      '+5% unit cost',
    ],
    color: 0x228b22,
    accentColor: 0x44cc44,
    modifiers: {
      ...DEFAULT_MODIFIERS,
      trainTimeMultiplier: 0.88,
      unitDpsMultiplier: 1.10,
      unitCostMultiplier: 1.05,
    },
  },
  {
    id: 'solomons',
    name: 'The Solomons',
    subtitle: 'The Bankers',
    description:
      'Jewish-American crime family. Economic boom playstyle — outproduce and outspend opponents.',
    bonuses: [
      '+15% cash income',
      'Truck capacity +5 Goods',
      'Hostile Takeover costs $4,250',
    ],
    color: 0xdaa520,
    accentColor: 0xffd700,
    modifiers: {
      ...DEFAULT_MODIFIERS,
      cashIncomeMultiplier: 1.15,
      truckCapacityBonus: 5,
    },
  },
];
