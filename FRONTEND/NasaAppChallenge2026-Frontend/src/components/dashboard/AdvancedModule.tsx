'use client';
import { useMemo, useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { useCellInfo, useDetections, useMetadata, useSeries } from '@/hooks/data';
import { formatDate, yearOf } from '@/lib/time/dates';
import { formatLatLng, shortH3 } from '@/lib/geo/h3';
import { useStore } from '@/state/store';
import { Note } from '@/components/ui/primitives';
import type { SeriesPoint } from '@/lib/types/domain';
import type { TargetInfo } from './useTarget';

function Expandable({ title, children, defaultOpen = false, aside }: { title: string; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`expandable ${open ? 'is-open' : ''}`} data-holo-item>
      <button type="button" className="expandable__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        {aside}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && <div className="expandable__body">{children}</div>}
    </section>
  );
}

function toCsv(points: SeriesPoint[], id: string): string {
  const header = 'objetivo,date,modis_detected,viirs_detected,activity_index,availability_flag,is_anomaly,modis_frp_sum,viirs_frp_sum,fuente';
  const rows = points.map((p) =>
    [id, p.date, p.modis ?? '', p.viirs ?? '', p.index === null ? '' : p.index.toFixed(4), p.availability, p.anomaly, p.modisFrp ?? '', p.viirsFrp ?? '', 'demo'].join(','),
  );
  return [header, ...rows].join('\n');
}

export function AdvancedModule({ info }: { info: TargetInfo }) {
  const date = useStore((s) => s.date);
  const range = useStore((s) => s.dataRange);
  const setDate = useStore((s) => s.setDate);
  const { data: cell } = useCellInfo(info.h3);
  const { data: meta } = useMetadata();
  const native = info.kind === 'cell' && info.resolution === 6;
  const { data: detections, isFetching: loadingDet } = useDetections(native ? info.h3 : null, date);
  const { data: full } = useSeries(info.target, range.start, range.end);

  const yearly = useMemo(() => {
    const map = new Map<number, { viirs: number; modis: number; active: number; missing: number; anomalies: number; maxFrp: number; peak: SeriesPoint | null }>();
    for (const p of full ?? []) {
      const y = yearOf(p.date);
      const s = map.get(y) ?? { viirs: 0, modis: 0, active: 0, missing: 0, anomalies: 0, maxFrp: 0, peak: null };
      s.viirs += p.viirs ?? 0;
      s.modis += p.modis ?? 0;
      if ((p.index ?? 0) > 0) s.active++;
      if (p.availability === 'missing') s.missing++;
      if (p.anomaly) s.anomalies++;
      s.maxFrp = Math.max(s.maxFrp, (p.viirsFrp ?? 0) + (p.modisFrp ?? 0));
      if ((p.viirs ?? 0) > (s.peak?.viirs ?? 0)) s.peak = p;
      map.set(y, s);
    }
    return [...map.entries()];
  }, [full]);

  const recent = (full ?? []).filter((p) => p.date <= date).slice(-30).reverse();
  const id = info.h3 ?? info.region?.id ?? 'objetivo';

  const download = () => {
    if (!full) return;
    const blob = new Blob([toCsv(full, id)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serie_demo_${id}_${range.start}_${range.end}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="module">
      <Expandable title="Información de la celda / región" defaultOpen>
        <dl className="kv kv--tight">
          {cell ? (
            <>
              <div><dt>h3_id</dt><dd className="mono">{cell.h3_id}</dd></div>
              <div><dt>Resolución</dt><dd>{cell.resolution} {cell.resolution === 6 ? '(nativa del piloto)' : '(agregada)'}</dd></div>
              <div><dt>Área</dt><dd>{cell.areaKm2.toFixed(1)} km²</dd></div>
              <div><dt>Centro</dt><dd className="mono">{formatLatLng(cell.center, 4)}</dd></div>
              <div><dt>Padres</dt><dd className="mono">{cell.parents.map((p) => `r${p.resolution}: ${shortH3(p.h3_id)}`).join(' · ')}</dd></div>
              <div><dt>Vecinos (anillo 1)</dt><dd>{cell.neighbors.length} celdas</dd></div>
              <div><dt>Vértices del límite</dt><dd>{cell.boundary.length - 1} (GeoJSON cerrado)</dd></div>
            </>
          ) : info.region ? (
            <>
              <div><dt>Región</dt><dd>{info.region.name} · {info.region.admin}, {info.region.country}</dd></div>
              <div><dt>Bioma</dt><dd>{info.region.biome}</dd></div>
              <div><dt>Celdas H3 res 6</dt><dd>{info.region.cellCount} (~{Math.round(info.region.cellCount * 36.13).toLocaleString('es')} km²)</dd></div>
              <div><dt>Temporada típica</dt><dd>{info.region.seasonLabel}</dd></div>
              <div><dt>Huso horario</dt><dd>UTC{info.region.utcOffset >= 0 ? '+' : ''}{info.region.utcOffset}</dd></div>
              <div><dt>Descripción</dt><dd>{info.region.description}</dd></div>
            </>
          ) : null}
        </dl>
      </Expandable>

      <Expandable title="Origen de los registros">
        <dl className="kv kv--tight">
          <div><dt>Fuente</dt><dd>{meta?.source === 'mock' ? 'Generador de demostración (sin backend)' : 'Backend FastAPI'}</dd></div>
          <div><dt>Generador</dt><dd className="mono">{meta?.generator ?? '—'}</dd></div>
          <div><dt>Rango de fechas</dt><dd>{meta ? `${formatDate(meta.dateRange.start)} – ${formatDate(meta.dateRange.end)}` : '—'}</dd></div>
          {meta?.products.map((p) => (
            <div key={p.sensor}><dt>{p.sensor}</dt><dd>{p.product} · píxel ~{p.resolutionMeters} m · {p.satellites.join(', ')}</dd></div>
          ))}
          <div><dt>Armonización</dt><dd>{meta?.harmonization.method}</dd></div>
          <div><dt>Versión</dt><dd>SP (estándar) para fechas &gt; 90 días; NRT (casi tiempo real) para las recientes</dd></div>
        </dl>
        {meta && <Note tone="demo">{meta.disclaimer}</Note>}
      </Expandable>

      <Expandable title={`Detecciones del ${formatDate(date)}`} defaultOpen={native} aside={native && detections ? <span className="badge">{detections.length}</span> : null}>
        {!native ? (
          <p className="muted small">Las detecciones individuales se consultan a resolución H3 6. Selecciona una celda nativa (acércate al planeta).</p>
        ) : loadingDet ? (
          <p className="muted small">Cargando…</p>
        ) : detections && detections.length ? (
          <div className="table-scroll">
            <table className="data-table data-table--dense">
              <thead>
                <tr><th>UTC</th><th>Sensor</th><th>Satélite</th><th>FRP (MW)</th><th>Conf.</th><th>Lat, Lon</th><th>D/N</th><th>Ver.</th></tr>
              </thead>
              <tbody>
                {detections.map((d, i) => (
                  <tr key={i}>
                    <td className="mono">{d.date_utc.slice(11, 16)}</td>
                    <td>{d.sensor}</td>
                    <td>{d.satellite}</td>
                    <td className="mono">{d.frp.toFixed(1)}</td>
                    <td className="mono">{d.confidence}</td>
                    <td className="mono">{d.latitude.toFixed(3)}, {d.longitude.toFixed(3)}</td>
                    <td>{d.daynight ?? '—'}</td>
                    <td>{d.version ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Sin detecciones registradas este día (o sin observación válida).</p>
        )}
      </Expandable>

      <Expandable title="Estadísticas históricas por año">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Año</th><th>VIIRS</th><th>MODIS</th><th>Días activos</th><th>Anomalías</th><th>Sin obs.</th><th>FRP máx.</th><th>Pico</th></tr>
            </thead>
            <tbody>
              {yearly.map(([y, s]) => (
                <tr key={y}>
                  <th>{y}</th><td>{s.viirs}</td><td>{s.modis}</td><td>{s.active}</td><td>{s.anomalies}</td><td>{s.missing}</td>
                  <td>{Math.round(s.maxFrp)}</td>
                  <td>{s.peak ? <button type="button" className="link" onClick={() => setDate(s.peak!.date)}>{formatDate(s.peak.date)}</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Expandable>

      <Expandable title="Serie completa" aside={<span className="badge">{full?.length ?? 0} días</span>}>
        <div className="action-row">
          <button type="button" className="btn" onClick={download} disabled={!full}>
            <Download size={14} /> Descargar CSV (demo)
          </button>
        </div>
        <div className="table-scroll table-scroll--tall">
          <table className="data-table data-table--dense">
            <thead>
              <tr><th>Fecha</th><th>VIIRS</th><th>MODIS</th><th>Índice</th><th>Disponibilidad</th><th>Anomalía</th></tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.date} className={p.date === date ? 'is-current' : ''}>
                  <td><button type="button" className="link" onClick={() => setDate(p.date)}>{formatDate(p.date)}</button></td>
                  <td>{p.viirs ?? '—'}</td><td>{p.modis ?? '—'}</td><td>{p.index === null ? '—' : p.index.toFixed(2)}</td>
                  <td>{p.availability === 'observed' ? 'observada' : p.availability === 'partial' ? 'parcial' : 'sin observación'}</td>
                  <td>{p.anomaly ? 'sí' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Se muestran los 30 días previos a la fecha seleccionada; el CSV incluye toda la serie.</p>
      </Expandable>

      <Expandable title="Limitaciones de observación">
        <ul className="limits">
          <li>Un registro ausente en FIRMS no equivale a «no hubo incendio»: puede deberse a nubes, humo denso, hora de paso o umbral de detección.</li>
          <li>Las detecciones son focos térmicos (píxeles calientes), no incendios confirmados ni superficie quemada.</li>
          <li>VIIRS (~375 m) y MODIS (~1 km) tienen sensibilidades distintas; compararlos requiere armonización.</li>
          <li>Las variables meteorológicas (NASA POWER) tienen una grilla más gruesa que H3 resolución 6.</li>
          <li>Los focos satelitales tienen precisión limitada y no deben ser el único recurso para proteger vidas o bienes.</li>
        </ul>
      </Expandable>
    </div>
  );
}
