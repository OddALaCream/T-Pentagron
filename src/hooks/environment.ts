'use client';
/**
 * Hooks de entorno: movimiento reducido del sistema, calidad automática,
 * reproducción temporal, atajos de teclado y sincronización con la URL.
 */
import { useEffect, useRef } from 'react';
import { appConfig } from '@/config/app';
import { isValidISODate } from '@/lib/time/dates';
import { useStore, type Quality } from '@/state/store';
import type { DataLayer } from '@/lib/types/domain';

export function useSystemPreferences() {
  const setReduced = useStore((s) => s.setSystemReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [setReduced]);

  // Calidad automática la primera vez (el usuario puede cambiarla en Configuración).
  useEffect(() => {
    const { settings, updateSettings } = useStore.getState();
    if (settings.qualityChosen) return;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const memory = nav.deviceMemory ?? 8;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    let quality: Quality = 'high';
    if (coarse || small || cores <= 4 || memory <= 4) quality = 'balanced';
    if ((coarse && small && cores <= 4) || memory <= 2) quality = 'low';
    updateSettings({
      quality,
      bloom: quality === 'high',
      clouds: quality !== 'low',
      ambient: quality !== 'low',
    });
  }, []);
}

/** Avanza la fecha mientras `playing` está activo. */
export function usePlayback() {
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const granularity = useStore((s) => s.granularity);
  const view = useStore((s) => s.view);
  useEffect(() => {
    if (!playing) return;
    const base = granularity === 'month' ? appConfig.playbackBaseMs * 1.8 : appConfig.playbackBaseMs;
    const id = window.setInterval(() => {
      const s = useStore.getState();
      if (s.date >= s.dataRange.end) {
        s.setPlaying(false);
        return;
      }
      s.step(1);
    }, base / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, granularity, view]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Atajos globales del observatorio. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const layers: Record<string, DataLayer> = { '1': 'modis', '2': 'viirs', '3': 'harmonized', '4': 'prediction' };
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.phase !== 'observatory' || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (s.drawer) s.setDrawer(null);
        else if (s.view === 'regional' && !s.transition) s.setTransition('leaving');
        else if (s.panel.open) s.clearSelection();
        return;
      }
      if (e.target instanceof HTMLElement && e.target.closest('[role="tablist"],[role="slider"],[data-own-keys]')) return;
      switch (e.key) {
        case ' ':
          if (e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          s.togglePlaying();
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.setPlaying(false);
          s.step(e.shiftKey ? (s.granularity === 'month' ? 12 : 30) : 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          s.setPlaying(false);
          s.step(e.shiftKey ? (s.granularity === 'month' ? -12 : -30) : -1);
          break;
        case 'r':
        case 'R':
          s.updateSettings({ autoRotate: !s.settings.autoRotate });
          break;
        case 's':
        case 'S':
          s.requestScan();
          break;
        case 'm':
        case 'M':
          s.setGranularity(s.granularity === 'day' ? 'month' : 'day');
          break;
        case '?':
          s.toggleDrawer('help');
          break;
        default:
          if (layers[e.key]) s.setLayer(layers[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Sincroniza fecha, capa, selección y vista con la URL (enlaces compartibles),
 * sin recargar la página ni repetir la introducción.
 */
export function useUrlSync() {
  const hydrated = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = useStore.getState();
    const date = params.get('date');
    if (isValidISODate(date)) s.setDate(date);
    const layer = params.get('layer');
    if (layer === 'modis' || layer === 'viirs' || layer === 'harmonized' || layer === 'prediction') s.setLayer(layer);
    if (params.get('g') === 'month') s.setGranularity('month');
    const cell = params.get('cell');
    const region = params.get('region');
    if (cell && region) s.select({ kind: 'cell', h3: cell, regionId: region, resolution: Number(params.get('res') || 6) });
    else if (region) s.select({ kind: 'region', regionId: region });
    hydrated.current = true;

    let timer: number | undefined;
    const unsubscribe = useStore.subscribe((state) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = new URLSearchParams();
        next.set('date', state.date);
        next.set('layer', state.layer);
        if (state.granularity === 'month') next.set('g', 'month');
        if (state.selection?.kind === 'cell') {
          next.set('region', state.selection.regionId);
          next.set('cell', state.selection.h3);
          if (state.selection.resolution !== 6) next.set('res', String(state.selection.resolution));
        } else if (state.selection?.kind === 'region') next.set('region', state.selection.regionId);
        if (state.view === 'regional' && state.regionalId) next.set('view', `regional:${state.regionalId}`);
        const url = `${window.location.pathname}?${next.toString()}`;
        if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
      }, 250);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
}
