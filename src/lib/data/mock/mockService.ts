/**
 * Implementación mock de `DataService`: responde con los mismos tipos que el cliente
 * FastAPI, a partir del universo determinista. Todos los resultados son DEMOSTRACIÓN.
 */
import { cellToBoundary, cellToLatLng, cellToParent, gridDisk, isValidCell, getResolution } from 'h3-js';
import { addDays, dayIndexFromISO, dayOfYear, monthEnd, monthStart, type ISODate } from '@/lib/time/dates';
import {
  aggregateRecords, availabilityFromCoverage, computeTotals, DAILY_INDEX_SCALE, MONTHLY_INDEX_SCALE,
} from '@/lib/geo/aggregate';
import type {
  ActivityQuery, ActivitySnapshot, CellActivity, CellInfo, ConfidenceFilter, DatasetMetadata, Detection,
  ModelInfo, Prediction, PredictionFeature, Region, Satellite, SeriesPoint, SeriesTarget, WeatherDaily,
} from '@/lib/types/domain';
import type { DataService, PredictionDetail } from '../service';
import { clamp, mix, normal, u01 } from './random';
import {
  AVAIL_MISSING, AVAIL_OBSERVED, AVAIL_PARTIAL, DATA_END, DATA_START, GENERATOR_VERSION, getUniverse,
  MODIS_CALIBRATION, NATIVE_RES, seasonFactor, type MockUniverse,
} from './universe';

export const MOCK_MODEL_VERSION = 'demo-logit-0.3.0';

/* ------------------------------------------------------------------ */
/* Confianza                                                          */
/* ------------------------------------------------------------------ */
function splitConfidence(count: number, seed: number, low: number, high: number): [number, number, number] {
  if (count <= 0) return [0, 0, 0];
  const l = Math.min(count, Math.floor(count * low + u01(seed, count, 1)));
  const h = Math.min(count - l, Math.floor(count * high + u01(seed, count, 2)));
  return [l, count - l - h, h];
}

function filterCount(split: [number, number, number], filter: ConfidenceFilter): number {
  if (filter === 'high') return split[2];
  if (filter === 'nominal') return split[1] + split[2];
  return split[0] + split[1] + split[2];
}

/* ------------------------------------------------------------------ */
/* Acumulación por celda (día o mes)                                  */
/* ------------------------------------------------------------------ */
interface Accum {
  modis: number;
  viirs: number;
  modisDays: number;
  viirsDays: number;
  combined: number;
  obsDays: number;
  coverage: number;
  days: number;
  anomaly: boolean;
  score: number;
  modisFrp: number;
  viirsFrp: number;
}

function accumulate(u: MockUniverse, cellIdx: number[], dis: number[]): Accum[] {
  const acc: Accum[] = cellIdx.map(() => ({
    modis: 0, viirs: 0, modisDays: 0, viirsDays: 0, combined: 0, obsDays: 0, coverage: 0, days: 0,
    anomaly: false, score: 0, modisFrp: 0, viirsFrp: 0,
  }));
  for (const di of dis) {
    const block = u.day(di);
    for (let k = 0; k < cellIdx.length; k++) {
      const ci = cellIdx[k];
      const a = acc[k];
      const sensors = block.sensors[ci];
      a.days++;
      if (sensors & 1) {
        a.modis += block.modis[ci];
        a.modisDays++;
        a.modisFrp += block.modisFrp[ci];
      }
      if (sensors & 2) {
        a.viirs += block.viirs[ci];
        a.viirsDays++;
        a.viirsFrp += block.viirsFrp[ci];
      }
      const c = block.combined[ci];
      if (!Number.isNaN(c)) {
        a.combined += c;
        a.obsDays++;
      }
      const av = block.avail[ci];
      a.coverage += av === AVAIL_OBSERVED ? 1 : av === AVAIL_PARTIAL ? 0.5 : 0;
      if (block.anomaly[ci]) a.anomaly = true;
      a.score = Math.max(a.score, block.score[ci]);
    }
  }
  return acc;
}

function daysForQuery(u: MockUniverse, date: ISODate, granularity: 'day' | 'month'): number[] {
  if (granularity === 'day') {
    const di = u.dayOffset(date);
    return di >= 0 ? [di] : [];
  }
  const out: number[] = [];
  const a = dayIndexFromISO(monthStart(date)) - u.startIdx;
  const b = dayIndexFromISO(monthEnd(date)) - u.startIdx;
  for (let di = Math.max(0, a); di <= Math.min(u.nDays - 1, b); di++) out.push(di);
  return out;
}

/* ------------------------------------------------------------------ */
/* Predicción experimental (regresión logística simulada)             */
/* ------------------------------------------------------------------ */
const COEF = {
  intercept: -4.3,
  recent7: 0.62,
  recent30: 0.22,
  neighbors: 0.42,
  rain7: -0.05,
  tempAnomaly: 0.1,
  season: 1.5,
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function sumCombined(u: MockUniverse, ci: number, di: number, days: number): number {
  let s = 0;
  for (let k = 0; k < days; k++) {
    const d = di - k;
    if (d < 0) break;
    const c = u.day(d).combined[ci];
    if (!Number.isNaN(c)) s += c;
  }
  return s;
}

interface FeatureVector {
  recent7: number;
  recent30: number;
  neighbors7: number;
  rain7: number;
  tempAnomaly: number;
  seasonPrior: number;
  month: number;
}

function featureVector(u: MockUniverse, ci: number, di: number, recent7Of: (ci: number) => number): FeatureVector {
  const cell = u.cells[ci];
  const series = u.regionSeries(cell.region);
  const def = u.regions[cell.region];
  const recent7 = recent7Of(ci);
  const recent30 = sumCombined(u, ci, di, 30);
  const nb = u.neighbors(ci);
  let nSum = 0;
  for (let i = 0; i < nb.length; i++) nSum += recent7Of(nb[i]);
  const neighbors7 = nb.length ? nSum / nb.length : 0;
  const nextDoy = dayOfYear(u.startIdx + di + 1);
  return {
    recent7,
    recent30,
    neighbors7,
    rain7: series.rain7[di],
    tempAnomaly: series.temp7[di] - series.tempClim[di],
    seasonPrior: clamp(seasonFactor(def, nextDoy), 0, 1.05),
    month: new Date((u.startIdx + di + 1) * 86_400_000).getUTCMonth() + 1,
  };
}

function logitParts(f: FeatureVector) {
  return {
    recent7: COEF.recent7 * Math.log1p(f.recent7),
    recent30: COEF.recent30 * Math.log1p(f.recent30),
    neighbors: COEF.neighbors * Math.log1p(f.neighbors7),
    rain7: COEF.rain7 * f.rain7,
    tempAnomaly: COEF.tempAnomaly * f.tempAnomaly,
    season: COEF.season * f.seasonPrior,
  };
}

function probabilityOf(f: FeatureVector): number {
  const p = logitParts(f);
  return sigmoid(COEF.intercept + p.recent7 + p.recent30 + p.neighbors + p.rain7 + p.tempAnomaly + p.season);
}

function featuresToList(f: FeatureVector): PredictionFeature[] {
  const parts = logitParts(f);
  return [
    { key: 'recent_activity_7d', label: 'Actividad previa 7 días', value: f.recent7, unit: 'det. eq.', contribution: parts.recent7, description: 'Suma del índice VIIRS-equivalente en los 7 días previos (incluye el día t).' },
    { key: 'recent_activity_30d', label: 'Actividad previa 30 días', value: f.recent30, unit: 'det. eq.', contribution: parts.recent30, description: 'Suma en los 30 días previos.' },
    { key: 'neighbors_7d', label: 'Vecinos H3 (anillo 1) 7 días', value: f.neighbors7, unit: 'det. eq.', contribution: parts.neighbors, description: 'Media de la actividad de 7 días en las celdas adyacentes.' },
    { key: 'rain_7d', label: 'Lluvia acumulada 7 días', value: f.rain7, unit: 'mm', contribution: parts.rain7, description: 'Tipo NASA POWER (PRECTOTCORR); celda meteorológica más gruesa que H3 res 6.' },
    { key: 'temp_7d_anomaly', label: 'Anomalía de temperatura 7 días', value: f.tempAnomaly, unit: '°C', contribution: parts.tempAnomaly, description: 'Temperatura media 7 días menos la climatología (T2M).' },
    { key: 'season_prior', label: 'Prior estacional (mes)', value: f.seasonPrior, unit: '0–1', contribution: parts.season, description: `Curva estacional regional para el mes ${f.month}.` },
  ];
}

/* ------------------------------------------------------------------ */
/* Servicio                                                           */
/* ------------------------------------------------------------------ */
class MockDataService implements DataService {
  readonly kind = 'mock' as const;
  private u = getUniverse();
  private seriesCache = new Map<string, SeriesPoint[]>();
  private predictionCache = new Map<number, Float32Array>();

  async getDataRange() {
    return { start: DATA_START, end: DATA_END };
  }

  async getRegions(): Promise<Region[]> {
    const u = this.u;
    return u.regions.map((def, ri) => {
      const idx = u.regionCells[ri];
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      for (const ci of idx) {
        const c = u.cells[ci];
        minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
        minLng = Math.min(minLng, c.lng); maxLng = Math.max(maxLng, c.lng);
      }
      return {
        id: def.id, name: def.name, country: def.country, countryCode: def.countryCode, admin: def.admin,
        biome: def.biome, center: def.center, isPilot: def.isPilot, description: def.description,
        resolution: NATIVE_RES, cellCount: idx.length, bbox: [minLng, minLat, maxLng, maxLat],
        utcOffset: def.utcOffset, seasonLabel: def.seasonLabel,
      };
    });
  }

  async getRegionCells(regionId: string) {
    const ri = this.u.regionIndexOf(regionId);
    return ri < 0 ? [] : this.u.regionCells[ri].map((ci) => this.u.cells[ci].h3);
  }

  private nativeRecords(q: ActivityQuery): CellActivity[] {
    const u = this.u;
    const regionIdx = q.regionIds?.length
      ? q.regionIds.map((id) => u.regionIndexOf(id)).filter((i) => i >= 0)
      : u.regions.map((_, i) => i);
    const cellIdx = regionIdx.flatMap((ri) => u.regionCells[ri]);
    const dis = daysForQuery(u, q.date, q.granularity);
    const monthly = q.granularity === 'month';
    const scale = monthly ? MONTHLY_INDEX_SCALE : DAILY_INDEX_SCALE;
    const filter = q.confidence ?? 'all';
    const acc = dis.length ? accumulate(u, cellIdx, dis) : null;
    const probs = q.withPredictions && q.granularity === 'day' && dis.length ? this.predictAll(dis[0]) : null;
    const records: CellActivity[] = new Array(cellIdx.length);
    for (let k = 0; k < cellIdx.length; k++) {
      const ci = cellIdx[k];
      const cell = u.cells[ci];
      const a = acc?.[k];
      const days = a?.days ?? 0;
      const coverage = days ? a!.coverage / days : 0;
      let modis: number | null = a && a.modisDays ? a.modis : null;
      let viirs: number | null = a && a.viirsDays ? a.viirs : null;
      const modisSplit = modis !== null ? splitConfidence(modis, cell.hash ^ 0x5bd1, 0.15, 0.25) : null;
      const viirsSplit = viirs !== null ? splitConfidence(viirs, cell.hash ^ 0x3c6e, 0.12, 0.2) : null;
      let combined = a && a.obsDays ? a.combined : NaN;
      if (filter !== 'all' && a) {
        modis = modisSplit ? filterCount(modisSplit, filter) : null;
        viirs = viirsSplit ? filterCount(viirsSplit, filter) : null;
        if (modis !== null && viirs !== null) combined = 0.65 * viirs + 0.35 * modis * MODIS_CALIBRATION;
        else if (viirs !== null) combined = viirs;
        else if (modis !== null) combined = modis * MODIS_CALIBRATION;
      }
      const flag = days === 1 ? (['observed', 'partial', 'missing'] as const)[u.day(dis[0]).avail[ci]] : availabilityFromCoverage(coverage);
      records[k] = {
        h3_id: cell.h3,
        date: q.date,
        resolution: NATIVE_RES,
        regionId: u.regions[cell.region].id,
        center: { lat: cell.lat, lng: cell.lng },
        childCount: 1,
        coverage,
        modis_detected: modis,
        viirs_detected: viirs,
        activity_index: Number.isNaN(combined) ? null : 1 - Math.exp(-combined / scale),
        availability_flag: days ? flag : 'missing',
        is_anomaly: a?.anomaly ?? false,
        anomaly_score: a ? Math.round(a.score * 100) / 100 : null,
        modis_frp_sum: modis !== null ? Math.round(a!.modisFrp * 10) / 10 : null,
        viirs_frp_sum: viirs !== null ? Math.round(a!.viirsFrp * 10) / 10 : null,
        modis_by_confidence: modisSplit,
        viirs_by_confidence: viirsSplit,
        probability: probs ? probs[ci] : null,
      };
    }
    return records;
  }

  async getActivity(q: ActivityQuery): Promise<ActivitySnapshot> {
    return this.getActivityInner(q);
  }

  private getActivityInner(q: ActivityQuery): ActivitySnapshot {
    const native = this.nativeRecords(q);
    const { totals, byRegion } = computeTotals(native);
    const scale = q.granularity === 'month' ? MONTHLY_INDEX_SCALE : DAILY_INDEX_SCALE;
    const u = this.u;
    const parentOf = (h3: string, res: number) => {
      const ci = u.cellIndex.get(h3);
      if (ci !== undefined) {
        if (res === 5) return u.cells[ci].parent5;
        if (res === 4) return u.cells[ci].parent4;
      }
      return cellToParent(h3, res);
    };
    const records = q.resolution >= NATIVE_RES ? native : aggregateRecords(native, q.resolution, scale, parentOf);
    return { date: q.date, granularity: q.granularity, resolution: Math.min(q.resolution, NATIVE_RES), records, totals, byRegion, source: 'mock' };
  }

  async getSeries(target: SeriesTarget, from: ISODate, to: ISODate): Promise<SeriesPoint[]> {
    const key = `${target.kind}:${target.kind === 'cell' ? target.h3 : target.regionId}:${from}:${to}`;
    const cached = this.seriesCache.get(key);
    if (cached) return cached;
    const u = this.u;
    const a = dayIndexFromISO(from) - u.startIdx;
    const b = dayIndexFromISO(to) - u.startIdx;
    const out: SeriesPoint[] = [];
    const names = ['observed', 'partial', 'missing'] as const;
    const nativeCell = target.kind === 'cell' ? u.cellIndex.get(target.h3) : undefined;
    if (target.kind === 'cell' && (nativeCell !== undefined || !isValidCell(target.h3) || getResolution(target.h3) >= NATIVE_RES)) {
      const ci = nativeCell;
      for (let di = a; di <= b; di++) {
        const date = u.dateOf(di);
        if (ci === undefined || di < 0 || di >= u.nDays) {
          out.push({ date, modis: null, viirs: null, index: null, availability: 'missing', anomaly: false, modisFrp: null, viirsFrp: null });
          continue;
        }
        const v = u.evaluate(ci, di);
        out.push({
          date,
          modis: v.modisOk ? v.modis : null,
          viirs: v.viirsOk ? v.viirs : null,
          index: Number.isNaN(v.combined) ? null : 1 - Math.exp(-v.combined / DAILY_INDEX_SCALE),
          availability: names[v.avail],
          anomaly: v.anomaly,
          modisFrp: v.modisOk ? Math.round(v.modisFrp * 10) / 10 : null,
          viirsFrp: v.viirsOk ? Math.round(v.viirsFrp * 10) / 10 : null,
        });
      }
    } else {
      const cells = this.cellsForTarget(target);
      for (let di = a; di <= b; di++) {
        const date = u.dateOf(di);
        if (!cells.length || di < 0 || di >= u.nDays) {
          out.push({ date, modis: null, viirs: null, index: null, availability: 'missing', anomaly: false, modisFrp: null, viirsFrp: null, activeCells: 0, coverage: 0 });
          continue;
        }
        let modis = 0, viirs = 0, combined = 0, obs = 0, cov = 0, active = 0, anomalies = 0, mf = 0, vf = 0;
        for (const ci of cells) {
          const v = u.evaluate(ci, di);
          modis += v.modis;
          viirs += v.viirs;
          mf += v.modisFrp;
          vf += v.viirsFrp;
          if (!Number.isNaN(v.combined)) {
            combined += v.combined;
            obs++;
            if (v.combined > 0) active++;
          }
          cov += v.avail === AVAIL_OBSERVED ? 1 : v.avail === AVAIL_PARTIAL ? 0.5 : 0;
          if (v.anomaly) anomalies++;
        }
        const coverage = cov / cells.length;
        out.push({
          date,
          modis: coverage > 0 ? modis : null,
          viirs: coverage > 0 ? viirs : null,
          index: obs ? 1 - Math.exp(-combined / (DAILY_INDEX_SCALE * Math.sqrt(obs))) : null,
          availability: availabilityFromCoverage(coverage),
          anomaly: anomalies >= Math.max(2, cells.length * 0.004),
          modisFrp: Math.round(mf),
          viirsFrp: Math.round(vf),
          activeCells: active,
          coverage,
        });
      }
    }
    this.seriesCache.set(key, out);
    if (this.seriesCache.size > 60) {
      const first = this.seriesCache.keys().next().value;
      if (first) this.seriesCache.delete(first);
    }
    return out;
  }

  /** Celdas nativas (res 6) que componen un objetivo: región, celda nativa o celda agregada. */
  private cellsForTarget(target: SeriesTarget): number[] {
    const u = this.u;
    if (target.kind === 'region') {
      const ri = u.regionIndexOf(target.regionId);
      return ri >= 0 ? u.regionCells[ri] : [];
    }
    const ci = u.cellIndex.get(target.h3);
    if (ci !== undefined) return [ci];
    if (!isValidCell(target.h3)) return [];
    const res = getResolution(target.h3);
    const out: number[] = [];
    u.cells.forEach((c, i) => {
      if ((res === 5 && c.parent5 === target.h3) || (res === 4 && c.parent4 === target.h3) || (res < 4 && cellToParent(c.h3, res) === target.h3)) out.push(i);
    });
    return out;
  }

  async getDetections(h3: string, date: ISODate): Promise<Detection[]> {
    const u = this.u;
    const ci = u.cellIndex.get(h3);
    const di = u.dayOffset(date);
    if (ci === undefined || di < 0) return [];
    const v = { ...u.evaluate(ci, di) };
    const cell = u.cells[ci];
    const def = u.regions[cell.region];
    const version = di <= u.nDays - 1 - 90 ? 'SP' : 'NRT';
    const out: Detection[] = [];
    const boundary = cellToBoundary(h3);
    const radiusLat = Math.max(...boundary.map(([lat]) => Math.abs(lat - cell.lat))) * 0.85;
    const radiusLng = Math.max(...boundary.map(([, lng]) => Math.abs(lng - cell.lng))) * 0.85;
    const viirsConf = splitConfidence(v.viirs, cell.hash ^ 0x3c6e, 0.12, 0.2);
    const modisConf = splitConfidence(v.modis, cell.hash ^ 0x5bd1, 0.15, 0.25);
    const make = (sensor: 'MODIS' | 'VIIRS', i: number, confClass: number) => {
      const seed = mix(cell.hash, di * 131 + i * 7 + (sensor === 'MODIS' ? 50_000 : 0));
      const night = u01(seed, 1) < 0.32;
      let satellite: Satellite;
      let localHour: number;
      if (sensor === 'VIIRS') {
        const r = u01(seed, 2);
        satellite = r < 0.34 ? 'Suomi NPP' : r < 0.67 ? 'NOAA-20' : 'NOAA-21';
        localHour = night ? 1.5 : 13.5;
      } else {
        satellite = u01(seed, 2) < 0.5 ? 'Terra' : 'Aqua';
        localHour = satellite === 'Terra' ? (night ? 22.5 : 10.5) : night ? 1.5 : 13.5;
      }
      let utcHour = localHour - def.utcOffset + (u01(seed, 3) - 0.5) * 1.2;
      if (utcHour < 0 || utcHour >= 24) utcHour = ((localHour + 12) % 24) - def.utcOffset;
      utcHour = ((utcHour % 24) + 24) % 24;
      const hh = Math.floor(utcHour);
      const mm = Math.floor((utcHour - hh) * 60);
      const lat = cell.lat + (u01(seed, 4) * 2 - 1) * radiusLat;
      const lng = cell.lng + (u01(seed, 5) * 2 - 1) * radiusLng;
      const frpBase = sensor === 'VIIRS' ? 4.5 : 18;
      const frp = Math.round(Math.exp(Math.log(frpBase) + 0.95 * normal(seed, 6)) * 10) / 10;
      const confidence: Detection['confidence'] =
        sensor === 'VIIRS'
          ? (['l', 'n', 'h'] as const)[confClass]
          : confClass === 0 ? 10 + Math.floor(u01(seed, 7) * 20) : confClass === 1 ? 30 + Math.floor(u01(seed, 7) * 50) : 80 + Math.floor(u01(seed, 7) * 21);
      out.push({
        h3_id: h3,
        date_utc: `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
        sensor,
        satellite,
        frp: Math.max(0.3, frp),
        confidence,
        latitude: Math.round(lat * 1e5) / 1e5,
        longitude: Math.round(lng * 1e5) / 1e5,
        version,
        product: sensor === 'VIIRS' ? 'VIIRS 375 m' : 'MODIS C6.1',
        daynight: night ? 'N' : 'D',
      });
    };
    const classOf = (split: [number, number, number], i: number) => (i < split[0] ? 0 : i < split[0] + split[1] ? 1 : 2);
    if (v.viirsOk) for (let i = 0; i < v.viirs; i++) make('VIIRS', i, classOf(viirsConf, i));
    if (v.modisOk) for (let i = 0; i < v.modis; i++) make('MODIS', i, classOf(modisConf, i));
    return out.sort((x, y) => x.date_utc.localeCompare(y.date_utc));
  }

  /** Probabilidad para todas las celdas (pronóstico del día di+1). */
  private predictAll(di: number): Float32Array {
    const cached = this.predictionCache.get(di);
    if (cached) return cached;
    const u = this.u;
    const n = u.cells.length;
    const recent7 = new Float32Array(n);
    for (let k = 0; k < 7; k++) {
      const d = di - k;
      if (d < 0) break;
      const c = u.day(d).combined;
      for (let ci = 0; ci < n; ci++) if (!Number.isNaN(c[ci])) recent7[ci] += c[ci];
    }
    const out = new Float32Array(n);
    for (let ci = 0; ci < n; ci++) out[ci] = probabilityOf(featureVector(u, ci, di, (i) => recent7[i]));
    this.predictionCache.set(di, out);
    if (this.predictionCache.size > 40) {
      const first = this.predictionCache.keys().next().value;
      if (first !== undefined) this.predictionCache.delete(first);
    }
    return out;
  }

  async getPredictions(date: ISODate, regionIds?: string[]): Promise<Prediction[]> {
    const u = this.u;
    const di = u.dayOffset(date);
    if (di < 0) return [];
    const probs = this.predictAll(di);
    const regionIdx = regionIds?.length ? regionIds.map((id) => u.regionIndexOf(id)) : u.regions.map((_, i) => i);
    const forecast = addDays(date, 1);
    return regionIdx.flatMap((ri) =>
      ri < 0 ? [] : u.regionCells[ri].map((ci) => ({
        h3_id: u.cells[ci].h3,
        forecast_date: forecast,
        issued_for_date: date,
        probability: Math.round(probs[ci] * 1000) / 1000,
        model_version: MOCK_MODEL_VERSION,
      })),
    );
  }

  async getPredictionDetail(target: SeriesTarget, date: ISODate): Promise<PredictionDetail> {
    const u = this.u;
    const di = u.dayOffset(date);
    const base = { target, issuedForDate: date, forecastDate: addDays(date, 1), modelVersion: MOCK_MODEL_VERSION };
    if (di < 0) return { ...base, probability: null, features: [] };
    const probs = this.predictAll(di);
    const recent7Of = (ci: number) => sumCombined(u, ci, di, 7);
    if (target.kind === 'cell') {
      const ci = u.cellIndex.get(target.h3);
      if (ci !== undefined) {
        const f = featureVector(u, ci, di, recent7Of);
        return { ...base, probability: probs[ci], features: featuresToList(f) };
      }
    }
    const cells = this.cellsForTarget(target);
    if (!cells.length) return { ...base, probability: null, features: [] };
    const distribution = new Array(10).fill(0);
    let sum = 0;
    let max = 0;
    const ranked: { h3: string; probability: number }[] = [];
    for (const ci of cells) {
      const p = probs[ci];
      sum += p;
      max = Math.max(max, p);
      distribution[Math.min(9, Math.floor(p * 10))]++;
      ranked.push({ h3: u.cells[ci].h3, probability: p });
    }
    ranked.sort((a, b) => b.probability - a.probability);
    // Variables medias de la región (sobre una muestra estable de celdas).
    const sample = cells.filter((_, i) => i % Math.max(1, Math.floor(cells.length / 60)) === 0);
    const mean: FeatureVector = { recent7: 0, recent30: 0, neighbors7: 0, rain7: 0, tempAnomaly: 0, seasonPrior: 0, month: 1 };
    for (const ci of sample) {
      const f = featureVector(u, ci, di, recent7Of);
      mean.recent7 += f.recent7 / sample.length;
      mean.recent30 += f.recent30 / sample.length;
      mean.neighbors7 += f.neighbors7 / sample.length;
      mean.rain7 = f.rain7;
      mean.tempAnomaly = f.tempAnomaly;
      mean.seasonPrior = f.seasonPrior;
      mean.month = f.month;
    }
    return {
      ...base,
      probability: max,
      meanProbability: cells.length ? sum / cells.length : 0,
      features: featuresToList(mean),
      distribution,
      topCells: ranked.slice(0, 6),
    };
  }

  async getModelInfo(): Promise<ModelInfo> {
    const empty = { precision: null, recall: null, f1: null, prAuc: null, brier: null };
    return {
      model_version: MOCK_MODEL_VERSION,
      status: 'demo',
      algorithm: 'Regresión logística (coeficientes simulados para la demo)',
      target: 'Y = 1 si hay actividad térmica DETECTADA en la celda al día siguiente (no ignición real)',
      trainingPeriod: '2018 – 2023 (previsto)',
      validationPeriod: '2024 (previsto)',
      testPeriod: '2025 (previsto)',
      metrics: empty,
      baselineMetrics: empty,
      features: [
        { key: 'recent_activity_7d', label: 'Actividad 7 días', description: 'Disponible al cierre del día t.' },
        { key: 'recent_activity_30d', label: 'Actividad 30 días', description: 'Disponible al cierre del día t.' },
        { key: 'neighbors_7d', label: 'Vecinos H3', description: 'Anillo 1 de la celda.' },
        { key: 'rain_7d', label: 'Lluvia 7 días', description: 'NASA POWER (grilla más gruesa).' },
        { key: 'temp_7d_anomaly', label: 'Temperatura 7 días', description: 'NASA POWER T2M.' },
        { key: 'season_prior', label: 'Mes / estación', description: 'Prior estacional.' },
      ],
      notes: [
        'Las métricas se completarán con la evaluación cronológica (sin fugas de futuro).',
        'Se compararán contra un baseline estacional: precision, recall, F1, PR-AUC y calibración.',
      ],
    };
  }

  async getMetadata(): Promise<DatasetMetadata> {
    return {
      source: 'mock',
      generator: GENERATOR_VERSION,
      dateRange: { start: DATA_START, end: DATA_END },
      products: [
        { sensor: 'MODIS', product: 'MODIS C6.1 (Terra/Aqua)', resolutionMeters: 1000, satellites: ['Terra', 'Aqua'] },
        { sensor: 'VIIRS', product: 'VIIRS 375 m (I-band)', resolutionMeters: 375, satellites: ['Suomi NPP', 'NOAA-20', 'NOAA-21'] },
      ],
      harmonization: {
        method: 'Índice VIIRS-equivalente: 0.65·VIIRS + 0.35·MODIS·k cuando ambos observan; un solo sensor cuando el otro falta.',
        modisCalibrationFactor: MODIS_CALIBRATION,
        notes: 'El factor k es ilustrativo; el valor real saldrá de la calibración en años y zonas de solapamiento.',
      },
      h3: { resolution: NATIVE_RES, meanAreaKm2: 36.13, aggregateResolutions: [4, 5] },
      disclaimer:
        'Datos de demostración generados de forma determinista. No representan detecciones reales de NASA FIRMS.',
    };
  }

  async getWeather(regionId: string, from: ISODate, to: ISODate): Promise<WeatherDaily[]> {
    const u = this.u;
    const ri = u.regionIndexOf(regionId);
    if (ri < 0) return [];
    const s = u.regionSeries(ri);
    const out: WeatherDaily[] = [];
    for (let di = dayIndexFromISO(from) - u.startIdx; di <= dayIndexFromISO(to) - u.startIdx; di++) {
      if (di < 0 || di >= u.nDays) continue;
      out.push({
        date: u.dateOf(di),
        temperature: Math.round(s.temp[di] * 10) / 10,
        precipitation: Math.round(s.precip[di] * 10) / 10,
        humidity: Math.round(s.humidity[di]),
        wind: Math.round(s.wind[di] * 10) / 10,
      });
    }
    return out;
  }

  async getCellInfo(h3: string): Promise<CellInfo | null> {
    if (!isValidCell(h3)) return null;
    const u = this.u;
    const res = getResolution(h3);
    const ci = u.cellIndex.get(h3);
    const [lat, lng] = cellToLatLng(h3);
    let regionId = ci !== undefined ? u.regions[u.cells[ci].region].id : '';
    if (!regionId) {
      const child = u.cells.find((c) => (res === 5 ? c.parent5 : res === 4 ? c.parent4 : '') === h3);
      regionId = child ? u.regions[child.region].id : '';
    }
    const parents = [5, 4, 3].filter((r) => r < res).map((r) => ({ resolution: r, h3_id: cellToParent(h3, r) }));
    return {
      h3_id: h3,
      regionId,
      resolution: res,
      center: { lat, lng },
      areaKm2: u.cellAreaKm2(h3),
      parents,
      neighbors: gridDisk(h3, 1).filter((n) => n !== h3),
      boundary: cellToBoundary(h3, true) as [number, number][],
    };
  }

  async getNews(): Promise<[]> {
    return [];
  }
}

export function createMockService(): DataService {
  return new MockDataService();
}

export { AVAIL_MISSING };
