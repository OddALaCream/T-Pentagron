'use client';
/**
 * Línea temporal interactiva: reproducción diaria o mensual, paso a paso, velocidad,
 * selector de fecha y una pista con el histograma diario de actividad del año.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { appConfig } from '@/config/app';
import { brand } from '@/config/brand';
import { env } from '@/config/env';
import { useRegionMap, useSeries } from '@/hooks/data';
import { dayIndexFromISO, formatDate, formatMonth, isoFromDayIndex, monthShort, yearOf } from '@/lib/time/dates';
import { CATEGORY, kindFromIndex, SENSOR_COLORS } from '@/lib/science/categories';
import { useStore } from '@/state/store';
import { Segmented } from '@/components/ui/primitives';

export function TimelineDock({ compact = false, measure = true }: { compact?: boolean; measure?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const historyId = useId();
  // Publica la altura real del dock (puede ocupar dos filas) para que leyenda y paneles
  // no queden debajo.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = sectionRef.current;
    if (!measure || !el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--dock-h', `${h}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const date = useStore((s) => s.date);
  const range = useStore((s) => s.dataRange);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const granularity = useStore((s) => s.granularity);
  const layer = useStore((s) => s.layer);
  const selection = useStore((s) => s.selection);
  const setDate = useStore((s) => s.setDate);
  const step = useStore((s) => s.step);
  const togglePlaying = useStore((s) => s.togglePlaying);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const setGranularity = useStore((s) => s.setGranularity);
  const regions = useRegionMap();

  const year = yearOf(date);
  const regionId = selection?.regionId ?? brand.pilot.regionId;
  const region = regions[regionId];
  const yStart = `${year}-01-01` < range.start ? range.start : `${year}-01-01`;
  const yEnd = `${year}-12-31` > range.end ? range.end : `${year}-12-31`;
  const { data: series } = useSeries({ kind: 'region', regionId }, yStart, yEnd);

  const startIdx = dayIndexFromISO(`${year}-01-01`);
  const totalDays = dayIndexFromISO(`${year}-12-31`) - startIdx + 1;
  const pos = (dayIndexFromISO(date) - startIdx) / (totalDays - 1);
  const metric = layer === 'modis' ? 'modis' : layer === 'viirs' ? 'viirs' : 'index';
  const max = useMemo(() => Math.max(1, ...(series ?? []).map((p) => p[metric] ?? 0)), [series, metric]);

  const trackRef = useRef<HTMLDivElement>(null);
  const dateFromX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return date;
      const r = el.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return isoFromDayIndex(startIdx + Math.round(k * (totalDays - 1)));
    },
    [date, startIdx, totalDays],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setPlaying(false);
    setDate(dateFromX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const next = dateFromX(e.clientX);
    if (next !== useStore.getState().date) setDate(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 7, ArrowDown: -7, PageUp: 30, PageDown: -30 };
    if (e.key in map) {
      e.preventDefault();
      setPlaying(false);
      setDate(isoFromDayIndex(dayIndexFromISO(date) + map[e.key]));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setDate(yStart);
    } else if (e.key === 'End') {
      e.preventDefault();
      setDate(yEnd);
    }
  };

  const years: number[] = [];
  for (let y = yearOf(range.start); y <= yearOf(range.end); y++) years.push(y);
  const jumpYear = (delta: number) => {
    const target = `${year + delta}${date.slice(4)}`;
    setDate(target);
  };

  return (
    <section ref={sectionRef} className={`timeline ${compact ? 'timeline--compact' : ''} ${collapsed ? 'is-collapsed' : ''}`} aria-label="Línea temporal" data-reveal>
      <div className="timeline__controls">
        <button type="button" className="icon-btn" onClick={() => { setPlaying(false); step(-1); }} aria-label={granularity === 'month' ? 'Mes anterior' : 'Día anterior'} title="Anterior (←)">
          <SkipBack size={16} />
        </button>
        <button type="button" className="icon-btn icon-btn--play" onClick={togglePlaying} aria-label={playing ? 'Pausar reproducción' : 'Reproducir evolución'} title="Reproducir / pausar (espacio)">
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => { setPlaying(false); step(1); }} aria-label={granularity === 'month' ? 'Mes siguiente' : 'Día siguiente'} title="Siguiente (→)">
          <SkipForward size={16} />
        </button>
        <Segmented
          label="Velocidad"
          size="sm"
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v))}
          options={appConfig.playbackSpeeds.map((s) => ({ value: String(s), label: `${s}×` }))}
          className="timeline__speed"
        />
        <Segmented
          label="Granularidad"
          size="sm"
          value={granularity}
          onChange={setGranularity}
          options={[{ value: 'day', label: 'Día' }, { value: 'month', label: 'Mes' }]}
        />
        <div className="timeline__date">
          <span className="timeline__date-text" aria-live="off">{granularity === 'month' ? formatMonth(date) : formatDate(date)} · UTC</span>
          <input
            type="date"
            className="timeline__date-input"
            value={date}
            min={range.start}
            max={range.end}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Ir a una fecha"
          />
        </div>
        <div className="timeline__year">
          <button type="button" className="icon-btn icon-btn--small" onClick={() => jumpYear(-1)} disabled={year <= years[0]} aria-label="Año anterior"><ChevronLeft size={15} /></button>
          <span>{year}</span>
          <button type="button" className="icon-btn icon-btn--small" onClick={() => jumpYear(1)} disabled={year >= years[years.length - 1]} aria-label="Año siguiente"><ChevronRight size={15} /></button>
        </div>
        <button type="button" className="btn btn--ghost timeline__latest" onClick={() => { setPlaying(false); setDate(range.end); }} title="Último día con datos">
          Último dato
        </button>
        <button type="button" className="icon-btn timeline__toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls={historyId} aria-label={collapsed ? 'Mostrar historial y velocidad' : 'Contraer línea temporal'} title={collapsed ? 'Mostrar historial y velocidad' : 'Contraer línea temporal'}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <div id={historyId} hidden={collapsed}>
      <div
        ref={trackRef}
        className="timeline__track"
        role="slider"
        tabIndex={0}
        aria-label={`Fecha dentro de ${year}`}
        aria-valuemin={1}
        aria-valuemax={totalDays}
        aria-valuenow={Math.round(pos * (totalDays - 1)) + 1}
        aria-valuetext={formatDate(date)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <svg className="timeline__hist" viewBox={`0 0 ${totalDays} 40`} preserveAspectRatio="none" aria-hidden="true">
          {(layer === 'prediction' ? [] : series ?? []).map((p) => {
            const i = dayIndexFromISO(p.date) - startIdx;
            if (p.availability === 'missing') return <rect key={p.date} x={i} y={36} width={1} height={4} fill="rgba(140,160,190,0.35)" />;
            const v = p[metric] ?? 0;
            if (v <= 0) return null;
            const h = Math.max(1.5, (v / max) * 36);
            return <rect key={p.date} x={i} y={40 - h} width={0.9} height={h} fill={layer === 'harmonized' ? CATEGORY[kindFromIndex(p.index ?? 0)].color : layer === 'modis' ? SENSOR_COLORS.MODIS : SENSOR_COLORS.VIIRS} opacity={0.8} />;
          })}
          {/* fuera del rango de datos */}
          {dayIndexFromISO(yEnd) - startIdx < totalDays - 1 && (
            <rect x={dayIndexFromISO(yEnd) - startIdx + 1} y={0} width={totalDays} height={40} fill="rgba(120,140,170,0.07)" />
          )}
        </svg>
        <div className="timeline__months" aria-hidden="true">
          {Array.from({ length: 12 }, (_, m) => (
            <span key={m} style={{ left: `${((dayIndexFromISO(`${year}-${String(m + 1).padStart(2, '0')}-01`) - startIdx) / totalDays) * 100}%` }}>
              {monthShort(m + 1)}
            </span>
          ))}
        </div>
        <div className="timeline__playhead" style={{ left: `${pos * 100}%` }} aria-hidden="true">
          <span />
        </div>
      </div>
      <div className="timeline__caption muted">
        {layer === 'prediction' ? 'Predicción no disponible · sin modelo entrenado' : layer === 'harmonized' ? 'Índice exploratorio diario 0–1 · normalizado por sensor, sin calibración física' : `Detecciones diarias originales ${layer.toUpperCase()}`} · {region?.name ?? '—'} {env.dataMode === 'mock' ? '(demo)' : '· NASA FIRMS 2024'}
      </div>
      </div>
    </section>
  );
}
