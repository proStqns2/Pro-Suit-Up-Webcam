export type SuitPresetId =
  | 'MK85_ENDGAME'
  | 'MK85_LAB_PROTO'
  | 'MK85_STEALTH_OPS'
  | 'MK85_BATTLE_DAMAGED';

export interface SuitPreset {
  id: SuitPresetId;
  name: string;
  shortLabel: string;
  description: string;
  crimsonHex: string;
  crimsonDarkHex: string;
  goldHex: string;
  titaniumHex: string;
  emissiveHex: string;
  hudAccentHex: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  emissiveIntensity: number;
  bloomStrength: number;
  wearAmount: number;
}

export interface CalibrationProfile {
  fitScale: number;
  selectedPresetId: SuitPresetId;
  bloomStrength: number;
  metricShoulderWidth: number;
  torsoAspectRatio: number;
  updatedAt: string;
}

export interface TelemetrySessionPayload {
  mode: string;
  fps: number;
  syncPercent: number;
  arcEnergy: number;
  suitUpCountDelta?: number;
  repulsorShotsDelta?: number;
}

export interface TelemetrySummary {
  totalSessions: number;
  totalSuitUps: number;
  totalRepulsorShots: number;
  avgFps: number;
  avgSync: number;
  lastMode: string;
  lastUpdatedAt: string;
}

export const DEFAULT_SUIT_PRESETS: SuitPreset[] = [
  {
    id: 'MK85_ENDGAME',
    name: 'Mark 85 Endgame',
    shortLabel: 'MK-85',
    description: 'Alliage nanotech cerise anodisé haute brillance & or champagne MCU',
    crimsonHex: '#8d0e17',
    crimsonDarkHex: '#46070c',
    goldHex: '#cfa04c',
    titaniumHex: '#9da9b8',
    emissiveHex: '#4bf5ff',
    hudAccentHex: '#3bf0ff',
    metalness: 0.90,
    roughness: 0.21,
    clearcoat: 0.85,
    clearcoatRoughness: 0.09,
    emissiveIntensity: 4.6,
    bloomStrength: 0.62,
    wearAmount: 0.14,
  },
  {
    id: 'MK85_LAB_PROTO',
    name: 'Mark 86 Prototype Labo',
    shortLabel: 'PROTO',
    description: 'Finition atelier Stark chrome usiné, titane brut & réacteur surcadencé',
    crimsonHex: '#a31621',
    crimsonDarkHex: '#520a11',
    goldHex: '#dfc17c',
    titaniumHex: '#c6d1de',
    emissiveHex: '#7ef9ff',
    hudAccentHex: '#7ef9ff',
    metalness: 0.94,
    roughness: 0.16,
    clearcoat: 0.92,
    clearcoatRoughness: 0.07,
    emissiveIntensity: 5.2,
    bloomStrength: 0.72,
    wearAmount: 0.06,
  },
  {
    id: 'MK85_STEALTH_OPS',
    name: 'Recon Furtive MK-85S',
    shortLabel: 'FURTIF',
    description: 'Obsidienne absorbante radar, titane sombre & signature émeraude faible',
    crimsonHex: '#151922',
    crimsonDarkHex: '#0b0e14',
    goldHex: '#3c4556',
    titaniumHex: '#2c3340',
    emissiveHex: '#2cf59c',
    hudAccentHex: '#2cf59c',
    metalness: 0.78,
    roughness: 0.44,
    clearcoat: 0.20,
    clearcoatRoughness: 0.34,
    emissiveIntensity: 3.4,
    bloomStrength: 0.48,
    wearAmount: 0.22,
  },
  {
    id: 'MK85_BATTLE_DAMAGED',
    name: 'Assaut Combat Final',
    shortLabel: 'COMBAT',
    description: 'Patine de combat, micro-rayures acier exposé & arc suralimenté',
    crimsonHex: '#6c0d13',
    crimsonDarkHex: '#31070a',
    goldHex: '#a87d34',
    titaniumHex: '#7e8794',
    emissiveHex: '#54f0ff',
    hudAccentHex: '#f5c35b',
    metalness: 0.88,
    roughness: 0.32,
    clearcoat: 0.52,
    clearcoatRoughness: 0.22,
    emissiveIntensity: 5.0,
    bloomStrength: 0.68,
    wearAmount: 0.65,
  },
];

export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  fitScale: 1.0,
  selectedPresetId: 'MK85_ENDGAME',
  bloomStrength: 0.62,
  metricShoulderWidth: 0.40,
  torsoAspectRatio: 1.38,
  updatedAt: new Date(0).toISOString(),
};
