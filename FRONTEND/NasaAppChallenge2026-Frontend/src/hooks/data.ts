'use client';
/**
 * Hooks de datos (React Query). Los componentes visuales solo dependen de estos hooks,
 * nunca del origen (mock o FastAPI).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getDataService } from '@/lib/data/service';
import { useStore } from '@/state/store';
import type { ActivityQuery, H3Index, ISODate, Region, SeriesTarget } from '@/lib/types/domain';

const svc = getDataService;

export function useDataRange() {
  return useQuery({ queryKey: ['range'], queryFn: async () => (await svc()).getDataRange(), staleTime: Infinity });
}

export function useRegions() {
  return useQuery({ queryKey: ['regions'], queryFn: async () => (await svc()).getRegions(), staleTime: Infinity });
}

export function useRegionMap(): Record<string, Region> {
  const { data } = useRegions();
  return useMemo(() => Object.fromEntries((data ?? []).map((r) => [r.id, r])), [data]);
}

export function useRegionCells(regionId: string | null | undefined) {
  return useQuery({
    queryKey: ['regionCells', regionId],
    queryFn: async () => (await svc()).getRegionCells(regionId!),
    enabled: Boolean(regionId),
    staleTime: Infinity,
  });
}

export function useActivity(query: ActivityQuery, enabled = true) {
  return useQuery({
    queryKey: ['activity', query],
    queryFn: async () => (await svc()).getActivity(query),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Instantánea compartida por el globo, la cabecera y las vistas (misma clave de caché). */
export function useGlobeSnapshot() {
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);
  const confidence = useStore((s) => s.filters.confidence);
  const layer = useStore((s) => s.layer);
  return useActivity({ date, granularity, resolution: 6, confidence, withPredictions: layer === 'prediction' });
}

function targetKey(target: SeriesTarget | null) {
  return target ? (target.kind === 'cell' ? `c:${target.h3}` : `r:${target.regionId}`) : 'none';
}

export function useSeries(target: SeriesTarget | null, from: ISODate, to: ISODate) {
  return useQuery({
    queryKey: ['series', targetKey(target), from, to],
    queryFn: async () => (await svc()).getSeries(target!, from, to),
    enabled: Boolean(target),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
}

export function useDetections(h3: H3Index | null, date: ISODate) {
  return useQuery({
    queryKey: ['detections', h3, date],
    queryFn: async () => (await svc()).getDetections(h3!, date),
    enabled: Boolean(h3),
  });
}

export function usePredictionDetail(target: SeriesTarget | null, date: ISODate) {
  return useQuery({
    queryKey: ['predictionDetail', targetKey(target), date],
    queryFn: async () => (await svc()).getPredictionDetail(target!, date),
    enabled: Boolean(target),
    placeholderData: keepPreviousData,
  });
}

export function useModelInfo() {
  return useQuery({ queryKey: ['model'], queryFn: async () => (await svc()).getModelInfo(), staleTime: Infinity });
}

/** true si el backend sirve un modelo de predicción (en modo mock, siempre). */
export function usePredictionAvailable() {
  const { data } = useModelInfo();
  return data !== undefined && data.status !== 'unavailable';
}

export function useMetadata() {
  return useQuery({ queryKey: ['metadata'], queryFn: async () => (await svc()).getMetadata(), staleTime: Infinity });
}

export function useWeather(regionId: string | null | undefined, from: ISODate, to: ISODate) {
  return useQuery({
    queryKey: ['weather', regionId, from, to],
    queryFn: async () => (await svc()).getWeather(regionId!, from, to),
    enabled: Boolean(regionId),
  });
}

export function useCellInfo(h3: H3Index | null) {
  return useQuery({
    queryKey: ['cellInfo', h3],
    queryFn: async () => (await svc()).getCellInfo(h3!),
    enabled: Boolean(h3),
    staleTime: Infinity,
  });
}

export function useNews(regionId: string | null) {
  return useQuery({
    queryKey: ['news', regionId],
    queryFn: async () => (await svc()).getNews(regionId!),
    enabled: Boolean(regionId),
    staleTime: Infinity,
  });
}
