'use client';
/**
 * Mapa regional detallado (Leaflet) con las celdas H3 res 6 de la región.
 * Se carga en el cliente; si las teselas externas fallan, el mapa sigue funcionando
 * con la retícula H3 sobre fondo oscuro.
 */
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { CATEGORY, classify } from '@/lib/science/categories';
import { cellPolygon, shortH3 } from '@/lib/geo/h3';
import type { CellActivity, DataLayer, Granularity, Region } from '@/lib/types/domain';
import { BASEMAPS, LABELS_OVERLAY, type BasemapId } from './basemaps';

interface Props {
  region: Region;
  records: CellActivity[];
  layer: DataLayer;
  granularity: Granularity;
  date: string;
  basemap: BasemapId;
  showLabels: boolean;
  selectedH3: string | null;
  focusH3: string | null;
  onSelect: (record: CellActivity) => void;
  onTileError?: () => void;
}

export function RegionalMap({ region, records, layer, granularity, date, basemap, showLabels, selectedH3, focusH3, onSelect, onTileError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const baseRef = useRef<Leaflet.TileLayer | null>(null);
  const labelsRef = useRef<Leaflet.TileLayer | null>(null);
  const cellsRef = useRef<Leaflet.GeoJSON | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onTileErrorRef = useRef(onTileError);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onTileErrorRef.current = onTileError;
  });

  // Inicialización.
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    import('leaflet').then((mod) => {
      if (cancelled || !containerRef.current) return;
      const L = (mod.default ?? mod) as typeof Leaflet;
      LRef.current = L;
      map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
        minZoom: 3,
        maxZoom: 13,
        zoomSnap: 0.25,
      });
      L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(map);
      L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
      const [minLng, minLat, maxLng, maxLat] = region.bbox;
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [24, 24] });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [region]);

  // Mapa base.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    baseRef.current?.remove();
    baseRef.current = null;
    const def = BASEMAPS.find((b) => b.id === basemap);
    if (def?.available && def.url) {
      let errors = 0;
      const layer = L.tileLayer(def.url(date), {
        maxNativeZoom: def.maxNativeZoom,
        maxZoom: 13,
        attribution: def.attribution,
        crossOrigin: true,
      });
      layer.on('tileerror', () => {
        errors++;
        if (errors === 4) onTileErrorRef.current?.();
      });
      layer.addTo(map);
      layer.bringToBack();
      baseRef.current = layer;
    }
  }, [ready, basemap, date]);

  // Etiquetas de referencia.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    labelsRef.current?.remove();
    labelsRef.current = null;
    if (showLabels && basemap !== 'none') {
      labelsRef.current = L.tileLayer(LABELS_OVERLAY, { maxNativeZoom: 13, maxZoom: 13, pane: 'overlayPane', opacity: 0.85 }).addTo(map);
    }
  }, [ready, showLabels, basemap]);

  // Celdas H3.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    cellsRef.current?.remove();
    const features = records.map((r) => ({
      type: 'Feature' as const,
      properties: { record: r },
      geometry: cellPolygon(r.h3_id),
    }));
    const layerGeo = L.geoJSON({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection, {
      style: (f) => {
        const r = (f?.properties as { record: CellActivity }).record;
        const cls = classify(r, layer, granularity);
        const meta = CATEGORY[cls.kind];
        const selected = r.h3_id === selectedH3;
        return {
          color: selected ? '#ffffff' : cls.kind === 'none' ? 'rgba(160,190,240,0.35)' : meta.color,
          weight: selected ? 2.4 : cls.kind === 'none' ? 0.5 : 0.9,
          opacity: 1,
          fillColor: meta.color,
          fillOpacity: cls.kind === 'none' ? 0.02 : cls.kind === 'unavailable' ? 0.18 : 0.25 + cls.intensity * 0.5,
          dashArray: cls.kind === 'unavailable' ? '3 3' : undefined,
        };
      },
      onEachFeature: (f, lyr) => {
        const r = (f.properties as { record: CellActivity }).record;
        const cls = classify(r, layer, granularity);
        lyr.bindTooltip(
          `<b>${CATEGORY[cls.kind].short}</b>${cls.anomaly ? ' · anomalía' : ''}<br/><span class="mono">${shortH3(r.h3_id)}</span><br/>VIIRS ${r.viirs_detected ?? '—'} · MODIS ${r.modis_detected ?? '—'}${r.probability != null ? ` · ${Math.round(r.probability * 100)} %` : ''}`,
          { sticky: true, className: 'leaflet-tip' },
        );
        lyr.on('click', () => onSelectRef.current(r));
      },
    });
    layerGeo.addTo(map);
    cellsRef.current = layerGeo;
  }, [ready, records, layer, granularity, selectedH3]);

  // Centrar una celda pedida desde la lista.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusH3) return;
    const ring = cellPolygon(focusH3).coordinates[0];
    const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 9), { duration: 0.8 });
  }, [ready, focusH3]);

  return <div ref={containerRef} className="regional-map" role="application" aria-label={`Mapa detallado de ${region.name}`} />;
}
