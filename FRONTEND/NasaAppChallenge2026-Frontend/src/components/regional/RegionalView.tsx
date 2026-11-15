'use client';
/**
 * Vista regional (tras la inmersión): mapa detallado, datos locales, clima y espacio
 * reservado para noticias. Funcional con datos de demostración.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowLeft, CloudRain, Layers, Newspaper, Thermometer, Wind, Droplets, MapPinned, Satellite, Telescope } from 'lucide-react';
import { useGlobeSnapshot, useNews, useRegionMap, useWeather } from '@/hooks/data';
import { addDays, formatDate } from '@/lib/time/dates';
import { CATEGORY, classify, LAYERS } from '@/lib/science/categories';
import { formatLatLng, shortH3 } from '@/lib/geo/h3';
import { isReducedMotion, useArchiveYears, useStore } from '@/state/store';
import { DemoBadge, Note, SectionTitle, Segmented, Stat, Toggle } from '@/components/ui/primitives';
import { SymbolIcon } from '@/components/ui/SymbolIcon';
import { Sparkline } from '@/components/charts/charts';
import { TimelineDock } from '@/components/observatory/TimelineDock';
import { RegionalMap } from './RegionalMap';
import { BASEMAPS, type BasemapId } from './basemaps';
import type { CellActivity } from '@/lib/types/domain';
import { env } from '@/config/env';

export function RegionalView() {
  const regionalId = useStore((s) => s.regionalId);
  const date = useStore((s) => s.date);
  const years = useArchiveYears();
  const layer = useStore((s) => s.layer);
  const setLayer = useStore((s) => s.setLayer);
  const granularity = useStore((s) => s.granularity);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setTransition = useStore((s) => s.setTransition);
  const transition = useStore((s) => s.transition);
  const regions = useRegionMap();
  const region = regionalId ? regions[regionalId] : undefined;
  const { data: snap } = useGlobeSnapshot();
  const [basemap, setBasemap] = useState<BasemapId>(BASEMAPS[0].available ? 'gibs-viirs' : 'none');
  const [labels, setLabels] = useState(true);
  const [tileError, setTileError] = useState(false);
  const [focusH3, setFocusH3] = useState<string | null>(null);
  const { data: weather } = useWeather(regionalId, addDays(date, -29), date);
  const { data: news } = useNews(regionalId);
  const ref = useRef<HTMLDivElement>(null);

  const records = useMemo(() => (snap?.records ?? []).filter((r) => r.regionId === regionalId), [snap, regionalId]);
  const totals = snap && regionalId ? snap.byRegion[regionalId] : undefined;
  const ranked = useMemo(() => {
    const value = (r: CellActivity) =>
      layer === 'prediction' ? r.probability ?? 0 : layer === 'modis' ? r.modis_detected ?? 0 : layer === 'viirs' ? r.viirs_detected ?? 0 : r.activity_index ?? 0;
    return [...records].filter((r) => value(r) > 0).sort((a, b) => value(b) - value(a)).slice(0, 8);
  }, [records, layer]);
  const selectedRecord = selection?.kind === 'cell' ? records.find((r) => r.h3_id === selection.h3) : undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll('[data-reveal-regional]');
    const tl = gsap.timeline({ delay: isReducedMotion() ? 0 : 0.35 });
    tl.fromTo(items, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: isReducedMotion() ? 0.2 : 0.7, ease: 'expo.out', stagger: 0.06, clearProps: 'transform' });
    return () => {
      tl.kill();
    };
  }, [regionalId]);

  if (!region) return null;
  const rain7 = weather?.slice(-7).reduce((a, w) => a + w.precipitation, 0) ?? null;
  const last = weather?.at(-1);
  const basemapDef = BASEMAPS.find((b) => b.id === basemap);

  return (
    <div ref={ref} className={`regional ${transition === 'leaving' ? 'is-leaving' : ''}`} role="main" aria-label={`Vista regional de ${region.name}`}>
      <header className="regional__head" data-reveal-regional>
        <button type="button" className="btn btn--ghost regional__back" onClick={() => setTransition('leaving')}>
          <ArrowLeft size={16} /> Observatorio global
        </button>
        <div className="regional__title">
          <span className="regional__eyebrow">{region.admin} · {region.country}{region.isPilot ? ' · zona piloto' : ''}</span>
          <h1>{region.name}</h1>
          <span className="regional__sub">{region.biome} · {formatLatLng(region.center, 2)} · H3 res {region.resolution} · {region.cellCount} celdas</span>
        </div>
        <div className="regional__tools">
          <Segmented label="Capa de datos" size="sm" value={layer} onChange={setLayer} options={LAYERS.map((l) => ({ value: l.id, label: l.short, accent: l.accent, title: l.description }))} />
          <DemoBadge compact />
        </div>
      </header>

      <div className="regional__grid">
        <section className="regional__map-card glass-crystal" data-reveal-regional aria-label="Mapa detallado">
          <div className="regional__map-toolbar">
            <div className="basemap-picker" role="radiogroup" aria-label="Mapa base">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={basemap === b.id}
                  className={`chip ${basemap === b.id ? 'is-on' : ''}`}
                  disabled={!b.available}
                  title={b.available ? b.description : b.unavailableReason}
                  onClick={() => {
                    setTileError(false);
                    setBasemap(b.id);
                  }}
                >
                  {b.id === 'gibs-viirs' ? <Satellite size={13} /> : b.id === 'google' ? <MapPinned size={13} /> : <Layers size={13} />} {b.label}
                </button>
              ))}
            </div>
            <Toggle label="Etiquetas" checked={labels} onChange={setLabels} disabled={basemap === 'none'} />
          </div>
          <RegionalMap
            region={region}
            records={records}
            layer={layer}
            granularity={granularity}
            date={date}
            basemap={basemap}
            showLabels={labels}
            selectedH3={selection?.kind === 'cell' ? selection.h3 : null}
            focusH3={focusH3}
            onSelect={(r) => select({ kind: 'cell', h3: r.h3_id, regionId: r.regionId, resolution: 6 }, { openPanel: false })}
            onTileError={() => setTileError(true)}
          />
          <div className="regional__map-foot">
            {basemapDef?.dateDependent && <span>Imagen satelital del {formatDate(date)} · celdas: {env.dataMode === 'api' ? `NASA FIRMS ${years}` : 'datos de demostración'}</span>}
            {tileError && <span className="warn">Algunas teselas no cargaron (sin conexión o sin imagen para esa fecha). La retícula H3 sigue disponible.</span>}
          </div>
        </section>

        <aside className="regional__side">
          <section className="glass-crystal regional__card" data-reveal-regional>
            <SectionTitle aside={<span className="muted small">{formatDate(date)}</span>}>Resumen local</SectionTitle>
            <div className="stats-grid">
              <Stat label="VIIRS" value={totals?.viirs ?? '—'} unit="det." />
              <Stat label="MODIS" value={totals?.modis ?? '—'} unit="det." />
              <Stat label="Celdas activas" value={totals?.activeCells ?? '—'} />
              <Stat label="Anomalías" value={totals?.anomalies ?? '—'} tone={CATEGORY.anomaly.color} />
            </div>
            <p className="muted small">
              {env.dataMode === 'api' ? 'Cobertura satelital desconocida. Se muestran celdas con detecciones en el archivo.' : `Cobertura: ${totals ? Math.round(((totals.observedCells + totals.partialCells * 0.5) / Math.max(1, totals.observedCells + totals.partialCells + totals.missingCells)) * 100) : '—'} % de celdas con observación válida.`}
            </p>
          </section>

          <section className="glass-crystal regional__card" data-reveal-regional>
            <SectionTitle>{selectedRecord ? 'Celda seleccionada' : 'Celdas más activas'}</SectionTitle>
            {selectedRecord ? (
              <SelectedCell record={selectedRecord} onBack={() => select({ kind: 'region', regionId: region.id }, { openPanel: false })} />
            ) : ranked.length ? (
              <ol className="rank-list">
                {ranked.map((r) => {
                  const cls = classify(r, layer, granularity);
                  return (
                    <li key={r.h3_id}>
                      <button type="button" onClick={() => { setFocusH3(r.h3_id); select({ kind: 'cell', h3: r.h3_id, regionId: r.regionId, resolution: 6 }, { openPanel: false }); }}>
                        <SymbolIcon kind={cls.kind} size={13} />
                        <span className="mono">{shortH3(r.h3_id)}</span>
                        <span className="rank-list__bar"><i style={{ width: `${Math.min(100, cls.intensity * 100)}%`, background: CATEGORY[cls.kind].color }} /></span>
                        <span>{layer === 'prediction' ? `${Math.round((r.probability ?? 0) * 100)} %` : layer === 'harmonized' ? (r.activity_index ?? 0).toFixed(2) : layer === 'viirs' ? r.viirs_detected : r.modis_detected}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted small">Sin detecciones registradas para esta fecha y capa.</p>
            )}
          </section>

          <section className="glass-crystal regional__card" data-reveal-regional>
            <SectionTitle aside={<span className="badge">{env.dataMode === 'api' ? 'No disponible' : 'tipo NASA POWER · demo'}</span>}>Condiciones meteorológicas</SectionTitle>
            <div className="weather">
              <span><Thermometer size={14} /> {last ? `${last.temperature.toFixed(1)} °C` : '—'}</span>
              <span><CloudRain size={14} /> {rain7 === null ? '—' : `${rain7.toFixed(0)} mm / 7 d`}</span>
              <span><Droplets size={14} /> {last ? `${last.humidity} %` : '—'}</span>
              <span><Wind size={14} /> {last ? `${last.wind} m/s` : '—'}</span>
            </div>
            <Sparkline values={weather?.map((w) => w.precipitation) ?? []} color="#7eb6ff" height={34} label="Precipitación diaria de los últimos 30 días" />
            <p className="muted small">Precipitación diaria (30 días). La grilla meteorológica es más gruesa que H3 res 6.</p>
          </section>

          <section className="glass-crystal regional__card regional__news" data-reveal-regional>
            <SectionTitle aside={<span className="badge badge--pending">integración pendiente</span>}><Newspaper size={14} /> Noticias y reportes locales</SectionTitle>
            {news && news.length ? (
              <ul className="link-list">
                {news.map((n) => <li key={n.id}><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> <span className="muted small">{n.source}</span></li>)}
              </ul>
            ) : (
              <>
                <p className="muted small">
                  Este espacio mostrará noticias y reportes oficiales de la zona cuando se conecte una fuente verificada
                  (endpoint <code>/news?region={region.id}</code>). No se muestran noticias inventadas.
                </p>
                <div className="news-skeleton" aria-hidden="true"><span /><span /><span /></div>
              </>
            )}
          </section>
        </aside>
      </div>

      <div className="regional__timeline" data-reveal-regional>
        <TimelineDock compact measure={false} />
      </div>
    </div>
  );
}

function SelectedCell({ record, onBack }: { record: CellActivity; onBack: () => void }) {
  const layer = useStore((s) => s.layer);
  const granularity = useStore((s) => s.granularity);
  const setTransition = useStore((s) => s.setTransition);
  const setPanel = useStore((s) => s.setPanel);
  const cls = classify(record, layer, granularity);
  return (
    <div className="selected-cell">
      <div className="category-pill" style={{ '--pill': CATEGORY[cls.kind].color } as React.CSSProperties}>
        <SymbolIcon kind={cls.kind} size={14} animated /> {CATEGORY[cls.kind].label}
      </div>
      <dl className="kv kv--tight">
        <div><dt>H3</dt><dd className="mono">{record.h3_id}</dd></div>
        <div><dt>Centro</dt><dd className="mono">{formatLatLng(record.center)}</dd></div>
        <div><dt>VIIRS / MODIS</dt><dd>{record.viirs_detected ?? '—'} / {record.modis_detected ?? '—'}</dd></div>
        <div><dt>Índice armonizado</dt><dd>{record.activity_index === null ? 'sin observación' : record.activity_index.toFixed(2)}</dd></div>
        {record.probability != null && <div><dt>Prob. día siguiente</dt><dd>{Math.round(record.probability * 100)} % (experimental)</dd></div>}
        <div><dt>Disponibilidad</dt><dd>{record.availability_flag}</dd></div>
      </dl>
      {record.availability_flag === 'missing' && <Note tone="warn">Sin observación válida: no equivale a ausencia de actividad.</Note>}
      <div className="action-row">
        <button type="button" className="btn btn--primary" onClick={() => { setPanel({ open: true, minimized: false, tab: 'summary' }); setTransition('leaving'); }}>
          <Telescope size={14} /> Analizar en el observatorio
        </button>
        <button type="button" className="btn btn--ghost" onClick={onBack}>Ver lista</button>
      </div>
    </div>
  );
}
