'use client';
import { BookOpen, Globe2, Keyboard, Settings2, SlidersHorizontal } from 'lucide-react';
import { brand } from '@/config/brand';
import { env } from '@/config/env';
import { useGlobeSnapshot } from '@/hooks/data';
import { LAYERS } from '@/lib/science/categories';
import { formatDate, formatMonth } from '@/lib/time/dates';
import { useStore } from '@/state/store';
import { DemoBadge, IconButton, Segmented } from '@/components/ui/primitives';
import { BrandMark } from './BrandMark';

const nf = new Intl.NumberFormat('es');

export function TopBar() {
  const layer = useStore((s) => s.layer);
  const setLayer = useStore((s) => s.setLayer);
  const drawer = useStore((s) => s.drawer);
  const toggleDrawer = useStore((s) => s.toggleDrawer);
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);
  const filters = useStore((s) => s.filters);
  const { data: snap, isFetching } = useGlobeSnapshot();
  const t = snap?.totals;
  const missingShare = t ? t.missingCells / Math.max(1, t.missingCells + t.partialCells + t.observedCells) : 0;
  const activeFilters =
    Object.values(filters.kinds).filter((v) => !v).length + (filters.confidence !== 'all' ? 1 : 0) + (filters.onlyAnomalies ? 1 : 0) + (filters.regionScope !== 'all' ? 1 : 0);
  const active = LAYERS.find((l) => l.id === layer)!;

  return (
    <header className="topbar" data-reveal>
      <div className="topbar__brand">
        <BrandMark />
        <div className="topbar__names">
          <span className="topbar__name">{brand.name}</span>
          <span className="topbar__sub">{brand.challenge}</span>
        </div>
        {env.dataMode === 'mock' ? <DemoBadge compact /> : <span className="api-badge">API</span>}
      </div>

      <div className="topbar__center">
        <Segmented
          label="Capa de datos"
          value={layer}
          onChange={setLayer}
          options={LAYERS.map((l) => ({
            value: l.id,
            label: (
              <>
                <span className="seg-dot" style={{ background: l.accent }} aria-hidden="true" />
                <span className="seg-label-long">{l.label}</span>
                <span className="seg-label-short">{l.short}</span>
              </>
            ),
            title: `${l.description} (tecla ${l.hotkey})`,
            accent: l.accent,
          }))}
        />
        <div className={`telemetry ${isFetching ? 'is-updating' : ''}`} aria-live="polite">
          <span className="telemetry__date">{granularity === 'month' ? formatMonth(date) : formatDate(date)}</span>
          {t && (
            <>
              <span><b>{nf.format(t.viirs)}</b> VIIRS</span>
              <span><b>{nf.format(t.modis)}</b> MODIS</span>
              <span><b>{nf.format(t.activeCells)}</b> celdas activas</span>
              {t.anomalies > 0 && <span className="telemetry__anomaly"><b>{t.anomalies}</b> anomalías</span>}
              <span className="muted">{Math.round(missingShare * 100)} % sin obs.</span>
            </>
          )}
          <span className="telemetry__layer muted">{active.description}</span>
        </div>
      </div>

      <nav className="topbar__actions" aria-label="Herramientas">
        <IconButton icon={Globe2} label="Regiones" active={drawer === 'regions'} onClick={() => toggleDrawer('regions')} />
        <IconButton icon={SlidersHorizontal} label="Filtros" active={drawer === 'filters'} onClick={() => toggleDrawer('filters')} badge={activeFilters || null} />
        <IconButton icon={Settings2} label="Configuración visual" active={drawer === 'settings'} onClick={() => toggleDrawer('settings')} />
        <IconButton icon={BookOpen} label="Metodología y fuentes" active={drawer === 'about'} onClick={() => toggleDrawer('about')} />
        <IconButton icon={Keyboard} label="Ayuda y atajos" active={drawer === 'help'} onClick={() => toggleDrawer('help')} className="hide-compact" />
      </nav>
    </header>
  );
}
