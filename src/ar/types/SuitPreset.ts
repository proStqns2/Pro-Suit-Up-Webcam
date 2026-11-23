export type SuitPresetId =
  | 'MK42_PRODIGAL_SON'
  | 'MK85_ENDGAME'
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
  waistWidthFactor: number;
  armGirthFactor: number;
  frontScanned: boolean;
  backScanned: boolean;
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
    name: 'Mark 85 Endgame CNC',
    shortLabel: 'MK-85',
    description: 'Rouge métallisé satiné, or brossé, soufflets sombres & réacteur blanc-cyan',
    crimsonHex: '#7c0b13',
    crimsonDarkHex: '#43060b',
    goldHex: '#c2984b',
    titaniumHex: '#6e7684',
    emissiveHex: '#d8f8ff',
    hudAccentHex: '#3bf0ff',
    metalness: 0.85,
    roughness: 0.24,
    clearcoat: 0.78,
    clearcoatRoughness: 0.14,
    emissiveIntensity: 3.4,
    bloomStrength: 0.36,
    wearAmount: 0.10,
  },
  {
    id: 'MK42_PRODIGAL_SON',
    name: 'Mark 42 Mécatronique',
    shortLabel: 'MK-42',
    description: 'Assemblage autonome modulaire or champagne dominant & cerise métallisé (IM3)',
    crimsonHex: '#bf984e',
    crimsonDarkHex: '#7b5f2b',
    goldHex: '#750a11',
    titaniumHex: '#6c7482',
    emissiveHex: '#c8f8ff',
    hudAccentHex: '#f5c35b',
    metalness: 0.93,
    roughness: 0.20,
    clearcoat: 0.86,
    clearcoatRoughness: 0.09,
    emissiveIntensity: 3.6,
    bloomStrength: 0.45,
    wearAmount: 0.16,
  },
  {
    id: 'MK85_STEALTH_OPS',
    name: 'Recon Furtive MK-85S',
    shortLabel: 'FURTIF',
    description: 'Obsidienne carbone absorbante radar, titane brossé & optique discrète',
    crimsonHex: '#151922',
    crimsonDarkHex: '#0b0e14',
    goldHex: '#3c4556',
    titaniumHex: '#2c3340',
    emissiveHex: '#2cf59c',
    hudAccentHex: '#2cf59c',
    metalness: 0.80,
    roughness: 0.42,
    clearcoat: 0.22,
    clearcoatRoughness: 0.34,
    emissiveIntensity: 3.0,
    bloomStrength: 0.38,
    wearAmount: 0.20,
  },
  {
    id: 'MK85_BATTLE_DAMAGED',
    name: 'Assaut Combat Final',
    shortLabel: 'COMBAT',
    description: 'Blindage cerise usé au combat, arêtes acier exposé & réacteur stable',
    crimsonHex: '#610b10',
    crimsonDarkHex: '#2a0508',
    goldHex: '#9c7432',
    titaniumHex: '#717a86',
    emissiveHex: '#84f3ff',
    hudAccentHex: '#f5c35b',
    metalness: 0.90,
    roughness: 0.30,
    clearcoat: 0.56,
    clearcoatRoughness: 0.20,
    emissiveIntensity: 4.2,
    bloomStrength: 0.52,
    wearAmount: 0.62,
  },
];

export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  fitScale: 1.0,
  selectedPresetId: 'MK85_ENDGAME',
  bloomStrength: 0.48,
  metricShoulderWidth: 0.40,
  torsoAspectRatio: 1.38,
  waistWidthFactor: 1.0,
  armGirthFactor: 1.0,
  frontScanned: false,
  backScanned: false,
  updatedAt: new Date(0).toISOString(),
};
