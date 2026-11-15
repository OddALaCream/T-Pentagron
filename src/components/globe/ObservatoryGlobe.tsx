'use client';
/**
 * Planeta interactivo del observatorio (react-globe.gl + motor propio).
 *
 * - Celdas H3 auténticas como polígonos GeoJSON (capa de polígonos de react-globe.gl).
 * - Resolución por zoom: res 4 / 5 / 6, con recorte de regiones fuera de la vista.
 * - Un clic: inspección (resalta, pausa rotación, orienta la cámara, abre paneles).
 * - Doble clic: inmersión regional (transición cinematográfica).
 */
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Material } from 'three';
import { latLngToCell } from 'h3-js';
import { appConfig } from '@/config/app';
import { env } from '@/config/env';
import { insideBolivia } from '@/lib/geo/bolivia';
import { useGlobeSnapshot, useRegions } from '@/hooks/data';
import { useViewport } from '@/hooks/useViewport';
import { CATEGORY } from '@/lib/science/categories';
import { angularDistance, formatLatLng, shortH3 } from '@/lib/geo/h3';
import { useReducedMotion, useStore } from '@/state/store';
import { POKE_LINES, useNarrator } from '@/state/narrator';
import { createEarthMaterial } from '@/scene/earth';
import { ObservatoryEngine } from '@/scene/observatoryEngine';
import { globeBridge } from '@/scene/bridge';
import { perchFor } from '@/scene/perch';
import {
  buildPolygons, buildSymbols, displayResolution, polygonAltitude, recordsAtResolution, regionGlances,
  symbolResolution, SYMBOL_ALT, type PolygonFeature,
} from '@/scene/globeModel';
import type { CellActivity, LatLng, Region } from '@/lib/types/domain';

interface RingDatum {
  lat: number;
  lng: number;
  color: string;
  maxR: number;
  speed: number;
  period: number;
  key: string;
  expires?: number;
}

interface CameraView {
  altitude: number;
  lat: number;
  lng: number;
  displayRes: number;
  symbolRes: number;
}

const hexToRgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const detailTiles = (x: number, y: number, z: number) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function formatValue(f: PolygonFeature, layer: string): string {
  const r = f.record;
  if (layer === 'prediction') return r.probability == null ? 'sin pronóstico' : `${Math.round(r.probability * 100)} % prob.`;
  if (layer === 'modis') return r.modis_detected == null ? 'sin observación MODIS' : `${r.modis_detected} det. MODIS`;
  if (layer === 'viirs') return r.viirs_detected == null ? 'sin observación VIIRS' : `${r.viirs_detected} det. VIIRS`;
  return r.activity_index == null ? 'sin observación' : `índice ${r.activity_index.toFixed(2)}`;
}

export default function ObservatoryGlobe() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const engineRef = useRef<ObservatoryEngine | null>(null);
  const [ready, setReady] = useState(false);
  const viewport = useViewport();
  const reduced = useReducedMotion();

  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const date = useStore((s) => s.date);
  const layer = useStore((s) => s.layer);
  const granularity = useStore((s) => s.granularity);
  const filters = useStore((s) => s.filters);
  const selection = useStore((s) => s.selection);
  const panelOpen = useStore((s) => s.panel.open && !s.panel.minimized);
  const panelExpanded = useStore((s) => s.panel.expanded);
  const scanNonce = useStore((s) => s.scanNonce);
  const fly = useStore((s) => s.fly);
  const playing = useStore((s) => s.playing);
  const say = useNarrator((s) => s.say);

  const quality = settings.quality;
  const earth = useMemo(() => createEarthMaterial(quality), [quality]);
  useEffect(() => () => earth.dispose(), [earth]);

  const { data: regionsData } = useRegions();
  const regions = useMemo(() => regionsData ?? [], [regionsData]);
  const { data: snapshot } = useGlobeSnapshot();
  const native = useMemo<CellActivity[]>(() => snapshot?.records ?? [], [snapshot]);

  /* ---------------- Cámara → resolución mostrada ---------------- */
  const [cam, setCam] = useState<CameraView>(() => ({
    altitude: appConfig.initialView.altitude,
    lat: appConfig.initialView.lat,
    lng: appConfig.initialView.lng,
    displayRes: 4,
    symbolRes: symbolResolution(appConfig.initialView.altitude, typeof window === 'undefined' ? 800 : window.innerHeight),
  }));
  const povRef = useRef(appConfig.initialView as { lat: number; lng: number; altitude: number });
  const camTimer = useRef<number | null>(null);
  const setCamera = useStore((s) => s.setCamera);

  const onZoom = useCallback(
    (pov: { lat: number; lng: number; altitude: number }) => {
      povRef.current = pov;
      if (camTimer.current !== null) return;
      camTimer.current = window.setTimeout(() => {
        camTimer.current = null;
        const p = povRef.current;
        setCam((prev) => {
          const displayRes = displayResolution(p.altitude, prev.displayRes, appConfig.resolutionThresholds);
          const symbolRes = symbolResolution(p.altitude, window.innerHeight);
          const moved = angularDistance(prev, p) > 0.12 || Math.abs(prev.altitude - p.altitude) / prev.altitude > 0.15;
          if (displayRes === prev.displayRes && symbolRes === prev.symbolRes && !moved) return prev;
          return { altitude: p.altitude, lat: p.lat, lng: p.lng, displayRes, symbolRes };
        });
        setCamera({ altitude: p.altitude, lat: p.lat, lng: p.lng });
      }, 140);
    },
    [setCamera],
  );

  const visibleRegions = useMemo(() => {
    if (cam.displayRes === 4) return null;
    const horizon = Math.acos(1 / (1 + cam.altitude)) + 0.12;
    return new Set(regions.filter((r) => angularDistance(r.center, cam) < horizon).map((r) => r.id));
  }, [regions, cam]);

  /* ---------------- Polígonos H3 ---------------- */
  const [hover, setHover] = useState<string | null>(null);
  // Caché de objetos de polígono estables (three-globe reutiliza la geometría por identidad).
  const [featureCache] = useState(() => new Map<string, PolygonFeature>());
  const resolutionSets = useMemo<Record<number, CellActivity[]>>(
    () => ({
      4: recordsAtResolution(native, 4, granularity),
      5: recordsAtResolution(native, 5, granularity),
      6: native,
    }),
    [native, granularity],
  );
  const recordsByRes = useCallback((res: number) => resolutionSets[res] ?? native, [resolutionSets, native]);

  const polygons = useMemo(() => {
    if (!native.length) return [];
    const list = buildPolygons(recordsByRes(cam.displayRes), {
      maxPolygons: cam.displayRes === 6 ? (viewport.width < 900 ? 100 : 220) : (viewport.width < 900 ? 40 : 60),
      layer, granularity, filters, res: cam.displayRes, visibleRegions, selection, hover,
    }, featureCache);
    // La celda seleccionada siempre se dibuja (aunque la resolución mostrada sea otra).
    if (selection?.kind === 'cell' && !list.some((f) => f.h3 === selection.h3)) {
      const rec = recordsByRes(selection.resolution).find((r) => r.h3_id === selection.h3);
      if (rec) {
        const extra = buildPolygons([rec], {
          layer, granularity, filters, res: selection.resolution, visibleRegions: null, selection, hover,
        }, featureCache);
        list.push(...extra);
      }
    }
    return list;
  }, [native, recordsByRes, cam.displayRes, layer, granularity, filters, visibleRegions, selection, hover, featureCache, viewport.width]);

  /* ---------------- Marcadores, retícula y regiones ---------------- */
  const symbols = useMemo(
    () => buildSymbols(native, { layer, granularity, filters, symbolRes: cam.symbolRes, displayRes: cam.displayRes, maxSymbols: viewport.width < 900 ? 72 : 120 }),
    [native, layer, granularity, filters, cam.symbolRes, cam.displayRes, viewport.width],
  );
  const glances = useMemo(() => regionGlances(native, layer, granularity), [native, layer, granularity]);

  const gridCells = useMemo(() => {
    if (!settings.showGrid) return [];
    return polygons.map((p) => p.h3);
  }, [polygons, settings.showGrid]);

  /* ---------------- Anillos (selección + pulsos de escaneo) ---------------- */
  const [pulses, setPulses] = useState<RingDatum[]>([]);
  const selectionCenter = useMemo<LatLng | null>(() => {
    if (!selection) return null;
    if (selection.kind === 'region') return regions.find((r) => r.id === selection.regionId)?.center ?? null;
    const rec = recordsByRes(selection.resolution).find((r) => r.h3_id === selection.h3);
    return rec?.center ?? null;
  }, [selection, regions, recordsByRes]);

  const rings = useMemo<RingDatum[]>(() => {
    const list = [...pulses];
    if (selectionCenter) {
      const res = selection?.kind === 'cell' ? selection.resolution : 3;
      list.push({
        ...selectionCenter, key: 'selection', color: '#bff4ff',
        maxR: res >= 6 ? 0.18 : res === 5 ? 0.4 : res === 4 ? 0.9 : 2.6, speed: res >= 6 ? 0.12 : 0.8, period: 1600,
      });
    }
    return list;
  }, [pulses, selectionCenter, selection]);

  useEffect(() => {
    if (!pulses.length) return;
    const id = window.setTimeout(() => {
      const now = performance.now();
      setPulses((p) => p.filter((r) => (r.expires ?? Infinity) > now));
    }, 600);
    return () => window.clearTimeout(id);
  }, [pulses]);

  /* ---------------- Etiquetas HTML de región ---------------- */
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const lastLabelClick = useRef<{ id: string; t: number } | null>(null);
  const handleRegionActivate = useCallback(
    (region: Region, isDouble: boolean) => {
      const s = useStore.getState();
      s.select({ kind: 'region', regionId: region.id }, { tab: 'summary' });
      s.flyTo({ lat: region.center.lat, lng: region.center.lng, altitude: Math.min(s.camera.altitude, 1.05) });
      if (isDouble) s.setTransition('entering');
    },
    [],
  );

  const getLabelEl = useCallback(
    (d: object) => {
      const region = d as Region;
      let el = labelEls.current.get(region.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'region-beacon';
        el.style.pointerEvents = 'auto';
        el.setAttribute('role', 'button');
        el.tabIndex = -1;
        el.innerHTML = `<span class="region-beacon__line"></span><span class="region-beacon__body"><strong>${region.name}</strong><em></em></span>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const now = performance.now();
          const last = lastLabelClick.current;
          const isDouble = Boolean(last && last.id === region.id && now - last.t < 380);
          lastLabelClick.current = { id: region.id, t: now };
          handleRegionActivate(region, isDouble);
        });
        labelEls.current.set(region.id, el);
      }
      return el;
    },
    [handleRegionActivate],
  );

  useEffect(() => {
    for (const r of regions) {
      const el = getLabelEl(r);
      const g = glances[r.id];
      const meta = CATEGORY[g?.worst ?? 'none'];
      el.style.setProperty('--beacon', meta.color);
      const em = el.querySelector('em');
      if (em) {
        em.textContent =
          !g ? '—'
            : layer === 'prediction' ? `máx. ${Math.round(g.value * 100)} %`
              : g.worst === 'unavailable' ? 'sin observación'
                : `${g.active} celdas activas${g.anomalies ? ` · ${g.anomalies} anomalías` : ''}`;
      }
      el.classList.toggle('is-pilot', r.isPilot);
      el.classList.toggle('is-selected', selection?.kind === 'region' && selection.regionId === r.id);
    }
  }, [regions, glances, layer, selection, getLabelEl]);

  const showLabels = settings.showLabels && cam.altitude > 0.75 && view === 'global';

  const regionsRef = useRef<Region[]>([]);
  const glancesRef = useRef<typeof glances>({});
  useEffect(() => {
    regionsRef.current = regions;
    glancesRef.current = glances;
  });

  /* ---------------- Inicialización del motor ---------------- */
  const [globeReady, setGlobeReady] = useState(false);
  const globeReadyEvent = useRef(false);
  const onGlobeReady = useCallback(() => {
    globeReadyEvent.current = true;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!globeReadyEvent.current || !globeRef.current) return;
      setGlobeReady(true);
      window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!globeReady) return;
    const globe = globeRef.current;
    if (!globe) return;
    globe.pointOfView(appConfig.initialView, 0);
    globe.controls().autoRotateSpeed = 0.32;
    if (useStore.getState().phase === 'intro') globe.pauseAnimation();
  }, [globeReady]);

  const createEngine = useCallback((globe: GlobeMethods): ObservatoryEngine => {
    const engine = new ObservatoryEngine(globe, {
      quality,
      onCamera: onZoom,
      onRegionPass: (id) => {
        const el = labelEls.current.get(id);
        if (el) {
          el.classList.remove('is-scanned');
          void el.offsetWidth;
          el.classList.add('is-scanned');
        }
        setPulses((p) => {
          const r = regionsRef.current.find((x) => x.id === id);
          if (!r) return p;
          const worst = glancesRef.current[id]?.worst ?? 'none';
          return [...p, {
            lat: r.center.lat, lng: r.center.lng, key: `pulse-${id}-${performance.now()}`,
            color: CATEGORY[worst === 'none' ? 'anomaly' : worst].color, maxR: 4.5, speed: 3.2, period: 99999,
            expires: performance.now() + 1700,
          }];
        });
      },
      onMascotPoke: () => {
        useStore.getState().requestScan();
        say(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)], 'info', 4200);
      },
      onCometBurst: () => say('Fragmento cometario disperso. Volviendo a la Tierra.', 'info', 2600),
    });
    engine.setEarth(earth);
    return engine;
  }, [quality, earth, say, onZoom]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globeReady || !globe) return;
    let engine: ObservatoryEngine | null = null;
    // Diferido un tick para no crear un motor efímero en el doble montaje del modo estricto.
    const timer = window.setTimeout(() => {
      engine = createEngine(globe);
      engineRef.current = engine;
      globeBridge.set({ globe, engine });
      setReady(true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (engine) {
        engine.dispose();
        engineRef.current = null;
        globeBridge.set(null);
        setReady(false);
      }
    };
  }, [globeReady, createEngine]);

  // Efectos visuales.
  useEffect(() => {
    engineRef.current?.setEffects({
      scanWave: settings.scanWave,
      ambient: settings.ambient,
      clouds: settings.clouds,
      bloom: settings.bloom,
      reducedMotion: reduced,
      lighting: settings.lighting,
      showGrid: settings.showGrid,
    });
  }, [ready, settings, reduced]);

  useEffect(() => {
    engineRef.current?.setSolarDate(date);
  }, [ready, date]);

  useEffect(() => {
    if (ready) engineRef.current?.setRegions(regions);
  }, [ready, regions]);

  useEffect(() => {
    const size = cam.displayRes === 6 ? 6 : cam.displayRes === 5 ? 7 : 8;
    engineRef.current?.setSymbols(symbols, size);
  }, [ready, symbols, viewport.width, cam.displayRes]);

  useEffect(() => {
    engineRef.current?.setGrid(gridCells, (SYMBOL_ALT[cam.displayRes] ?? 0.01) * 0.12, cam.displayRes === 6 ? 0.42 : cam.displayRes === 5 ? 1.3 : 4.5);
  }, [ready, gridCells, cam.displayRes]);

  // Percha de la estrella según el tamaño de pantalla.
  useEffect(() => {
    engineRef.current?.setPerch(perchFor(viewport.width, viewport.height));
  }, [ready, viewport.width, viewport.height]);

  // La estrella observa la selección.
  useEffect(() => {
    engineRef.current?.setFocus(selectionCenter);
  }, [ready, selectionCenter]);

  // Desplazamiento de la vista cuando hay panel lateral (solo escritorio).
  useEffect(() => {
    const wide = viewport.width >= 1100;
    const panelWidth = panelExpanded ? Math.min(760, viewport.width * 0.52) : Math.min(440, viewport.width * 0.34);
    engineRef.current?.setViewShift(wide && panelOpen && view === 'global' ? panelWidth * 0.5 : 0);
  }, [ready, panelOpen, panelExpanded, viewport.width, view]);

  // Rotación automática.
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe) return;
    globe.controls().autoRotate = settings.autoRotate && phase === 'observatory' && view === 'global' && !reduced;
  }, [ready, settings.autoRotate, phase, view, reduced]);

  // Pausar el render durante la intro y en la vista regional (ahorro de GPU).
  const transition = useStore((s) => s.transition);
  useEffect(() => {
    const globe = globeRef.current;
    if (!ready || !globe) return;
    const hidden = view === 'regional' && !transition;
    engineRef.current?.setVisible(!hidden && phase === 'observatory');
    if (phase === 'observatory' && !hidden) globe.resumeAnimation();
    else if (hidden) globe.pauseAnimation();
  }, [ready, phase, view, transition]);

  // Onda de escaneo.
  const firstScan = useRef(true);
  useEffect(() => {
    if (!ready || phase !== 'observatory' || scanNonce === 0) return;
    engineRef.current?.triggerScan({ hide: firstScan.current });
    if (firstScan.current) say(env.dataMode === 'api' ? 'NASA FIRMS · Bolivia 2024 · detecciones históricas' : `Escaneo inicial · ${regionsRef.current.length || 13} regiones de demostración`, 'scan', 4200);
    firstScan.current = false;
  }, [ready, phase, scanNonce, say]);

  // Escaneo ambiental periódico.
  useEffect(() => {
    if (!ready || phase !== 'observatory' || !settings.scanWave || reduced || playing) return;
    const id = window.setInterval(() => {
      const s = useStore.getState();
      if (s.view === 'global' && !document.hidden) engineRef.current?.triggerScan();
    }, appConfig.autoScanEveryMs);
    return () => window.clearInterval(id);
  }, [ready, phase, settings.scanWave, reduced, playing]);

  // Órdenes de vuelo.
  useEffect(() => {
    if (!ready || !fly) return;
    globeRef.current?.pointOfView({ lat: fly.lat, lng: fly.lng, altitude: fly.altitude }, reduced ? 0 : fly.duration);
  }, [ready, fly, reduced]);

  /* ---------------- Interacción ---------------- */
  const lastCellClick = useRef<{ id: string; t: number } | null>(null);
  const activateCell = useCallback(
    (h3: string, regionId: string, res: number, center: LatLng, record?: CellActivity) => {
      const now = performance.now();
      const last = lastCellClick.current;
      const isDouble = Boolean(last && last.id === h3 && now - last.t < 380);
      lastCellClick.current = { id: h3, t: now };
      const s = useStore.getState();
      s.select({ kind: 'cell', h3, regionId, resolution: res });
      if (s.settings.autoRotate) s.updateSettings({ autoRotate: false });
      const alt = s.camera.altitude;
      const target = res >= 6 ? Math.min(alt, 0.32) : res === 5 ? Math.min(alt, 0.9) : Math.min(alt, 1.6);
      s.flyTo({ ...center, altitude: Math.max(target, 0.05), duration: 1200 });
      if (record && record.availability_flag === 'missing') say('Sin observación válida en esta celda (nubes o huecos de órbita).', 'warn');
      else if (record?.is_anomaly) say('Anomalía: actividad muy superior a su climatología.', 'scan');
      else say(`Celda ${shortH3(h3)} · res ${res}`, 'info', 2400);
      if (isDouble) s.setTransition('entering');
    },
    [say],
  );

  const onPolygonClick = useCallback(
    (d: object) => {
      const f = d as PolygonFeature;
      activateCell(f.h3, f.regionId, f.res, f.record.center, f.record);
    },
    [activateCell],
  );

  const onGlobeClick = useCallback(
    ({ lat, lng }: { lat: number; lng: number }) => {
      // Busca una celda con datos en la resolución mostrada.
      const res = cam.displayRes;
      const h3 = latLngToCell(lat, lng, res);
      const rec = recordsByRes(res).find((r) => r.h3_id === h3);
      if (rec) {
        activateCell(rec.h3_id, rec.regionId, res, rec.center, rec);
        return;
      }
      const near = regions.find((r) => env.dataMode === 'api' && r.id === 'bolivia' ? insideBolivia(lat, lng) : lat >= r.bbox[1] && lat <= r.bbox[3] && lng >= r.bbox[0] && lng <= r.bbox[2]);
      if (near) {
        handleRegionActivate(near, false);
        return;
      }
      useStore.getState().clearSelection();
      say(`${formatLatLng({ lat, lng }, 2)} · sin detecciones registradas aquí`, 'info', 2600);
    },
    [cam.displayRes, recordsByRes, regions, activateCell, handleRegionActivate, say],
  );

  const polygonLabel = useCallback(
    (d: object) => {
      const f = d as PolygonFeature;
      const meta = CATEGORY[f.cls.kind];
      const region = regions.find((r) => r.id === f.regionId);
      return `<div class="globe-tip"><div class="globe-tip__head"><span class="globe-tip__dot" style="--c:${meta.color}"></span>${meta.short}${f.cls.anomaly ? ' · <b class="globe-tip__anomaly">anomalía</b>' : ''}</div>
        <div class="globe-tip__value">${formatValue(f, layer)}</div>
        <div class="globe-tip__meta">${region ? `${region.name} · ` : ''}H3 r${f.res} · ${shortH3(f.h3)}</div>
        <div class="globe-tip__hint">Clic: inspeccionar · doble clic: explorar zona</div></div>`;
    },
    [regions, layer],
  );

  const capMaterial = useCallback((d: object): Material => {
    const f = d as PolygonFeature;
    // Los polígonos solo se entregan cuando el motor está listo (ready).
    return engineRef.current!.capMaterials.get(f.cls.kind, f.state, f.faint);
  }, []);

  const sideColor = useCallback((d: object) => {
    const f = d as PolygonFeature;
    // Solo se extruyen celdas con actividad en res 4/5 (en res 6 son planas: cientos de
    // celdas con paredes multiplicarían las llamadas de dibujo).
    if (f.cls.kind === 'none' || f.cls.kind === 'unavailable') return '';
    if (f.res >= 6 && f.state !== 'selected') return '';
    return hexToRgba(CATEGORY[f.cls.kind].color, f.state === 'selected' ? 0.55 : 0.22);
  }, []);

  // El contorno de todas las celdas lo dibuja la retícula H3 en una sola llamada; aquí solo
  // se resaltan la seleccionada y la que está bajo el cursor.
  const strokeColor = useCallback((d: object) => {
    const f = d as PolygonFeature;
    if (f.state === 'selected') return '#f2fbff';
    if (f.state === 'hover') return 'rgba(255,255,255,0.85)';
    return '';
  }, []);

  const onPolygonHover = useCallback((d: object | null) => {
    setHover(d ? (d as PolygonFeature).h3 : null);
  }, []);

  const ringColor = useCallback((d: object) => {
    const r = d as RingDatum;
    return (t: number) => hexToRgba(r.color, Math.max(0, 1 - t) * 0.85);
  }, []);

  return (
    <div className="globe-layer" aria-label="Planeta Tierra interactivo">
      <Globe
        ref={globeRef}
        width={viewport.width}
        height={viewport.height}
        animateIn={false}
        backgroundColor="#010309"
        globeMaterial={earth.material}
        globeCurvatureResolution={cam.displayRes === 6 ? 0.5 : 2}
        globeTileEngineUrl={env.enableGlobeTiles && cam.altitude < 0.7 ? detailTiles : null}
        showAtmosphere
        atmosphereColor="#6fb0ff"
        atmosphereAltitude={0.17}
        onGlobeReady={onGlobeReady}
        onGlobeClick={onGlobeClick}
        polygonsData={ready ? polygons : []}
        polygonGeoJsonGeometry="geometry"
        polygonCapMaterial={capMaterial}
        polygonSideColor={sideColor}
        polygonStrokeColor={strokeColor}
        polygonAltitude={(d: object) => polygonAltitude(d as PolygonFeature)}
        polygonsTransitionDuration={playing || reduced ? 0 : 450}
        polygonLabel={polygonLabel}
        onPolygonClick={onPolygonClick}
        onPolygonHover={onPolygonHover}
        ringsData={ready ? rings : []}
        ringColor={ringColor}
        ringMaxRadius="maxR"
        ringPropagationSpeed="speed"
        ringRepeatPeriod="period"
        ringAltitude={0.004}
        htmlElementsData={ready && showLabels ? regions : []}
        htmlElement={getLabelEl}
        htmlAltitude={0.035}
        htmlElementVisibilityModifier={(el: HTMLElement, visible: boolean) => {
          el.classList.toggle('is-hidden', !visible);
        }}
        showPointerCursor
      />
      {phase === 'observatory' && view === 'global' && <span className="map-density-note">Vista agrupada · {polygons.length ? `${polygons.length} celdas destacadas` : 'acércate para inspeccionar'} · totales completos en los paneles</span>}
      {env.enableGlobeTiles && cam.altitude < 0.7 && <span className="globe-attribution">Mapa de referencia: Esri World Imagery · Esri, Maxar, Earthstar Geographics y comunidad GIS. No corresponde a la fecha seleccionada.</span>}
    </div>
  );
}
