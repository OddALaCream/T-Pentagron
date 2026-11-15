'use client';
import { useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Copy, Check, Orbit, Radar, Sparkles } from 'lucide-react';
import { usePredictionAvailable, useSeries } from '@/hooks/data';
import { addDays, formatDate, formatMonth, monthEnd, monthStart } from '@/lib/time/dates';
import { CATEGORY, classify, LAYERS, SENSOR_COLORS } from '@/lib/science/categories';
import { cellCenter, formatLatLng } from '@/lib/geo/h3';
import { useArchiveYears, useStore } from '@/state/store';
import { Sparkline } from '@/components/charts/charts';
import { SymbolIcon } from '@/components/ui/SymbolIcon';
import { Note, SectionTitle, Stat } from '@/components/ui/primitives';
import type { CellActivity, SeriesPoint } from '@/lib/types/domain';
import type { TargetInfo } from './useTarget';
import { env } from '@/config/env';

function sum(points: SeriesPoint[], key: 'viirs' | 'modis' | 'index'): number {
  return points.reduce((a, p) => a + (p[key] ?? 0), 0);
}

export function SummaryModule({ info }: { info: TargetInfo }) {
  const date = useStore((s) => s.date);
  const years = useArchiveYears();
  const layer = useStore((s) => s.layer);
  const granularity = useStore((s) => s.granularity);
  const range = useStore((s) => s.dataRange);
  const setPanel = useStore((s) => s.setPanel);
  const setTransition = useStore((s) => s.setTransition);
  const [copied, setCopied] = useState(false);
  const predictionAvailable = usePredictionAvailable();

  const from = addDays(date, -59);
  const { data: series, isLoading } = useSeries(info.target, from < range.start ? range.start : from, date);
  const { data: month } = useSeries(granularity === 'month' ? info.target : null, monthStart(date), monthEnd(date) > range.end ? range.end : monthEnd(date));

  const today = granularity === 'month' && month ? {
    ...month[0], date, modis: month.some(p=>p.modis!==null) ? sum(month, 'modis') : null, viirs: month.some(p=>p.viirs!==null) ? sum(month, 'viirs') : null,
    index: month.some(p => p.index !== null) ? month.reduce((n,p)=>n+(p.index ?? 0)*(p.activeCells ?? 1),0) / month.filter(p=>p.index!==null).reduce((n,p)=>n+(p.activeCells ?? 1),0) : null,
    modisFrp: month.reduce((n,p) => n + (p.modisFrp ?? 0),0), viirsFrp: month.reduce((n,p) => n + (p.viirsFrp ?? 0),0),
  } : series?.at(-1);
  const last7 = series?.slice(-7) ?? [];
  const prev7 = series?.slice(-14, -7) ?? [];
  const metric = layer === 'modis' ? 'modis' : layer === 'viirs' ? 'viirs' : 'index';
  const cur = sum(last7, metric);
  const prev = sum(prev7, metric);
  const comparable = prev > 0 && prev7.length === 7 && last7.length === 7;
  const trend = comparable ? (cur - prev) / prev : 0;
  const trendLabel = !comparable ? 'sin base comparable' : Math.abs(trend) < 0.1 ? 'estable' : trend > 0 ? 'en aumento' : 'en descenso';
  const TrendIcon = Math.abs(trend) < 0.1 ? ArrowRight : trend > 0 ? ArrowUpRight : ArrowDownRight;

  // Registro del día con la misma forma que usa el globo, para clasificar igual.
  const record: CellActivity | null = today
    ? {
        h3_id: info.h3 ?? info.target.kind, date, resolution: info.resolution ?? 6, regionId: info.region?.id ?? '',
        center: { lat: 0, lng: 0 }, childCount: info.kind === 'region' ? Math.max(1, info.region?.cellCount ?? 1) : 1, coverage: today.coverage ?? 1,
        modis_detected: today.modis, viirs_detected: today.viirs, activity_index: today.index, availability_flag: today.availability,
        is_anomaly: today.anomaly,
      }
    : null;
  const cls = record ? classify(record, layer, granularity) : null;
  const meta = CATEGORY[cls?.kind ?? 'none'];
  const center = info.kind === 'cell' && info.h3 ? cellCenter(info.h3) : info.region?.center;

  const copy = async () => {
    if (!info.h3) return;
    try {
      await navigator.clipboard.writeText(info.h3);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* portapapeles no disponible */
    }
  };

  return (
    <div className="module summary-module">
      <div className="summary-head" data-holo-item>
        <div className="summary-head__place">
          <span className="summary-head__region">{info.region?.name ?? 'Región'}</span>
          <span className="summary-head__country">{info.region ? `${info.region.admin} · ${info.region.country}` : ''}</span>
        </div>
        <div className={`category-pill category-pill--${cls?.kind ?? 'none'}`} style={{ '--pill': meta.color } as React.CSSProperties}>
          <SymbolIcon kind={cls?.kind ?? 'none'} size={15} animated />
          <span>{isLoading ? 'Cargando…' : meta.label}</span>
        </div>
      </div>

      <details className="summary-details" data-holo-item>
      <summary>Ubicación, fecha y procedencia</summary>
      <dl className="kv">
        <div><dt>Coordenadas</dt><dd className="mono">{center ? formatLatLng(center) : '—'}</dd></div>
        {info.h3 && (
          <div>
            <dt>Identificador H3</dt>
            <dd className="mono kv__copy">
              {info.h3}
              <button type="button" className="icon-btn icon-btn--tiny" onClick={copy} aria-label="Copiar identificador H3" title="Copiar">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </dd>
          </div>
        )}
        {info.kind === 'region' && <div><dt>Celdas H3 (res 6)</dt><dd className="mono">{info.region?.cellCount ?? '—'}</dd></div>}
        <div><dt>Fecha</dt><dd>{granularity === 'month' ? formatMonth(date) : formatDate(date)} <span className="muted">UTC</span></dd></div>
        <div><dt>Capa</dt><dd>{LAYERS.find((l) => l.id === layer)?.label}</dd></div>
        <div>
          <dt>Disponibilidad</dt>
          <dd>
            {env.dataMode === 'api' ? (today?.availability === 'observed' ? 'Detecciones de ambas familias; cobertura desconocida' : today?.availability === 'partial' ? 'Detecciones de una familia; cobertura desconocida' : 'Sin detecciones registradas; cobertura desconocida') : today?.availability === 'observed' ? 'Observación válida (ambos sensores)' : today?.availability === 'partial' ? 'Parcial (un solo sensor)' : 'Sin observación válida'}
          </dd>
        </div>
        <div><dt>Fuente</dt><dd>{env.dataMode === 'api' ? `NASA FIRMS · Bolivia ${years} · type=0` : 'Datos de demostración (FIRMS simulado)'}</dd></div>
      </dl>
      </details>

      {today?.availability === 'missing' && (
        <Note tone="warn">Sin detecciones registradas este día. Cobertura desconocida; no equivale a «sin actividad».</Note>
      )}

      {layer === 'prediction' && !predictionAvailable ? <Note>Predicción no disponible: no existe un modelo entrenado.</Note> : <div className="stats-grid" data-holo-item>
        {layer !== 'modis' && <Stat label="VIIRS · original" value={today?.viirs ?? '—'} unit="det." tone={SENSOR_COLORS.VIIRS} />}
        {layer !== 'viirs' && <Stat label="MODIS · original" value={today?.modis ?? '—'} unit="det." tone={SENSOR_COLORS.MODIS} />}
        {layer === 'harmonized' && <Stat label="Índice exploratorio" value={today?.index == null ? '—' : today.index.toFixed(2)} tone={SENSOR_COLORS.harmonized} hint="Normalización robusta por sensor; no calibración física" />}
        <Stat label={`FRP · ${layer === 'harmonized' ? 'suma de detecciones' : layer.toUpperCase()}`} value={today ? Math.round((layer !== 'modis' ? today.viirsFrp ?? 0 : 0) + (layer !== 'viirs' ? today.modisFrp ?? 0 : 0)) : '—'} unit="MW" />
      </div>}

      {granularity === 'month' && month && (
        <p className="muted small" data-holo-item>
          Total de {formatMonth(date)}: VIIRS {sum(month, 'viirs')} · MODIS {sum(month, 'modis')} · {month.filter((p) => (p.index ?? 0) > 0).length} días con actividad.
        </p>
      )}

      {layer !== 'prediction' && <details className="summary-details" data-holo-item>
        <summary>Tendencia histórica · últimos 60 días</summary>
        <SectionTitle aside={<span className={`trend trend--${trend > 0.1 ? 'up' : trend < -0.1 ? 'down' : 'flat'}`}><TrendIcon size={14} /> {trendLabel}{Math.abs(trend) >= 0.1 ? ` ${trend > 0 ? '+' : ''}${Math.round(trend * 100)} %` : ''}</span>}>
          Tendencia · últimos 60 días
        </SectionTitle>
        <Sparkline
          values={series?.map((p) => p[metric]) ?? []}
          missing={series?.map((p) => p.availability === 'missing')}
          highlight={(series?.length ?? 0) - 1}
          label={`${metric === 'index' ? 'Índice exploratorio' : metric.toUpperCase()} de los últimos 60 días`}
        />
        <p className="muted small">Comparación de los últimos 7 días con los 7 anteriores. {layer === 'harmonized' ? 'Índice exploratorio.' : `Recuentos originales ${layer.toUpperCase()}.`} Sin detecciones registradas no equivale a ausencia de fuego.</p>
      </details>}

      <div className="action-row" data-holo-item>
        <button type="button" className="btn btn--primary" onClick={() => setTransition('entering')}>
          <Orbit size={15} /> Explorar zona
        </button>
        <button type="button" className="btn" onClick={() => setPanel({ tab: 'calendar' })}>
          <CalendarDays size={15} /> Calendario
        </button>
        <button type="button" className="btn" onClick={() => setPanel({ tab: 'sensors' })}>
          <Radar size={15} /> Sensores
        </button>
        <button type="button" className="btn" onClick={() => setPanel({ tab: 'prediction' })}>
          <Sparkles size={15} /> Pronóstico
        </button>
      </div>
    </div>
  );
}
