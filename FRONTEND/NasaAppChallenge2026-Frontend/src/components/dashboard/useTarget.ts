'use client';
import { useMemo } from 'react';
import { useRegionMap } from '@/hooks/data';
import { useStore } from '@/state/store';
import type { Region, SeriesTarget } from '@/lib/types/domain';

export interface TargetInfo {
  target: SeriesTarget;
  region: Region | undefined;
  kind: 'cell' | 'region';
  h3: string | null;
  resolution: number | null;
  /** Nombre corto para cabeceras. */
  title: string;
}

/** Objetivo de análisis derivado de la selección actual. */
export function useTarget(): TargetInfo | null {
  const selection = useStore((s) => s.selection);
  const regions = useRegionMap();
  return useMemo(() => {
    if (!selection) return null;
    const region = regions[selection.regionId];
    if (selection.kind === 'region') {
      return { target: { kind: 'region', regionId: selection.regionId }, region, kind: 'region', h3: null, resolution: null, title: region?.name ?? selection.regionId };
    }
    return {
      target: { kind: 'cell', h3: selection.h3 },
      region,
      kind: 'cell',
      h3: selection.h3,
      resolution: selection.resolution,
      title: `Celda H3 · res ${selection.resolution}`,
    };
  }, [selection, regions]);
}
