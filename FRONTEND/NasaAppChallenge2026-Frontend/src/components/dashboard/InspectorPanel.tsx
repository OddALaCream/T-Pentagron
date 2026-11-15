'use client';
/**
 * Inspector científico: panel holográfico con módulos en pestañas.
 * Muestra primero el resumen; el detalle completo está en pestañas y secciones expandibles.
 */
import { useMemo } from 'react';
import { BarChart3, CalendarDays, FlaskConical, Hexagon, Info, MapPin, Radar, Sparkles } from 'lucide-react';
import { useStore, type PanelTab } from '@/state/store';
import { HoloPanel } from '@/components/ui/HoloPanel';
import { Tabs } from '@/components/ui/primitives';
import { globeBridge } from '@/scene/bridge';
import { cellCenter, shortH3 } from '@/lib/geo/h3';
import { useTarget } from './useTarget';
import { SummaryModule } from './SummaryModule';
import { CalendarModule } from './CalendarModule';
import { SensorsModule } from './SensorsModule';
import { PredictionModule } from './PredictionModule';
import { AdvancedModule } from './AdvancedModule';

const TABS: { id: PanelTab; label: string; icon: typeof Info }[] = [
  { id: 'summary', label: 'Resumen', icon: BarChart3 },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'sensors', label: 'Sensores', icon: Radar },
  { id: 'prediction', label: 'Predicción', icon: Sparkles },
  { id: 'advanced', label: 'Avanzado', icon: FlaskConical },
];

export function InspectorPanel() {
  const info = useTarget();
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const clearSelection = useStore((s) => s.clearSelection);
  const select = useStore((s) => s.select);
  const view = useStore((s) => s.view);

  const origin = useMemo(() => {
    if (!info) return null;
    const bridge = globeBridge.get();
    const center = info.kind === 'cell' && info.h3 ? cellCenter(info.h3) : info.region?.center;
    if (!bridge || !center) return null;
    const p = bridge.globe.getScreenCoords(center.lat, center.lng, 0.01);
    const rect = bridge.globe.renderer().domElement.getBoundingClientRect();
    return p && Number.isFinite(p.x) ? { x: p.x + rect.left, y: p.y + rect.top } : null;
  }, [info]);

  const open = Boolean(info) && panel.open && view === 'global';
  const keyId = info ? (info.kind === 'cell' ? info.h3 : info.region?.id) : 'none';

  return (
    <HoloPanel
      open={open}
      ariaLabel="Panel de información científica"
      eyebrow={
        info?.kind === 'cell' && info.region ? (
          <button type="button" className="crumb" onClick={() => select({ kind: 'region', regionId: info.region!.id })} title="Ver la región completa">
            <MapPin size={11} /> {info.region.name}
          </button>
        ) : (
          <span className="crumb"><MapPin size={11} /> {info?.region?.country ?? ''}</span>
        )
      }
      title={info?.kind === 'cell' ? <span className="mono">{info.h3 ? shortH3(info.h3) : ''}</span> : info?.region?.name ?? ''}
      subtitle={info?.kind === 'cell' ? `Celda H3 · resolución ${info.resolution}` : info?.region ? `${info.region.biome} · temporada ${info.region.seasonLabel}` : ''}
      icon={<Hexagon size={18} />}
      origin={origin}
      minimized={panel.minimized}
      expanded={panel.expanded}
      onClose={clearSelection}
      onMinimize={(v) => setPanel({ minimized: v })}
      onExpand={(v) => setPanel({ expanded: v })}
      className="inspector"
      toolbar={<Tabs label="Módulos científicos" tabs={TABS} value={panel.tab} onChange={(tab) => setPanel({ tab })} />}
    >
      {info && (
        <div role="tabpanel" key={`${keyId}-${panel.tab}`} className="inspector__content">
          {panel.tab === 'summary' && <SummaryModule info={info} />}
          {panel.tab === 'calendar' && <CalendarModule info={info} />}
          {panel.tab === 'sensors' && <SensorsModule info={info} />}
          {panel.tab === 'prediction' && <PredictionModule info={info} />}
          {panel.tab === 'advanced' && <AdvancedModule info={info} />}
        </div>
      )}
    </HoloPanel>
  );
}
