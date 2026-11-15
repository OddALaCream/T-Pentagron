/**
 * Agregación espacial H3 (res 6 → res 5/4) compartida por el modo mock y el modo API,
 * para que ambas fuentes produzcan exactamente la misma semántica en el globo.
 */
import { cellToLatLng, cellToParent } from 'h3-js';
import { env } from '@/config/env';
import { insideBolivia } from './bolivia';
import type { ActivityTotals, AvailabilityFlag, CellActivity } from '@/lib/types/domain';

/** Escala del índice armonizado (VIIRS-equivalente) para un día y una celda res 6. */
export const DAILY_INDEX_SCALE = 5;
/** Escala para agregados mensuales (≈ 6 días activos saturan el índice). */
export const MONTHLY_INDEX_SCALE = 30;

export function combinedFromIndex(index: number | null, scale: number): number {
  if (index === null || index <= 0) return 0;
  return -scale * Math.log(Math.max(1e-6, 1 - Math.min(index, 0.999999)));
}

export function indexFromCombinedSum(sum: number, scale: number, n = 1): number {
  return 1 - Math.exp(-sum / (scale * Math.sqrt(Math.max(1, n))));
}

export function availabilityFromCoverage(coverage: number): AvailabilityFlag {
  if (coverage >= 0.8) return 'observed';
  if (coverage >= 0.25) return 'partial';
  return 'missing';
}

export function coverageOf(flag: AvailabilityFlag): number {
  return flag === 'observed' ? 1 : flag === 'partial' ? 0.5 : 0;
}

interface Bucket {
  anchor: CellActivity['center'];
  h3: string;
  regionId: string;
  modis: number;
  modisValid: number;
  viirs: number;
  viirsValid: number;
  combined: number;
  obsChildren: number;
  coverage: number;
  children: number;
  anomaly: boolean;
  score: number;
  modisFrp: number;
  viirsFrp: number;
  probability: number | null;
}

export function aggregateRecords(
  records: CellActivity[],
  resolution: number,
  indexScale: number,
  parentOf: (h3: string, res: number) => string = cellToParent,
): CellActivity[] {
  const buckets = new Map<string, Bucket>();
  for (const r of records) {
    const parent = r.resolution === resolution ? r.h3_id : parentOf(r.h3_id, resolution);
    let b = buckets.get(parent);
    if (!b) {
      b = {
        h3: parent, regionId: r.regionId, modis: 0, modisValid: 0, viirs: 0, viirsValid: 0, combined: 0,
        obsChildren: 0, coverage: 0, children: 0, anomaly: false, score: 0, modisFrp: 0, viirsFrp: 0,
        probability: null, anchor: r.center,
      };
      buckets.set(parent, b);
    }
    b.children += r.childCount;
    b.coverage += r.coverage * r.childCount;
    if (r.modis_detected !== null) {
      b.modis += r.modis_detected;
      b.modisValid++;
    }
    if (r.viirs_detected !== null) {
      b.viirs += r.viirs_detected;
      b.viirsValid++;
    }
    if (r.activity_index !== null) {
      b.combined += env.dataMode === 'api' ? r.activity_index * r.childCount : combinedFromIndex(r.activity_index, indexScale);
      b.obsChildren += r.childCount;
    }
    if (r.is_anomaly) b.anomaly = true;
    if (r.anomaly_score != null) b.score = Math.max(b.score, r.anomaly_score);
    b.modisFrp += r.modis_frp_sum ?? 0;
    b.viirsFrp += r.viirs_frp_sum ?? 0;
    if (r.probability != null) b.probability = Math.max(b.probability ?? 0, r.probability);
  }
  const out: CellActivity[] = [];
  for (const b of buckets.values()) {
    const coverage = b.children ? b.coverage / b.children : 0;
    const [lat, lng] = cellToLatLng(b.h3);
    out.push({
      h3_id: b.h3,
      date: records[0]?.date ?? '',
      resolution,
      regionId: b.regionId,
      center: env.dataMode === 'api' && !insideBolivia(lat, lng) ? b.anchor : { lat, lng },
      childCount: b.children,
      coverage: env.dataMode === 'api' ? NaN : coverage,
      modis_detected: b.modisValid ? b.modis : null,
      viirs_detected: b.viirsValid ? b.viirs : null,
      activity_index: b.obsChildren ? (env.dataMode === 'api' ? b.combined / b.obsChildren : indexFromCombinedSum(b.combined, indexScale, b.obsChildren)) : null,
      availability_flag: env.dataMode === 'api' ? (b.modisValid && b.viirsValid ? 'observed' : b.modisValid || b.viirsValid ? 'partial' : 'missing') : availabilityFromCoverage(coverage),
      is_anomaly: b.anomaly,
      anomaly_score: b.score,
      modis_frp_sum: b.modisFrp,
      viirs_frp_sum: b.viirsFrp,
      probability: b.probability,
    });
  }
  return out;
}

export function emptyTotals(): ActivityTotals {
  return {
    modis: 0, viirs: 0, activeCells: 0, anomalies: 0, missingCells: 0, partialCells: 0,
    observedCells: 0, meanIndex: 0,
  };
}

/** Totales a partir de registros res 6 (una fila = una celda nativa). */
export function computeTotals(records: CellActivity[]): { totals: ActivityTotals; byRegion: Record<string, ActivityTotals> } {
  const totals = emptyTotals();
  const byRegion: Record<string, ActivityTotals> = {};
  const indexSums: Record<string, number> = {};
  let indexSum = 0;
  let indexCount = 0;
  for (const r of records) {
    const t = (byRegion[r.regionId] ??= emptyTotals());
    for (const target of [totals, t]) {
      target.modis += r.modis_detected ?? 0;
      target.viirs += r.viirs_detected ?? 0;
      if ((r.activity_index ?? 0) > 0) target.activeCells++;
      if (r.is_anomaly) target.anomalies++;
      if (r.availability_flag === 'missing') target.missingCells++;
      else if (r.availability_flag === 'partial') target.partialCells++;
      else target.observedCells++;
    }
    if (r.activity_index !== null) {
      indexSum += r.activity_index;
      indexCount++;
      indexSums[r.regionId] = (indexSums[r.regionId] ?? 0) + r.activity_index;
    }
  }
  totals.meanIndex = indexCount ? indexSum / indexCount : 0;
  for (const [id, t] of Object.entries(byRegion)) {
    const n = t.observedCells + t.partialCells;
    t.meanIndex = n ? (indexSums[id] ?? 0) / n : 0;
  }
  return { totals, byRegion };
}
