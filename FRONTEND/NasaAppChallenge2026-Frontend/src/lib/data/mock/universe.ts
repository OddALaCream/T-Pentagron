/**
 * Universo de datos de DEMOSTRACIÓN.
 *
 * Construye celdas H3 auténticas (h3-js) para cada región y un modelo procedural
 * determinista de actividad térmica diaria por celda:
 *
 *   λ_VIIRS = base · estación(doy) · año · episodio(t) · sequedad(lluvia 7d) · susceptibilidad(celda) · quema(celda, t)
 *   VIIRS ~ Poisson(λ_VIIRS)          MODIS ~ Poisson(λ_VIIRS · ratio_región)
 *
 * Incluye nubosidad (observación faltante), cobertura parcial de un solo sensor,
 * discrepancias entre sensores y anomalías respecto a la climatología.
 * Nada de esto son datos oficiales: es un sustituto coherente hasta conectar FastAPI.
 */
import { cellArea, cellToLatLng, cellToParent, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import { dayIndexFromISO, dayOfYear, isoFromDayIndex, type ISODate } from '@/lib/time/dates';
import { clamp, fbm1D, fbm2D, hashString, noise1D, poisson, u01 } from './random';
import { REGION_DEFS, type RegionDef } from './regions';

export const DATA_START: ISODate = '2023-01-01';
export const DATA_END: ISODate = '2026-11-13';
export const NATIVE_RES = 6;
export const AGGREGATE_RESOLUTIONS = [4, 5] as const;
/** Factor de calibración MODIS→VIIRS-equivalente usado por la armonización de demo. */
export const MODIS_CALIBRATION = 3.1;
export const GENERATOR_VERSION = 'mock-generator 1.0 · semilla 2026';
const VIIRS_RATE = 1.25;
const INDEX_SCALE = 5;

export const AVAIL_OBSERVED = 0;
export const AVAIL_PARTIAL = 1;
export const AVAIL_MISSING = 2;

export interface MockCell {
  h3: string;
  region: number;
  lat: number;
  lng: number;
  hash: number;
  /** Susceptibilidad espacial 0..~1.6 */
  sp: number;
  parent5: string;
  parent4: string;
}

/** Valores de una celda/día (estructura reutilizable para no asignar memoria). */
export interface DayValues {
  modis: number;
  viirs: number;
  modisOk: boolean;
  viirsOk: boolean;
  avail: number;
  combined: number; // VIIRS-equivalente; NaN si no hay observación
  anomaly: boolean;
  score: number;
  modisFrp: number;
  viirsFrp: number;
}

/** Caché por día con los valores de todas las celdas. */
export interface DayBlock {
  di: number;
  modis: Int16Array;
  viirs: Int16Array;
  avail: Uint8Array;
  /** bit0 = MODIS válido, bit1 = VIIRS válido */
  sensors: Uint8Array;
  combined: Float32Array;
  anomaly: Uint8Array;
  score: Float32Array;
  modisFrp: Float32Array;
  viirsFrp: Float32Array;
}

interface RegionSeries {
  rd: Float32Array; // factor diario total
  clim: Float32Array; // climatología (sin año ni episodio)
  cloud: Float32Array;
  temp: Float32Array;
  precip: Float32Array;
  humidity: Float32Array;
  wind: Float32Array;
  rain7: Float32Array;
  temp7: Float32Array;
  tempClim: Float32Array;
  season: Float32Array;
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 365.25;
  return Math.min(d, 365.25 - d);
}

export function seasonFactor(def: RegionDef, doy: number): number {
  let s = 0;
  for (const p of def.peaks) {
    const d = circularDistance(doy, p.doy) / p.width;
    s = Math.max(s, p.weight * Math.exp(-0.5 * d * d));
  }
  return 0.035 + s;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export class MockUniverse {
  readonly regions = REGION_DEFS;
  readonly cells: MockCell[] = [];
  readonly cellIndex = new Map<string, number>();
  readonly regionCells: number[][] = [];
  readonly startIdx = dayIndexFromISO(DATA_START);
  readonly endIdx = dayIndexFromISO(DATA_END);
  readonly nDays = this.endIdx - this.startIdx + 1;
  private readonly series: RegionSeries[] = [];
  private readonly dayCache = new Map<number, DayBlock>();
  private readonly dayCacheLimit = 120;
  private readonly neighborCache = new Map<number, Int32Array>();
  private readonly scratch: DayValues = {
    modis: 0, viirs: 0, modisOk: true, viirsOk: true, avail: 0, combined: 0,
    anomaly: false, score: 0, modisFrp: 0, viirsFrp: 0,
  };

  constructor() {
    this.build();
  }

  private build() {
    this.regions.forEach((def, regionIndex) => {
      const ids = this.buildRegionCells(def);
      const list: number[] = [];
      for (const h3 of ids) {
        if (this.cellIndex.has(h3)) continue;
        const [lat, lng] = cellToLatLng(h3);
        const hash = hashString(h3);
        const index = this.cells.length;
        this.cells.push({
          h3,
          region: regionIndex,
          lat,
          lng,
          hash,
          sp: this.spatialFactor(def, lat, lng),
          parent5: cellToParent(h3, 5),
          parent4: cellToParent(h3, 4),
        });
        this.cellIndex.set(h3, index);
        list.push(index);
      }
      this.regionCells.push(list);
      this.series.push(this.buildRegionSeries(def));
    });
  }

  private buildRegionCells(def: RegionDef): string[] {
    if (def.aoi) {
      // polygonToCells espera [lat, lng] salvo que se indique formato GeoJSON.
      return polygonToCells([def.aoi.map(([lng, lat]) => [lat, lng])], NATIVE_RES);
    }
    const set = new Set<string>();
    for (const spot of def.hotspots) {
      const origin = latLngToCell(spot.lat, spot.lng, NATIVE_RES);
      for (const h of gridDisk(origin, spot.k)) set.add(h);
    }
    return [...set];
  }

  private spatialFactor(def: RegionDef, lat: number, lng: number): number {
    const n = fbm2D(def.seed * 7 + 3, lat * 1.9 + 100, lng * 1.9 + 300);
    let proximity = 0;
    for (const spot of def.hotspots) {
      const d = haversineKm(lat, lng, spot.lat, spot.lng);
      proximity = Math.max(proximity, Math.exp(-((d / (def.isPilot ? 55 : 30)) ** 2)));
    }
    const shaped = Math.pow(clamp((n - 0.22) / 0.56, 0, 1), 1.8);
    return 0.06 + 1.15 * shaped + 0.45 * proximity * (0.4 + shaped);
  }

  private buildRegionSeries(def: RegionDef): RegionSeries {
    const n = this.nDays;
    const s: RegionSeries = {
      rd: new Float32Array(n), clim: new Float32Array(n), cloud: new Float32Array(n),
      temp: new Float32Array(n), precip: new Float32Array(n), humidity: new Float32Array(n),
      wind: new Float32Array(n), rain7: new Float32Array(n), temp7: new Float32Array(n),
      tempClim: new Float32Array(n), season: new Float32Array(n),
    };
    const seed = def.seed;
    let episodeSum = 0;
    const episodes = new Float32Array(n);
    for (let di = 0; di < n; di++) {
      const dayIdx = this.startIdx + di;
      const doy = dayOfYear(dayIdx);
      const wet = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * (doy - def.clouds.doy)) / 365.25), 2);
      const cloud = def.clouds.base + def.clouds.amplitude * wet * (0.55 + 0.9 * noise1D(seed + 5, di / 3.2));
      s.cloud[di] = clamp(cloud, 0, 0.92);
      const tClim = def.climate.tMean + def.climate.tAmp * Math.cos((2 * Math.PI * (doy - def.climate.tPeakDoy)) / 365.25);
      s.tempClim[di] = tClim;
      s.temp[di] = tClim + 4 * (fbm1D(seed + 7, di / 4.5) - 0.5);
      const rainy = u01(seed, di, 31) < 0.08 + 0.62 * wet;
      s.precip[di] = rainy ? -Math.log(Math.max(1e-6, u01(seed, di, 32))) * (1.5 + 15 * wet) : 0;
      s.humidity[di] = clamp(28 + 58 * wet + 14 * (noise1D(seed + 11, di / 2.7) - 0.5), 8, 100);
      s.wind[di] = 1.2 + 4.2 * fbm1D(seed + 9, di / 2.5);
      const e = 0.3 + 1.6 * Math.pow(fbm1D(seed + 13, di / 7.5), 1.6);
      episodes[di] = e;
      episodeSum += e;
      s.season[di] = seasonFactor(def, doy);
    }
    const meanEpisode = episodeSum / n;
    const yearValues = Object.values(def.years);
    const meanYear = yearValues.reduce((a, b) => a + b, 0) / yearValues.length;
    for (let di = 0; di < n; di++) {
      let rain = 0;
      let temp = 0;
      let count = 0;
      for (let k = 0; k < 7 && di - k >= 0; k++) {
        rain += s.precip[di - k];
        temp += s.temp[di - k];
        count++;
      }
      s.rain7[di] = rain;
      s.temp7[di] = temp / count;
      const dryness = clamp(1.3 - rain / 30, 0.3, 1.3);
      const year = new Date((this.startIdx + di) * 86_400_000).getUTCFullYear();
      const yearFactor = def.years[year] ?? 1;
      s.rd[di] = def.base * s.season[di] * yearFactor * episodes[di] * dryness;
      s.clim[di] = def.base * s.season[di] * meanYear * meanEpisode * 0.95;
    }
    return s;
  }

  /** Índice interno de día (0..nDays-1) o -1 si queda fuera del rango de datos. */
  dayOffset(iso: ISODate): number {
    const di = dayIndexFromISO(iso) - this.startIdx;
    return di >= 0 && di < this.nDays ? di : -1;
  }

  dateOf(di: number): ISODate {
    return isoFromDayIndex(this.startIdx + di);
  }

  regionIndexOf(id: string): number {
    return this.regions.findIndex((r) => r.id === id);
  }

  regionSeries(regionIndex: number): RegionSeries {
    return this.series[regionIndex];
  }

  /** Evalúa una celda en un día. Devuelve una estructura compartida (copiar si se guarda). */
  evaluate(ci: number, di: number): DayValues {
    const out = this.scratch;
    const cell = this.cells[ci];
    if (di < 0 || di >= this.nDays) {
      out.modis = 0; out.viirs = 0; out.modisOk = false; out.viirsOk = false;
      out.avail = AVAIL_MISSING; out.combined = NaN; out.anomaly = false; out.score = 0;
      out.modisFrp = 0; out.viirsFrp = 0;
      return out;
    }
    const def = this.regions[cell.region];
    const series = this.series[cell.region];
    const rd = series.rd[di];
    const sp = cell.sp;
    const h = cell.hash;

    // Episodios de quema de varios días por celda (continuidad temporal).
    const blockLen = 6;
    const shifted = di + (h % blockLen);
    const block = Math.floor(shifted / blockLen);
    const pBurn = clamp(rd * sp * 0.13, 0, 0.6);
    let burn = 0.025;
    if (u01(h, block, 3) < pBurn) {
      const start = Math.floor(u01(h, block, 4) * 3);
      const duration = 2 + Math.floor(u01(h, block, 5) * 4);
      const pos = shifted - block * blockLen;
      if (pos >= start && pos < start + duration) burn = 4.2 + 3.5 * u01(h, block, 6);
    }
    const lambdaV = VIIRS_RATE * rd * sp * burn;

    // Disponibilidad de observación (nubes, huecos de cobertura).
    let modisOk = true;
    let viirsOk = true;
    let avail = AVAIL_OBSERVED;
    if (u01(h, di, 11) < series.cloud[di] * 0.82) {
      modisOk = false;
      viirsOk = false;
      avail = AVAIL_MISSING;
    } else {
      const ub = u01(h, di, 12);
      if (ub < 0.05) {
        modisOk = false;
        avail = AVAIL_PARTIAL;
      } else if (ub < 0.075) {
        viirsOk = false;
        avail = AVAIL_PARTIAL;
      }
    }

    const viirs = poisson(lambdaV, u01(h, di, 21));
    // MODIS (píxel de ~1 km) omite con más frecuencia los focos pequeños.
    const lambdaM = lambdaV * def.modisRatio * (viirs <= 1 ? 0.5 : 1);
    const modis = poisson(lambdaM, u01(h, di, 22));

    let combined = NaN;
    if (modisOk && viirsOk) combined = 0.65 * viirs + 0.35 * modis * MODIS_CALIBRATION;
    else if (viirsOk) combined = viirs;
    else if (modisOk) combined = modis * MODIS_CALIBRATION;

    // Anomalía histórica: actividad muy superior a la de un episodio típico de quema para
    // esa celda y época (climatología), no simplemente "hay fuego en temporada".
    const climRd = series.clim[di];
    const typicalBurn = VIIRS_RATE * climRd * sp * 5.95;
    let score = 0;
    let anomaly = false;
    if (!Number.isNaN(combined)) {
      score = (combined - typicalBurn) / Math.sqrt(typicalBurn + 1);
      anomaly = combined >= 6 && combined > typicalBurn * 2.4 && score > 3;
    }

    out.modis = modisOk ? modis : 0;
    out.viirs = viirsOk ? viirs : 0;
    out.modisOk = modisOk;
    out.viirsOk = viirsOk;
    out.avail = avail;
    out.combined = combined;
    out.anomaly = anomaly;
    out.score = score;
    out.viirsFrp = viirsOk ? viirs * 5.5 * (0.55 + u01(h, di, 41)) * (0.8 + rd * 0.4) : 0;
    out.modisFrp = modisOk ? modis * 24 * (0.55 + u01(h, di, 42)) * (0.8 + rd * 0.4) : 0;
    return out;
  }

  /** Valores de todas las celdas para un día (con caché LRU). */
  day(di: number): DayBlock {
    const cached = this.dayCache.get(di);
    if (cached) {
      this.dayCache.delete(di);
      this.dayCache.set(di, cached);
      return cached;
    }
    const n = this.cells.length;
    const block: DayBlock = {
      di,
      modis: new Int16Array(n), viirs: new Int16Array(n), avail: new Uint8Array(n),
      sensors: new Uint8Array(n), combined: new Float32Array(n), anomaly: new Uint8Array(n),
      score: new Float32Array(n), modisFrp: new Float32Array(n), viirsFrp: new Float32Array(n),
    };
    for (let ci = 0; ci < n; ci++) {
      const v = this.evaluate(ci, di);
      block.modis[ci] = v.modis;
      block.viirs[ci] = v.viirs;
      block.avail[ci] = v.avail;
      block.sensors[ci] = (v.modisOk ? 1 : 0) | (v.viirsOk ? 2 : 0);
      block.combined[ci] = v.combined;
      block.anomaly[ci] = v.anomaly ? 1 : 0;
      block.score[ci] = v.score;
      block.modisFrp[ci] = v.modisFrp;
      block.viirsFrp[ci] = v.viirsFrp;
    }
    this.dayCache.set(di, block);
    if (this.dayCache.size > this.dayCacheLimit) {
      const oldest = this.dayCache.keys().next().value;
      if (oldest !== undefined) this.dayCache.delete(oldest);
    }
    return block;
  }

  /** Índices de celdas vecinas (anillo 1) presentes en el universo. */
  neighbors(ci: number): Int32Array {
    const cached = this.neighborCache.get(ci);
    if (cached) return cached;
    const list: number[] = [];
    for (const h of gridDisk(this.cells[ci].h3, 1)) {
      const idx = this.cellIndex.get(h);
      if (idx !== undefined && idx !== ci) list.push(idx);
    }
    const arr = Int32Array.from(list);
    this.neighborCache.set(ci, arr);
    return arr;
  }

  cellAreaKm2(h3: string): number {
    return cellArea(h3, 'km2');
  }
}

export function indexFromCombined(combined: number, scale = INDEX_SCALE): number | null {
  if (Number.isNaN(combined)) return null;
  return 1 - Math.exp(-combined / scale);
}

export const HARMONIZED_INDEX_SCALE = INDEX_SCALE;

let universe: MockUniverse | null = null;

/** Singleton perezoso (se construye en el primer acceso, ~50 ms). */
export function getUniverse(): MockUniverse {
  if (!universe) universe = new MockUniverse();
  return universe;
}
