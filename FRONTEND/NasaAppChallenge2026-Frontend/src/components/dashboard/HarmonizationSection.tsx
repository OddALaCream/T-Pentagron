'use client';
/**
 * Modelo A FireSight en el inspector (solo modo API, zona piloto):
 *  1. Discrepancia diaria: lo que VIIRS S-NPP habría visto según MODIS, frente a lo que vio.
 *  2. Serie 2001–2025 en escala S-NPP: antes de 2012 no hay VIIRS y solo existe gracias al Modelo A.
 */
import { useMemo } from 'react';
import { useHarmonization, useLongSeries } from '@/hooks/data';
import { formatDate } from '@/lib/time/dates';
import { SENSOR_COLORS } from '@/lib/science/categories';
import { LineChart } from '@/components/charts/charts';
import { Note, SectionTitle, Stat } from '@/components/ui/primitives';
import type { ISODate, SeriesTarget } from '@/lib/types/domain';

const C = { snpp: SENSOR_COLORS.VIIRS, eq: SENSOR_COLORS.harmonized, modis: SENSOR_COLORS.MODIS };
const n0 = (v: number | null) => (v === null ? '—' : v.toLocaleString('es-BO', { maximumFractionDigits: 0 }));

export function HarmonizationSection({ target, from, to }: { target: SeriesTarget; from: ISODate; to: ISODate }) {
  const { data: daily, isFetching } = useHarmonization(target, from, to);
  const { data: long } = useLongSeries(target);

  const longView = useMemo(() => {
    if (!long) return null;
    const pts = long.points;
    const lastExtrap = pts.reduce((k, p, i) => (p.extrapolated ? i : k), -1);
    const peak = pts.reduce((b, p) => ((p.modisEq ?? 0) > (b?.modisEq ?? 0) ? p : b), pts[0]);
    const overlap = pts.filter((p) => p.viirsSnpp !== null && p.modisEq !== null);
    const sv = overlap.reduce((a, p) => a + p.viirsSnpp!, 0);
    const se = overlap.reduce((a, p) => a + p.modisEq!, 0);
    return { pts, lastExtrap, peak, biasPct: sv > 0 ? (100 * (se - sv)) / sv : null, overlapYears: overlap.length };
  }, [long]);

  if (daily === null && long === null) {
    return (
      <div data-holo-item>
        <SectionTitle>Modelo A · armonización MODIS → VIIRS</SectionTitle>
        <Note>Sin datos del Modelo A para esta selección. Cubre solo la zona piloto (Chiquitanía); si la selección está dentro de ella, faltan los datos del release: correr <code>python scripts/descargar_datos.py</code> y reiniciar el backend.</Note>
      </div>
    );
  }

  return (
    <>
      {daily && (
        <div data-holo-item>
          <SectionTitle aside={<span className="muted small">{daily.cellCount.toLocaleString('es-BO')} celdas · {daily.version}</span>}>
            Modelo A · MODIS armonizado frente a VIIRS S-NPP
          </SectionTitle>
          <div className={`chart-card ${isFetching ? 'is-loading' : ''}`}>
            <div className="chart-card__legend">
              <span><i style={{ background: C.snpp }} /> S-NPP observado</span>
              <span><i className="line" style={{ background: C.eq }} /> MODIS armonizado</span>
              <span><i className="line" style={{ background: C.modis }} /> MODIS crudo</span>
            </div>
            <LineChart
              ariaLabel="Detecciones diarias: VIIRS S-NPP observado, MODIS armonizado por el Modelo A y MODIS original"
              labels={daily.points.map((p) => formatDate(p.date))}
              series={[
                { label: 'S-NPP', color: C.snpp, values: daily.points.map((p) => p.viirsSnpp), bars: true },
                { label: 'MODIS arm.', color: C.eq, values: daily.points.map((p) => p.modisEq) },
                { label: 'MODIS', color: C.modis, values: daily.points.map((p) => p.modis), dashed: true },
              ]}
            />
          </div>
          <div className="stats-grid">
            <Stat label="S-NPP observado" value={n0(daily.summary.viirsSnppTotal)} tone={C.snpp} />
            <Stat label="MODIS armonizado" value={n0(daily.summary.modisEqTotal)} tone={C.eq}
              hint="Lo que S-NPP habría registrado según el MODIS de cada día (Modelo A)" />
            <Stat label="Error del armonizado" value={daily.summary.biasPct === null ? '—' : `${daily.summary.biasPct > 0 ? '+' : ''}${daily.summary.biasPct.toFixed(1)}`}
              unit="%" hint="(MODIS armonizado − S-NPP) / S-NPP en los días con ambos sensores" />
            <Stat label="MODIS crudo" value={n0(daily.summary.modisTotal)} tone={C.modis}
              hint={daily.summary.rawRatio === null ? undefined : `Sin armonizar, S-NPP ve ${daily.summary.rawRatio.toFixed(1)}× lo que ve MODIS`} />
          </div>
          {daily.summary.convertedCellDays > 0 && (
            <p className="muted small">{daily.summary.convertedCellDays.toLocaleString('es-BO')} celdas-día sin VIIRS: ahí el armonizado reemplaza al VIIRS.</p>
          )}
        </div>
      )}

      {longView && (
        <div data-holo-item>
          <SectionTitle aside={<span className="muted small">escala S-NPP · {long!.version}</span>}>
            Serie 2001–2025 · un solo registro para los dos sensores
          </SectionTitle>
          <div className="chart-card">
            <div className="chart-card__legend">
              <span><i style={{ background: C.snpp }} /> S-NPP observado (desde 2012)</span>
              <span><i className="line" style={{ background: C.eq }} /> MODIS armonizado</span>
              <span><i className="line" style={{ background: C.modis }} /> MODIS crudo</span>
            </div>
            <LineChart
              ariaLabel="Detecciones anuales 2001-2025 en escala VIIRS S-NPP: MODIS armonizado, S-NPP observado y MODIS original"
              labels={longView.pts.map((p) => p.period)}
              shade={longView.lastExtrap >= 0 ? { from: 0, to: longView.lastExtrap, label: 'sin VIIRS: extrapolado' } : undefined}
              series={[
                { label: 'S-NPP', color: C.snpp, values: longView.pts.map((p) => p.viirsSnpp), bars: true },
                { label: 'MODIS arm.', color: C.eq, values: longView.pts.map((p) => p.modisEq) },
                { label: 'MODIS', color: C.modis, values: longView.pts.map((p) => p.modis), dashed: true },
              ]}
            />
          </div>
          <div className="stats-grid">
            <Stat label="Año con más actividad" value={longView.peak?.period ?? '—'} hint={`${n0(longView.peak?.modisEq ?? null)} detecciones VIIRS-equivalentes`} />
            <Stat label="Error en años con VIIRS" value={longView.biasPct === null ? '—' : `${longView.biasPct > 0 ? '+' : ''}${longView.biasPct.toFixed(1)}`}
              unit="%" hint={`Suma ${longView.overlapYears} años con S-NPP: (MODIS armonizado − S-NPP) / S-NPP`} />
          </div>
          <Note>
            {long!.notes.join(' ')} La incertidumbre por año está en la API (campo uncertainty) y es heurística: no se dibuja como intervalo.
          </Note>
        </div>
      )}
    </>
  );
}
