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
}

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
  },
];
