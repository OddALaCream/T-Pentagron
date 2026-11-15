'use client';
/**
 * Visualizaciones científicas ligeras en SVG (sin dependencias), coherentes con el
 * sistema de categorías y los colores de sensor. Todas muestran explícitamente los
 * días sin observación (rayado), distinto de "cero detecciones".
 */
import { useId, useMemo, useState } from 'react';
import { CATEGORY, kindFromIndex, SENSOR_COLORS } from '@/lib/science/categories';
import type { SeriesPoint } from '@/lib/types/domain';
import { formatDate, monthShort, weekday, yearOf } from '@/lib/time/dates';

export function HatchDefs({ id, color = 'rgba(160,180,210,0.45)' }: { id: string; color?: string }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="rgba(120,140,170,0.08)" />
        <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="1.2" />
      </pattern>
    </defs>
  );
}

/* ------------------------------------------------------------------ */
export function Sparkline({
  values, missing, highlight, color = '#e8f1ff', height = 44, width = 260, fill = true, label,
}: {
  values: (number | null)[];
  missing?: boolean[];
  highlight?: number;
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
  label: string;
}) {
  const gid = useId().replace(/:/g, '');
  const max = Math.max(1e-6, ...values.map((v) => v ?? 0));
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width);
  const y = (v: number) => height - 3 - (v / max) * (height - 8);
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
  });
  if (current) segments.push(current);
  const area = values.length
    ? `M0 ${height} ` + values.map((v, i) => `L${x(i).toFixed(1)} ${y(v ?? 0).toFixed(1)}`).join(' ') + ` L${width} ${height} Z`
    : '';
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label={label}>
      <HatchDefs id={`h${gid}`} />
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {missing?.map((m, i) => (m ? <rect key={i} x={x(i) - width / n / 2} y={height - 6} width={Math.max(1, width / n)} height={6} fill={`url(#h${gid})`} /> : null))}
      {fill && <path d={area} fill={`url(#g${gid})`} />}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      ))}
      {highlight !== undefined && highlight >= 0 && highlight < n && (
        <>
          <line x1={x(highlight)} x2={x(highlight)} y1={0} y2={height} stroke="rgba(255,255,255,0.35)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          {values[highlight] !== null && <circle cx={x(highlight)} cy={y(values[highlight] ?? 0)} r="2.6" fill={color} />}
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
export function SensorChart({
  points, selectedDate, onSelectDate, calibrated, calibrationFactor = 3.1, height = 170,
}: {
  points: SeriesPoint[];
  selectedDate: string;
  onSelectDate?: (d: string) => void;
  calibrated: boolean;
  calibrationFactor?: number;
  height?: number;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const mid = height * 0.56;
  const n = points.length;
  const bw = width / Math.max(1, n);
  const modisVal = (p: SeriesPoint) => (p.modis ?? 0) * (calibrated ? calibrationFactor : 1);
  const maxUp = Math.max(1, ...points.map((p) => p.viirs ?? 0));
  const maxDown = Math.max(1, ...points.map(modisVal));
  const scale = Math.max(maxUp, maxDown);
  const upH = mid - 14;
  const downH = height - mid - 18;
  const idx = points.findIndex((p) => p.date === selectedDate);
  const hp = hover !== null ? points[hover] : idx >= 0 ? points[idx] : null;
  return (
    <div className="sensor-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
        aria-label="Detecciones diarias por sensor: VIIRS hacia arriba, MODIS hacia abajo"
        onMouseLeave={() => setHover(null)}>
        <HatchDefs id={`h${gid}`} />
        {points.map((p, i) => {
          const x = i * bw;
          const missingV = p.viirs === null;
          const missingM = p.modis === null;
          const vh = ((p.viirs ?? 0) / scale) * upH;
          const mh = (modisVal(p) / scale) * downH;
          return (
            <g key={p.date} onMouseEnter={() => setHover(i)} onClick={() => onSelectDate?.(p.date)} style={{ cursor: onSelectDate ? 'pointer' : undefined }}>
              <rect x={x} y={0} width={bw} height={height} fill="transparent" />
              {missingV ? <rect x={x + bw * 0.12} y={mid - upH * 0.25} width={bw * 0.76} height={upH * 0.25} fill={`url(#h${gid})`} />
                : <rect x={x + bw * 0.12} y={mid - vh - 1} width={bw * 0.76} height={vh} fill={SENSOR_COLORS.VIIRS} opacity={p.anomaly ? 1 : 0.82} rx={0.6} />}
              {missingM ? <rect x={x + bw * 0.12} y={mid + 1} width={bw * 0.76} height={downH * 0.25} fill={`url(#h${gid})`} />
                : <rect x={x + bw * 0.12} y={mid + 1} width={bw * 0.76} height={mh} fill={SENSOR_COLORS.MODIS} opacity={0.82} rx={0.6} />}
              {p.anomaly && <circle cx={x + bw / 2} cy={6} r={2.2} fill={CATEGORY.anomaly.color} />}
            </g>
          );
        })}
        <polyline
          fill="none"
          stroke={SENSOR_COLORS.harmonized}
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
          points={points.map((p, i) => (p.index === null ? null : `${i * bw + bw / 2},${mid - p.index * upH}`)).filter(Boolean).join(' ')}
          opacity={0.9}
        />
        <line x1={0} x2={width} y1={mid} y2={mid} stroke="rgba(220,235,255,0.35)" vectorEffect="non-scaling-stroke" />
        {idx >= 0 && <rect x={idx * bw} y={0} width={bw} height={height} fill="none" stroke="#f2fbff" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {hover !== null && <rect x={hover * bw} y={0} width={bw} height={height} fill="rgba(255,255,255,0.06)" />}
      </svg>
      <div className="sensor-chart__axis">
        <span>{points[0] ? formatDate(points[0].date) : ''}</span>
        <span>{points[n - 1] ? formatDate(points[n - 1].date) : ''}</span>
      </div>
      {hp && (
        <div className="sensor-chart__readout" aria-live="polite">
          <strong>{formatDate(hp.date)}</strong>
          <span style={{ color: SENSOR_COLORS.VIIRS }}>VIIRS {hp.viirs ?? '—'}</span>
          <span style={{ color: SENSOR_COLORS.MODIS }}>MODIS {hp.modis ?? '—'}{calibrated && hp.modis !== null ? ` (×${calibrationFactor} = ${(hp.modis * calibrationFactor).toFixed(1)})` : ''}</span>
          <span>Índice {hp.index === null ? '—' : hp.index.toFixed(2)}</span>
          {hp.availability !== 'observed' && <span className="muted">{hp.availability === 'missing' ? 'sin observación' : 'observación parcial'}</span>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export type CalendarMetric = 'harmonized' | 'viirs' | 'modis';

export function CalendarHeatmap({
  points, year, metric, selectedDate, onSelect, compact = false,
}: {
  points: SeriesPoint[];
  year: number;
  metric: CalendarMetric;
  selectedDate: string;
  onSelect?: (date: string) => void;
  compact?: boolean;
}) {
  const gid = useId().replace(/:/g, '');
  const cell = compact ? 9 : 11;
  const gap = 2;
  const byDate = useMemo(() => new Map(points.map((p) => [p.date, p])), [points]);
  const first = `${year}-01-01`;
  const offset = weekday(first); // 0 = domingo
  const days: { date: string; col: number; row: number }[] = [];
  const start = new Date(`${first}T00:00:00Z`);
  for (let i = 0; i < 366; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    if (d.getUTCFullYear() !== year) break;
    const iso = d.toISOString().slice(0, 10);
    const k = i + offset;
    days.push({ date: iso, col: Math.floor(k / 7), row: k % 7 });
  }
  const cols = (days.at(-1)?.col ?? 52) + 1;
  const maxCount = Math.max(1, ...points.map((p) => (metric === 'viirs' ? p.viirs ?? 0 : metric === 'modis' ? p.modis ?? 0 : 0)));
  const colorFor = (p: SeriesPoint | undefined): { fill: string; opacity: number } => {
    if (!p) return { fill: 'rgba(120,140,170,0.06)', opacity: 1 };
    if (p.availability === 'missing') return { fill: `url(#h${gid})`, opacity: 1 };
    let idx: number;
    if (metric === 'harmonized') idx = p.index ?? 0;
    else {
      const v = metric === 'viirs' ? p.viirs : p.modis;
      if (v === null) return { fill: `url(#h${gid})`, opacity: 1 };
      idx = v / maxCount;
    }
    if (idx <= 0) return { fill: 'rgba(110,135,175,0.16)', opacity: 1 };
    const kind = kindFromIndex(metric === 'harmonized' ? idx : Math.min(0.99, idx * 0.9 + 0.05));
    return { fill: CATEGORY[kind].color, opacity: 0.45 + Math.min(1, idx) * 0.55 };
  };
  const width = cols * (cell + gap) + 22;
  const height = 7 * (cell + gap) + 16;
  const monthCols: { m: number; col: number }[] = [];
  days.forEach((d) => {
    if (d.date.endsWith('-01')) monthCols.push({ m: Number(d.date.slice(5, 7)), col: d.col });
  });
  return (
    <svg className="calendar-heatmap" viewBox={`0 0 ${width} ${height}`} width="100%" role="grid" aria-label={`Calendario de actividad ${year}`}>
      <HatchDefs id={`h${gid}`} color="rgba(170,190,220,0.6)" />
      {monthCols.map(({ m, col }) => (
        <text key={m} x={22 + col * (cell + gap)} y={9} className="calendar-heatmap__month">{monthShort(m)}</text>
      ))}
      {['', 'L', '', 'X', '', 'V', ''].map((d, i) => (
        <text key={i} x={0} y={16 + i * (cell + gap) + cell - 2} className="calendar-heatmap__dow">{d}</text>
      ))}
      {days.map((d) => {
        const p = byDate.get(d.date);
        const { fill, opacity } = colorFor(p);
        const selected = d.date === selectedDate;
        const label = p
          ? `${formatDate(d.date)} · VIIRS ${p.viirs ?? '—'} · MODIS ${p.modis ?? '—'} · índice ${p.index === null ? 'sin observación' : p.index.toFixed(2)}${p.anomaly ? ' · anomalía' : ''}`
          : `${formatDate(d.date)} · fuera del rango de datos`;
        return (
          <g key={d.date}>
            <rect
              x={22 + d.col * (cell + gap)}
              y={14 + d.row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              fill={fill}
              opacity={opacity}
              stroke={selected ? '#ffffff' : p?.anomaly ? CATEGORY.anomaly.color : 'none'}
              strokeWidth={selected ? 1.6 : 1}
              className={onSelect && p ? 'is-clickable' : undefined}
              onClick={() => p && onSelect?.(d.date)}
            >
              <title>{label}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
export function Gauge({ value, label, color = CATEGORY.forecast.color }: { value: number | null; label: string; color?: string }) {
  const r = 52;
  const c = Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <svg className="gauge" viewBox="0 0 140 84" width="100%" role="img" aria-label={`${label}: ${value === null ? 'sin datos' : `${Math.round(v * 100)} %`}`}>
      <path d={`M18 74 A${r} ${r} 0 0 1 122 74`} fill="none" stroke="rgba(160,180,220,0.15)" strokeWidth="9" strokeLinecap="round" />
      <path d={`M18 74 A${r} ${r} 0 0 1 122 74`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      {[0.2, 0.5].map((t) => {
        const a = Math.PI * (1 - t);
        return <line key={t} x1={70 + Math.cos(a) * 44} y1={74 - Math.sin(a) * 44} x2={70 + Math.cos(a) * 60} y2={74 - Math.sin(a) * 60} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />;
      })}
      <text x="70" y="66" textAnchor="middle" className="gauge__value">{value === null ? '—' : v > 0.99 ? '>99%' : v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`}</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
export function ContributionBars({ items }: { items: { label: string; contribution: number | null | undefined; value: string }[] }) {
  const max = Math.max(0.2, ...items.map((i) => Math.abs(i.contribution ?? 0)));
  return (
    <ul className="contrib">
      {items.map((it) => {
        const c = it.contribution ?? 0;
        const w = (Math.abs(c) / max) * 50;
        return (
          <li key={it.label} className="contrib__row">
            <span className="contrib__label">{it.label}</span>
            <span className="contrib__bar" aria-hidden="true">
              <span className="contrib__axis" />
              <span className={`contrib__fill ${c >= 0 ? 'is-pos' : 'is-neg'}`} style={{ width: `${w}%`, [c >= 0 ? 'left' : 'right']: '50%' } as React.CSSProperties} />
            </span>
            <span className="contrib__value">{it.value}</span>
            <span className="contrib__num">{it.contribution == null ? '—' : `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(2)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
export function MiniHistogram({ bins, color = CATEGORY.forecast.color, label }: { bins: number[]; color?: string; label: string }) {
  const max = Math.max(1, ...bins);
  return (
    <div className="mini-hist" role="img" aria-label={label}>
      {bins.map((b, i) => (
        <span key={i} className="mini-hist__bar" style={{ height: `${Math.max(2, (b / max) * 100)}%`, background: color, opacity: 0.35 + (i / bins.length) * 0.65 }} title={`${i * 10}–${i * 10 + 10} %: ${b} celdas`} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function ScatterSensors({ points, factor }: { points: SeriesPoint[]; factor: number }) {
  const data = points.filter((p) => p.modis !== null && p.viirs !== null && (p.modis > 0 || (p.viirs ?? 0) > 0));
  const max = Math.max(4, ...data.map((p) => Math.max(p.viirs ?? 0, (p.modis ?? 0) * factor)));
  const s = (v: number) => 8 + (Math.log1p(v) / Math.log1p(max)) * 132;
  return (
    <svg className="scatter" viewBox="0 0 150 150" width="100%" role="img" aria-label="Relación diaria VIIRS frente a MODIS calibrado (escala logarítmica)">
      <rect x="8" y="8" width="134" height="134" fill="none" stroke="rgba(160,180,220,0.18)" />
      <line x1={8} y1={142} x2={142} y2={8} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
      {data.map((p) => (
        <circle key={p.date} cx={s((p.modis ?? 0) * factor)} cy={150 - s(p.viirs ?? 0)} r={2.4} fill={p.anomaly ? CATEGORY.anomaly.color : SENSOR_COLORS.VIIRS} opacity={0.7} />
      ))}
      <text x="140" y="148" textAnchor="end" className="scatter__axis">MODIS × k</text>
      <text x="10" y="18" className="scatter__axis">VIIRS</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Dibuja barras en lugar de línea (útil para el valor observado). */
  bars?: boolean;
}

/** Varias series sobre el mismo eje X. null corta la línea (sensor no operativo, no es cero). */
export function LineChart({
  labels, series, shade, height = 150, format = (v) => v.toLocaleString('es-BO', { maximumFractionDigits: 0 }), ariaLabel,
}: {
  labels: string[];
  series: LineSeries[];
  /** Tramo sombreado [desde, hasta] (índices) con su leyenda, p. ej. años extrapolados. */
  shade?: { from: number; to: number; label: string };
  height?: number;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const n = labels.length;
  const bw = width / Math.max(1, n);
  const max = Math.max(1e-6, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const top = 10;
  const y = (v: number) => height - 4 - (v / max) * (height - 4 - top);
  const x = (i: number) => i * bw + bw / 2;
  const path = (values: (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const h = hover ?? n - 1;
  return (
    <div className="sensor-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img"
        aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <HatchDefs id={`h${gid}`} />
        {shade && shade.to >= shade.from && (
          <rect x={shade.from * bw} y={0} width={(shade.to - shade.from + 1) * bw} height={height} fill={`url(#h${gid})`} opacity={0.5} />
        )}
        {series.filter((s) => s.bars).map((s) => s.values.map((v, i) => v === null ? null : (
          <rect key={`${s.label}${i}`} x={i * bw + bw * 0.18} y={y(v)} width={bw * 0.64} height={Math.max(0, height - 4 - y(v))}
            fill={s.color} opacity={0.55} rx={0.6} />
        )))}
        {series.filter((s) => !s.bars).map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="1.7"
            strokeDasharray={s.dashed ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {labels.map((_, i) => (
          <rect key={i} x={i * bw} y={0} width={bw} height={height} fill={i === hover ? 'rgba(255,255,255,0.06)' : 'transparent'}
            onMouseEnter={() => setHover(i)} />
        ))}
        <line x1={0} x2={width} y1={height - 4} y2={height - 4} stroke="rgba(220,235,255,0.35)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sensor-chart__axis">
        <span>{labels[0] ?? ''}</span>
        {shade && <span className="muted">{shade.label}</span>}
        <span>{labels[n - 1] ?? ''}</span>
      </div>
      {n > 0 && (
        <div className="sensor-chart__readout" aria-live="polite">
          <strong>{labels[h]}</strong>
          {series.map((s) => (
            <span key={s.label} style={{ color: s.color }}>{s.label} {s.values[h] === null ? '—' : format(s.values[h]!)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function yearsInRange(start: string, end: string): number[] {
  const out: number[] = [];
  for (let y = yearOf(start); y <= yearOf(end); y++) out.push(y);
  return out;
}
