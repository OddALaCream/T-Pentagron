'use client';
import { useMemo, useState } from 'react';
import { Play, GitCompareArrows } from 'lucide-react';
import { useSeries } from '@/hooks/data';
import { formatDate, monthLong, monthShort, yearOf } from '@/lib/time/dates';
import { CATEGORY, SENSOR_COLORS } from '@/lib/science/categories';
import { useStore } from '@/state/store';
import { CalendarHeatmap, yearsInRange, type CalendarMetric } from '@/components/charts/charts';
import { Note, SectionTitle, Segmented } from '@/components/ui/primitives';
import { SymbolIcon } from '@/components/ui/SymbolIcon';
import type { SeriesPoint } from '@/lib/types/domain';
import type { TargetInfo } from './useTarget';

interface PeriodStats {
  viirs: number;
  modis: number;
  activeDays: number;
  missingDays: number;
  anomalyDays: number;
  peak: SeriesPoint | null;
  days: number;
}

function stats(points: SeriesPoint[], from: number, to: number): PeriodStats {
  const sel = points.filter((p) => {
    const m = Number(p.date.slice(5, 7));
    return m >= from && m <= to;
  });
  let peak: SeriesPoint | null = null;
  for (const p of sel) if ((p.viirs ?? 0) > (peak?.viirs ?? -1)) peak = p;
  return {
    viirs: sel.reduce((a, p) => a + (p.viirs ?? 0), 0),
    modis: sel.reduce((a, p) => a + (p.modis ?? 0), 0),
    activeDays: sel.filter((p) => (p.index ?? 0) > 0).length,
    missingDays: sel.filter((p) => p.availability === 'missing').length,
    anomalyDays: sel.filter((p) => p.anomaly).length,
    peak: peak && (peak.viirs ?? 0) > 0 ? peak : null,
    days: sel.length,
  };
}

function delta(a: number, b: number): string {
  if (b === 0) return a === 0 ? '0 %' : 'nuevo';
  const d = ((a - b) / b) * 100;
  return `${d > 0 ? '+' : ''}${d.toFixed(0)} %`;
}

export function CalendarModule({ info }: { info: TargetInfo }) {
  const date = useStore((s) => s.date);
  const range = useStore((s) => s.dataRange);
  const setDate = useStore((s) => s.setDate);
  const setPlaying = useStore((s) => s.setPlaying);
  const setGranularity = useStore((s) => s.setGranularity);
  const compare = useStore((s) => s.compare);
  const setCompare = useStore((s) => s.setCompare);
  const [metric, setMetric] = useState<CalendarMetric>('harmonized');
  const [showCompare, setShowCompare] = useState(false);
  const years = yearsInRange(range.start, range.end);
  const year = yearOf(date);
  const yEnd = (y: number) => (`${y}-12-31` > range.end ? range.end : `${y}-12-31`);
  const yStart = (y: number) => (`${y}-01-01` < range.start ? range.start : `${y}-01-01`);

  const { data: points, isFetching } = useSeries(info.target, yStart(year), yEnd(year));
  const { data: pointsA } = useSeries(showCompare ? info.target : null, yStart(compare.yearA), yEnd(compare.yearA));
  const { data: pointsB } = useSeries(showCompare ? info.target : null, yStart(compare.yearB), yEnd(compare.yearB));

  const monthly = useMemo(() => {
    const out = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, viirs: 0, modis: 0, missing: 0, days: 0 }));
    for (const p of points ?? []) {
      const m = Number(p.date.slice(5, 7)) - 1;
      out[m].viirs += p.viirs ?? 0;
      out[m].modis += p.modis ?? 0;
      out[m].days++;
      if (p.availability === 'missing') out[m].missing++;
    }
    return out;
  }, [points]);
  const maxMonth = Math.max(1, ...monthly.map((m) => m.viirs));
  const missingTotal = (points ?? []).filter((p) => p.availability === 'missing').length;
  const sA = pointsA ? stats(pointsA, compare.monthFrom, compare.monthTo) : null;
  const sB = pointsB ? stats(pointsB, compare.monthFrom, compare.monthTo) : null;

  const playSeason = () => {
    setGranularity('day');
    setDate(`${year}-${String(compare.monthFrom).padStart(2, '0')}-01`);
    setPlaying(true);
  };

  return (
    <div className="module">
      <div className="module-toolbar" data-holo-item>
        <Segmented
          label="Año"
          size="sm"
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(y) => setDate(`${y}${date.slice(4)}` > range.end ? range.end : `${y}${date.slice(4)}`)}
        />
        <Segmented
          label="Métrica del calendario"
          size="sm"
          value={metric}
          options={[
            { value: 'harmonized', label: 'Armonizado' },
            { value: 'viirs', label: 'VIIRS', accent: SENSOR_COLORS.VIIRS },
            { value: 'modis', label: 'MODIS', accent: SENSOR_COLORS.MODIS },
          ]}
          onChange={setMetric}
        />
      </div>

      <div className={`calendar-wrap ${isFetching ? 'is-loading' : ''}`} data-holo-item>
        <CalendarHeatmap points={points ?? []} year={year} metric={metric} selectedDate={date} onSelect={setDate} />
        <div className="calendar-legend">
          {(['low', 'medium', 'high'] as const).map((k) => (
            <span key={k}><SymbolIcon kind={k} size={11} /> {CATEGORY[k].short}</span>
          ))}
          <span><i className="swatch swatch--zero" /> Sin detección</span>
          <span><i className="swatch swatch--hatch" /> Sin observación</span>
          <span><i className="swatch swatch--anomaly" /> Anomalía</span>
        </div>
        <p className="muted small">
          Haz clic en un día para verlo en el globo. {missingTotal > 0 && `${missingTotal} días sin observación válida en ${year}.`}
        </p>
      </div>

      <div data-holo-item>
        <SectionTitle aside={<span className="muted small">VIIRS (barra) · MODIS (marca)</span>}>Totales mensuales {year}</SectionTitle>
        <div className="month-bars" role="img" aria-label={`Detecciones mensuales en ${year}`}>
          {monthly.map((m) => (
            <button
              key={m.m}
              type="button"
              className={`month-bars__col ${Number(date.slice(5, 7)) === m.m ? 'is-current' : ''}`}
              onClick={() => {
                const target = `${year}-${String(m.m).padStart(2, '0')}-15`;
                setDate(target > range.end ? range.end : target);
              }}
              title={`${monthLong(m.m)}: VIIRS ${m.viirs} · MODIS ${m.modis}${m.missing ? ` · ${m.missing} días sin observación` : ''}`}
              disabled={m.days === 0}
            >
              <span className="month-bars__bar" style={{ height: `${(m.viirs / maxMonth) * 100}%` }} />
              <span className="month-bars__mark" style={{ bottom: `${(m.modis / maxMonth) * 100}%` }} />
              <span className="month-bars__label">{monthShort(m.m)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="action-row" data-holo-item>
        <button type="button" className="btn" onClick={playSeason}>
          <Play size={14} /> Reproducir temporada {monthShort(compare.monthFrom)}–{monthShort(compare.monthTo)}
        </button>
        <button type="button" className={`btn ${showCompare ? 'is-active' : ''}`} onClick={() => setShowCompare((v) => !v)} aria-expanded={showCompare}>
          <GitCompareArrows size={14} /> Comparar periodos
        </button>
      </div>

      {showCompare && (
        <div className="compare" data-holo-item>
          <div className="compare__controls">
            <label>
              Periodo A
              <select value={compare.yearA} onChange={(e) => setCompare({ yearA: Number(e.target.value) })}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              Periodo B
              <select value={compare.yearB} onChange={(e) => setCompare({ yearB: Number(e.target.value) })}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              Desde
              <select value={compare.monthFrom} onChange={(e) => setCompare({ monthFrom: Math.min(Number(e.target.value), compare.monthTo) })}>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthLong(i + 1)}</option>)}
              </select>
            </label>
            <label>
              Hasta
              <select value={compare.monthTo} onChange={(e) => setCompare({ monthTo: Math.max(Number(e.target.value), compare.monthFrom) })}>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthLong(i + 1)}</option>)}
              </select>
            </label>
          </div>
          {sA && sB ? (
            <table className="data-table compare__table">
              <thead>
                <tr><th /><th>{compare.yearA}</th><th>{compare.yearB}</th><th>Δ</th></tr>
              </thead>
              <tbody>
                <tr><th>Detecciones VIIRS</th><td>{sA.viirs}</td><td>{sB.viirs}</td><td>{delta(sA.viirs, sB.viirs)}</td></tr>
                <tr><th>Detecciones MODIS</th><td>{sA.modis}</td><td>{sB.modis}</td><td>{delta(sA.modis, sB.modis)}</td></tr>
                <tr><th>Días con actividad</th><td>{sA.activeDays}</td><td>{sB.activeDays}</td><td>{delta(sA.activeDays, sB.activeDays)}</td></tr>
                <tr><th>Días con anomalía</th><td>{sA.anomalyDays}</td><td>{sB.anomalyDays}</td><td>{sA.anomalyDays - sB.anomalyDays >= 0 ? '+' : ''}{sA.anomalyDays - sB.anomalyDays}</td></tr>
                <tr><th>Días sin observación</th><td>{sA.missingDays}</td><td>{sB.missingDays}</td><td>—</td></tr>
                <tr><th>Día pico (VIIRS)</th><td>{sA.peak ? formatDate(sA.peak.date) : '—'}</td><td>{sB.peak ? formatDate(sB.peak.date) : '—'}</td><td /></tr>
              </tbody>
            </table>
          ) : (
            <p className="muted small">Calculando…</p>
          )}
          {sA && sA.days === 0 && <Note tone="warn">El periodo A no tiene días dentro del rango de datos.</Note>}
          <Note tone="demo">Comparación sobre datos de demostración; los días sin observación se excluyen de los totales.</Note>
        </div>
      )}
    </div>
  );
}
