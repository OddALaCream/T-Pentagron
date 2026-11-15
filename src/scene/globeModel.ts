/**
 * Transformaciones puras de datos → objetos dibujables en el globo.
 * Estrategia por nivel de zoom: res 4 (lejos), res 5 (medio), res 6 (cerca), con
 * marcadores agregados a la resolución H3 más fina que no se solape en pantalla.
 */
import { cellToLatLng, cellToParent } from 'h3-js';
import { brand } from '@/config/brand';
import { env } from '@/config/env';
import { insideBolivia } from '@/lib/geo/bolivia';
import { aggregateRecords, DAILY_INDEX_SCALE, MONTHLY_INDEX_SCALE } from '@/lib/geo/aggregate';
import { cellPolygon, type H3Polygon } from '@/lib/geo/h3';
import { classify, type Classification, type VisualKind } from '@/lib/science/categories';
import type { CellActivity, DataLayer, Granularity } from '@/lib/types/domain';
import type { Filters, Selection } from '@/state/store';
import type { CapState, SymbolDatum } from './dataLayers';

export interface PolygonFeature {
  id: string;
  h3: string;
  res: number;
  regionId: string;
  geometry: H3Polygon;
  record: CellActivity;
  cls: Classification;
  state: CapState;
  faint: boolean;
  __id?: string;
}

/** Altitud base y extrusión máxima por resolución (radios terrestres). */
export const POLY_ALT: Record<number, { base: number; ext: number }> = {
  4: { base: 0.003, ext: 0.016 },
  5: { base: 0.0025, ext: 0.009 },
  6: { base: 0.0016, ext: 0.0008 },
};

export const SYMBOL_ALT: Record<number, number> = { 4: 0.024, 5: 0.014, 6: 0.009 };

/** Longitud media de arista H3 (km) por resolución. */
const EDGE_KM: Record<number, number> = { 0: 1281, 1: 483, 2: 182.5, 3: 68.97, 4: 26.07, 5: 9.85, 6: 3.72 };

export function displayResolution(altitude: number, previous: number, t: { res6: number; res5: number }): number {
  const h = 0.08; // histéresis
  if (previous === 6) return altitude > t.res6 * (1 + h) ? (altitude > t.res5 ? 4 : 5) : 6;
  if (previous === 5) {
    if (altitude < t.res6 * (1 - h)) return 6;
    if (altitude > t.res5 * (1 + h)) return 4;
    return 5;
  }
  return altitude < t.res5 * (1 - h) ? (altitude < t.res6 ? 6 : 5) : 4;
}

/** Resolución de marcadores: la más fina cuyo ancho en pantalla supera `minPx`. */
export function symbolResolution(altitude: number, viewportHeight: number, minPx = 18): number {
  const pxPerKm = viewportHeight / (5941 * Math.max(0.01, altitude));
  for (let r = 6; r >= 1; r--) {
    if (EDGE_KM[r] * 2 * pxPerKm >= minPx) return r;
  }
  return 1;
}

export function recordsAtResolution(native: CellActivity[], res: number, granularity: Granularity): CellActivity[] {
  if (res >= 6) return native;
  return aggregateRecords(native, res, granularity === 'month' ? MONTHLY_INDEX_SCALE : DAILY_INDEX_SCALE);
}

const SEVERITY: Record<VisualKind, number> = { none: 0, unavailable: 0, low: 2, medium: 3, high: 4, forecast: 1, anomaly: 0 };

function passesFilters(cls: Classification, filters: Filters): boolean {
  if (filters.onlyAnomalies && !cls.anomaly) return false;
  if (!filters.kinds[cls.kind]) return cls.anomaly && filters.kinds.anomaly && cls.kind !== 'unavailable';
  return true;
}

export interface PolygonBuildParams {
  layer: DataLayer;
  granularity: Granularity;
  filters: Filters;
  res: number;
  visibleRegions: Set<string> | null;
  selection: Selection;
  hover: string | null;
  maxPolygons?: number;
}

export function buildPolygons(records: CellActivity[], p: PolygonBuildParams, cache: Map<string, PolygonFeature>): PolygonFeature[] {
  const out: PolygonFeature[] = [];
  const unavailable: PolygonFeature[] = [];
  const selectedH3 = p.selection?.kind === 'cell' ? p.selection.h3 : null;
  const selectedRegion = p.selection?.kind === 'region' ? p.selection.regionId : null;
  for (const record of records) {
    if (p.visibleRegions && !p.visibleRegions.has(record.regionId)) continue;
    if (p.filters.regionScope === 'pilot' && record.regionId !== brand.pilot.regionId) continue;
    const cls = classify(record, p.layer, p.granularity);
    const isSelected = record.h3_id === selectedH3;
    if (!isSelected) {
      // "Sin detección" no genera polígonos: la retícula H3 (una sola llamada de dibujo)
      // ya muestra la huella observada. Así se ahorran cientos de llamadas por fotograma.
      if (cls.kind === 'none') continue;
      if (!passesFilters(cls, p.filters)) continue;
    }
    let f = cache.get(record.h3_id);
    if (!f) {
      f = {
        id: record.h3_id, h3: record.h3_id, res: record.resolution, regionId: record.regionId,
        geometry: cellPolygon(record.h3_id), record, cls, state: 'normal', faint: false,
      };
      cache.set(record.h3_id, f);
    }
    f.record = record;
    f.cls = cls;
    f.state = isSelected ? 'selected' : record.h3_id === p.hover ? 'hover' : 'normal';
    f.faint = Boolean(selectedRegion && record.regionId !== selectedRegion);
    if (cls.kind === 'unavailable' && !isSelected) unavailable.push(f);
    else out.push(f);
  }
  const budget = (p.maxPolygons ?? 1400) - out.length;
  if (budget > 0) out.push(...unavailable.slice(0, budget));
  return out;
}

export interface SymbolBuildParams {
  layer: DataLayer;
  granularity: Granularity;
  filters: Filters;
  symbolRes: number;
  displayRes: number;
}

/** Marcadores agregados: categoría más severa de las celdas hijas + capa de anomalías. */
export function buildSymbols(native: CellActivity[], p: SymbolBuildParams): SymbolDatum[] {
  interface Group { kind: VisualKind; intensity: number; anomaly: boolean; children: number; unavailable: number; anchor: { lat: number; lng: number } }
  const groups = new Map<string, Group>();
  for (const r of native) {
    if (p.filters.regionScope === 'pilot' && r.regionId !== brand.pilot.regionId) continue;
    const cls = classify(r, p.layer, p.granularity);
    const key = p.symbolRes >= 6 ? r.h3_id : cellToParent(r.h3_id, p.symbolRes);
    let g = groups.get(key);
    if (!g) {
      g = { kind: 'none', intensity: 0, anomaly: false, children: 0, unavailable: 0, anchor: r.center };
      groups.set(key, g);
    }
    g.children++;
    if (cls.kind === 'unavailable') {
      g.unavailable++;
      continue;
    }
    if (cls.anomaly) g.anomaly = true;
    if (p.filters.onlyAnomalies && !cls.anomaly) continue;
    if (!p.filters.kinds[cls.kind]) continue;
    if (SEVERITY[cls.kind] > SEVERITY[g.kind] || (cls.kind === g.kind && cls.intensity > g.intensity)) {
      g.kind = cls.kind;
      g.intensity = Math.max(g.intensity, cls.intensity);
    }
  }
  const alt = SYMBOL_ALT[p.displayRes] ?? 0.012;
  const out: SymbolDatum[] = [];
  for (const [key, g] of groups) {
    const [centerLat, centerLng] = cellToLatLng(key);
    const { lat, lng } = env.dataMode === 'api' && !insideBolivia(centerLat, centerLng) ? g.anchor : { lat: centerLat, lng: centerLng };
    if (g.kind !== 'none') out.push({ lat, lng, altitude: alt, kind: g.kind, intensity: g.intensity });
    else if (p.layer !== 'prediction' && g.unavailable / g.children > 0.6 && p.filters.kinds.unavailable && !p.filters.onlyAnomalies)
      out.push({ lat, lng, altitude: alt, kind: 'unavailable', intensity: 0.3 });
    if (g.anomaly && p.filters.kinds.anomaly && p.layer !== 'prediction')
      out.push({ lat, lng, altitude: alt + 0.0005, kind: 'anomaly', intensity: 0.8 });
  }
  return out;
}

export interface RegionGlance {
  worst: VisualKind;
  active: number;
  anomalies: number;
  unavailableShare: number;
  value: number;
}

export function regionGlances(native: CellActivity[], layer: DataLayer, granularity: Granularity): Record<string, RegionGlance> {
  const out: Record<string, RegionGlance & { n: number; unavailable: number }> = {};
  for (const r of native) {
    const g = (out[r.regionId] ??= { worst: 'none', active: 0, anomalies: 0, unavailableShare: 0, value: 0, n: 0, unavailable: 0 });
    const cls = classify(r, layer, granularity);
    g.n++;
    if (cls.kind === 'unavailable') g.unavailable++;
    if (cls.kind !== 'none' && cls.kind !== 'unavailable') g.active++;
    if (cls.anomaly) g.anomalies++;
    if (SEVERITY[cls.kind] > SEVERITY[g.worst]) g.worst = cls.kind;
    if (layer === 'modis') g.value += r.modis_detected ?? 0;
    else if (layer === 'viirs') g.value += r.viirs_detected ?? 0;
    else if (layer === 'prediction') g.value = Math.max(g.value, r.probability ?? 0);
    else g.value += r.activity_index ?? 0;
  }
  for (const g of Object.values(out)) {
    g.unavailableShare = g.n ? g.unavailable / g.n : 0;
    if (g.worst === 'none' && g.unavailableShare > 0.6) g.worst = 'unavailable';
  }
  return out;
}

export function polygonAltitude(f: PolygonFeature): number {
  const a = POLY_ALT[f.res] ?? POLY_ALT[6];
  const intensity = f.cls.kind === 'unavailable' || f.cls.kind === 'none' ? 0 : f.cls.intensity;
  return a.base + intensity * a.ext + (f.state === 'selected' ? a.ext * 0.35 + 0.001 : 0);
}
