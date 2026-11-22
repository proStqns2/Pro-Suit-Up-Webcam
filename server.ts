import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { Express, Request, Response } from 'express';
import {
  DEFAULT_CALIBRATION_PROFILE,
  DEFAULT_SUIT_PRESETS,
  type CalibrationProfile,
  type SuitPresetId,
  type TelemetrySessionPayload,
  type TelemetrySummary,
} from './src/ar/types/SuitPreset.ts';

interface PersistedJarvisState {
  calibration: CalibrationProfile;
  telemetry: TelemetrySummary;
}

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOT_DIR = path.resolve(process.cwd());
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const STATE_FILE = path.resolve(DATA_DIR, 'jarvis-state.json');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const WASM_DIR = path.resolve(ROOT_DIR, 'public', 'mediapipe-wasm');

const VALID_PRESET_IDS = new Set<SuitPresetId>([
  'MK85_ENDGAME',
  'MK85_LAB_PROTO',
  'MK85_STEALTH_OPS',
  'MK85_BATTLE_DAMAGED',
]);

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.min(max, Math.max(min, val));
}

function createInitialState(): PersistedJarvisState {
  return {
    calibration: {
      ...DEFAULT_CALIBRATION_PROFILE,
      updatedAt: new Date().toISOString(),
    },
    telemetry: {
      totalSessions: 0,
      totalSuitUps: 0,
      totalRepulsorShots: 0,
      avgFps: 60,
      avgSync: 0,
      lastMode: 'NONE',
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

let stateCache: PersistedJarvisState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function ensureDataDir(): Promise<void> {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function loadState(): Promise<PersistedJarvisState> {
  if (stateCache) return stateCache;
  if (!STATE_FILE.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid state file path');
  }

  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedJarvisState>;
    const initial = createInitialState();
    const cal = parsed.calibration;
    const tel = parsed.telemetry;

    const presetId: SuitPresetId =
      cal && typeof cal.selectedPresetId === 'string' && VALID_PRESET_IDS.has(cal.selectedPresetId as SuitPresetId)
        ? (cal.selectedPresetId as SuitPresetId)
        : initial.calibration.selectedPresetId;

    stateCache = {
      calibration: {
        fitScale: clampNumber(cal?.fitScale, 0.8, 1.35, initial.calibration.fitScale),
        selectedPresetId: presetId,
        bloomStrength: clampNumber(cal?.bloomStrength, 0, 1.4, initial.calibration.bloomStrength),
        metricShoulderWidth: clampNumber(cal?.metricShoulderWidth, 0.24, 0.65, initial.calibration.metricShoulderWidth),
        torsoAspectRatio: clampNumber(cal?.torsoAspectRatio, 0.9, 2.2, initial.calibration.torsoAspectRatio),
        updatedAt: typeof cal?.updatedAt === 'string' ? cal.updatedAt : initial.calibration.updatedAt,
      },
      telemetry: {
        totalSessions: clampNumber(tel?.totalSessions, 0, 1_000_000, 0),
        totalSuitUps: clampNumber(tel?.totalSuitUps, 0, 1_000_000, 0),
        totalRepulsorShots: clampNumber(tel?.totalRepulsorShots, 0, 1_000_000, 0),
        avgFps: clampNumber(tel?.avgFps, 1, 240, 60),
        avgSync: clampNumber(tel?.avgSync, 0, 100, 0),
        lastMode: typeof tel?.lastMode === 'string' ? tel.lastMode.slice(0, 32) : 'NONE',
        lastUpdatedAt: typeof tel?.lastUpdatedAt === 'string' ? tel.lastUpdatedAt : initial.telemetry.lastUpdatedAt,
      },
    };
    return stateCache;
  } catch {
    stateCache = createInitialState();
    return stateCache;
  }
}

function persistState(nextState: PersistedJarvisState): Promise<void> {
  stateCache = nextState;
  writeQueue = writeQueue.then(async () => {
    await ensureDataDir();
    const tmpFile = path.resolve(DATA_DIR, `jarvis-state.${process.pid}.tmp`);
    if (!tmpFile.startsWith(DATA_DIR + path.sep) || !STATE_FILE.startsWith(DATA_DIR + path.sep)) {
      throw new Error('Path traversal guard triggered');
    }
    await fsp.writeFile(tmpFile, JSON.stringify(nextState, null, 2), 'utf8');
    await fsp.rename(tmpFile, STATE_FILE);
  });
  return writeQueue;
}

function registerApiRoutes(app: Express): void {
  app.use('/api', express.json({ limit: '16kb' }));

  app.get('/api/health', async (_req: Request, res: Response) => {
    const wasmReady = fs.existsSync(path.resolve(WASM_DIR, 'vision_wasm_internal.wasm'));
    const state = await loadState();
    res.json({
      status: 'operational',
      service: 'jarvis-mk85-tactical-core',
      nodeVersion: process.version,
      uptimeSec: Math.round(process.uptime()),
      wasmAssetsReady: wasmReady,
      presetCount: DEFAULT_SUIT_PRESETS.length,
      selectedPresetId: state.calibration.selectedPresetId,
    });
  });

  app.get('/api/suits/presets', (_req: Request, res: Response) => {
    res.json({
      presets: DEFAULT_SUIT_PRESETS,
    });
  });

  app.get('/api/calibration', async (_req: Request, res: Response) => {
    const state = await loadState();
    res.json(state.calibration);
  });

  app.post('/api/calibration', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Payload JSON invalide' });
      return;
    }

    const current = await loadState();
    const nextPresetId =
      typeof body.selectedPresetId === 'string' && VALID_PRESET_IDS.has(body.selectedPresetId as SuitPresetId)
        ? (body.selectedPresetId as SuitPresetId)
        : current.calibration.selectedPresetId;

    const updatedCal: CalibrationProfile = {
      fitScale: clampNumber(body.fitScale, 0.8, 1.35, current.calibration.fitScale),
      selectedPresetId: nextPresetId,
      bloomStrength: clampNumber(body.bloomStrength, 0.0, 1.4, current.calibration.bloomStrength),
      metricShoulderWidth: clampNumber(
        body.metricShoulderWidth,
        0.24,
        0.65,
        current.calibration.metricShoulderWidth
      ),
      torsoAspectRatio: clampNumber(body.torsoAspectRatio, 0.9, 2.2, current.calibration.torsoAspectRatio),
      updatedAt: new Date().toISOString(),
    };

    await persistState({
      ...current,
      calibration: updatedCal,
    });

    res.json(updatedCal);
  });

  app.get('/api/telemetry/summary', async (_req: Request, res: Response) => {
    const state = await loadState();
    res.json(state.telemetry);
  });

  app.post('/api/telemetry/session', async (req: Request, res: Response) => {
    const body = req.body as Partial<TelemetrySessionPayload> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Payload télémétrie invalide' });
      return;
    }

    const current = await loadState();
    const prev = current.telemetry;
    const modeSafe =
      typeof body.mode === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(body.mode) ? body.mode : prev.lastMode;
    const fpsSample = clampNumber(body.fps, 1, 240, prev.avgFps);
    const syncSample = clampNumber(body.syncPercent, 0, 100, prev.avgSync);
    const suitUpDelta = Math.round(clampNumber(body.suitUpCountDelta, 0, 20, 0));
    const shotsDelta = Math.round(clampNumber(body.repulsorShotsDelta, 0, 50, 0));
    const isNewSession = suitUpDelta > 0 && prev.totalSessions === 0 ? 1 : body.mode ? 1 : 0;

    const totalSessions = prev.totalSessions + isNewSession;
    const weight = Math.min(totalSessions, 20);
    const nextTel: TelemetrySummary = {
      totalSessions,
      totalSuitUps: prev.totalSuitUps + suitUpDelta,
      totalRepulsorShots: prev.totalRepulsorShots + shotsDelta,
      avgFps: Number(((prev.avgFps * (weight - 1) + fpsSample) / Math.max(weight, 1)).toFixed(1)),
      avgSync: Number(((prev.avgSync * (weight - 1) + syncSample) / Math.max(weight, 1)).toFixed(1)),
      lastMode: modeSafe,
      lastUpdatedAt: new Date().toISOString(),
    };

    await persistState({
      ...current,
      telemetry: nextTel,
    });

    res.json(nextTel);
  });
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  registerApiRoutes(app);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR, { maxAge: '1h', index: 'index.html' }));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(DIST_DIR, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[J.A.R.V.I.S. Core] Serveur actif sur http://0.0.0.0:${PORT} (${IS_PROD ? 'PROD' : 'DEV'})`);
  });
}

void startServer();
