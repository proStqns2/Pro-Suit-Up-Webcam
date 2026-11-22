import {
  DEFAULT_CALIBRATION_PROFILE,
  DEFAULT_SUIT_PRESETS,
  type CalibrationProfile,
  type SuitPreset,
  type TelemetrySessionPayload,
  type TelemetrySummary,
} from '../types/SuitPreset';

export class BackendClient {
  async getHealth(): Promise<{ status: string; wasmAssetsReady: boolean } | null> {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return null;
      return (await res.json()) as { status: string; wasmAssetsReady: boolean };
    } catch {
      return null;
    }
  }

  async getSuitPresets(): Promise<SuitPreset[]> {
    try {
      const res = await fetch('/api/suits/presets', { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return DEFAULT_SUIT_PRESETS;
      const data = (await res.json()) as { presets?: SuitPreset[] };
      return Array.isArray(data.presets) && data.presets.length > 0 ? data.presets : DEFAULT_SUIT_PRESETS;
    } catch {
      return DEFAULT_SUIT_PRESETS;
    }
  }

  async getCalibration(): Promise<CalibrationProfile> {
    try {
      const res = await fetch('/api/calibration', { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return DEFAULT_CALIBRATION_PROFILE;
      return (await res.json()) as CalibrationProfile;
    } catch {
      return DEFAULT_CALIBRATION_PROFILE;
    }
  }

  async saveCalibration(partial: Partial<CalibrationProfile>): Promise<CalibrationProfile | null> {
    try {
      const res = await fetch('/api/calibration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return null;
      return (await res.json()) as CalibrationProfile;
    } catch {
      return null;
    }
  }

  async sendTelemetry(payload: TelemetrySessionPayload): Promise<TelemetrySummary | null> {
    try {
      const res = await fetch('/api/telemetry/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return null;
      return (await res.json()) as TelemetrySummary;
    } catch {
      return null;
    }
  }
}
