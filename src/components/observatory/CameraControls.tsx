'use client';
import { Crosshair, Maximize, Minus, Plus, Radar, RotateCw, Scan } from 'lucide-react';
import { appConfig } from '@/config/app';
import { useRegionMap } from '@/hooks/data';
import { cellCenter } from '@/lib/geo/h3';
import { globeBridge } from '@/scene/bridge';
import { useStore } from '@/state/store';
import { IconButton } from '@/components/ui/primitives';

export function CameraControls() {
  const autoRotate = useStore((s) => s.settings.autoRotate);
  const scanWave = useStore((s) => s.settings.scanWave);
  const updateSettings = useStore((s) => s.updateSettings);
  const requestScan = useStore((s) => s.requestScan);
  const selection = useStore((s) => s.selection);
  const flyTo = useStore((s) => s.flyTo);
  const regions = useRegionMap();

  const focus = () => {
    if (!selection) return;
    const c = selection.kind === 'cell' ? cellCenter(selection.h3) : regions[selection.regionId]?.center;
    if (c) flyTo({ ...c, altitude: selection.kind === 'cell' ? (selection.resolution >= 6 ? 0.18 : 0.6) : 0.9 });
  };

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className="camera-controls glass" role="toolbar" aria-label="Controles de cámara" aria-orientation="vertical" data-reveal>
      <IconButton icon={Plus} label="Acercar" onClick={() => globeBridge.zoom(0.7)} />
      <IconButton icon={Minus} label="Alejar" onClick={() => globeBridge.zoom(1.4)} />
      <IconButton icon={Scan} label="Restablecer vista" onClick={() => flyTo({ ...appConfig.initialView, duration: 1200 })} />
      <IconButton icon={Crosshair} label="Centrar selección" onClick={focus} disabled={!selection} />
      <span className="camera-controls__sep" aria-hidden="true" />
      <IconButton icon={RotateCw} label={autoRotate ? 'Detener rotación automática (R)' : 'Activar rotación automática (R)'} active={autoRotate} onClick={() => updateSettings({ autoRotate: !autoRotate })} />
      <IconButton icon={Radar} label="Lanzar escaneo (S)" onClick={requestScan} disabled={!scanWave} />
      <IconButton icon={Maximize} label="Pantalla completa" onClick={fullscreen} className="hide-compact" />
    </div>
  );
}
