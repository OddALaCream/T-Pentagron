'use client';
import { useMemo, useState } from 'react';
import { useMetadata, useSeries } from '@/hooks/data';
import { addDays } from '@/lib/time/dates';
import { SENSOR_COLORS } from '@/lib/science/categories';
import { useStore } from '@/state/store';
import { ScatterSensors, SensorChart } from '@/components/charts/charts';
import { Note, SectionTitle, Segmented, Stat } from '@/components/ui/primitives';
import type { TargetInfo } from './useTarget';
import { env } from '@/config/env';

export function SensorsModule({ info }: { info: TargetInfo }) {
  const date = useStore((s) => s.date);
  const range = useStore((s) => s.dataRange);
  const setDate = useStore((s) => s.setDate);
  const setLayer = useStore((s) => s.setLayer);
  const [windowDays, setWindowDays] = useState<'30' | '60' | '120'>('60');
  const [mode, setMode] = useState<'raw' | 'calibrated'>('raw');
  const { data: meta } = useMetadata();
  const k = env.dataMode === 'api' ? 1 : Number.isFinite(meta?.harmonization.modisCalibrationFactor) ? meta!.harmonization.modisCalibrationFactor : 3.1;
  const from = addDays(date, -(Number(windowDays) - 1));
  const { data: points, isFetching } = useSeries(info.target, from < range.start ? range.start : from, date);

  const s = useMemo(() => {
    const list = points ?? [];
    let viirs = 0, modis = 0, both = 0, onlyV = 0, onlyM = 0, none = 0, comparable = 0, missing = 0;
    for (const p of list) {
      if (p.viirs === null || p.modis === null) {
        if (p.availability === 'missing') missing++;
        viirs += p.viirs ?? 0;
        modis += p.modis ?? 0;
        continue;
      }
      comparable++;
      viirs += p.viirs;
      modis += p.modis;
      if (p.viirs > 0 && p.modis > 0) both++;
      else if (p.viirs > 0) onlyV++;
      else if (p.modis > 0) onlyM++;
      else none++;
    }
    return { viirs, modis, both, onlyV, onlyM, none, comparable, missing, agreement: comparable ? (both + none) / comparable : 0 };
  }, [points]);

  return (
    <div className="module">
      <div className="module-toolbar" data-holo-item>
        <Segmented label="Ventana temporal" size="sm" value={windowDays} onChange={setWindowDays}
          options={[{ value: '30', label: '30 d' }, { value: '60', label: '60 d' }, { value: '120', label: '120 d' }]} />
        {env.dataMode === 'mock' && <Segmented label="Valores MODIS" size="sm" value={mode} onChange={setMode}
          options={[{ value: 'raw', label: 'Originales' }, { value: 'calibrated', label: `Calibrados ×${k}` }]} />}
      </div>

      <div className={`chart-card ${isFetching ? 'is-loading' : ''}`} data-holo-item>
        <div className="chart-card__legend">
          <span><i style={{ background: SENSOR_COLORS.VIIRS }} /> VIIRS 375 m ↑</span>
          <span><i style={{ background: SENSOR_COLORS.MODIS }} /> MODIS 1 km ↓</span>
          <span><i className="line" style={{ background: SENSOR_COLORS.harmonized }} /> Índice armonizado</span>
        </div>
        <SensorChart points={points ?? []} selectedDate={date} onSelectDate={setDate} calibrated={mode === 'calibrated'} calibrationFactor={k} />
      </div>

      <div className="stats-grid" data-holo-item>
        <Stat label="VIIRS (total)" value={s.viirs} tone={SENSOR_COLORS.VIIRS} />
        <Stat label="MODIS (total)" value={s.modis} tone={SENSOR_COLORS.MODIS} />
        <Stat label="Relación VIIRS/MODIS" value={s.modis ? (s.viirs / s.modis).toFixed(1) : '—'} unit="×" hint="Cuántas detecciones VIIRS por cada detección MODIS" />
        <Stat label="Concordancia diaria" value={`${Math.round(s.agreement * 100)}`} unit="%" hint="Días en que ambos detectan o ninguno detecta (sobre días comparables)" />
      </div>

      <div className="split" data-holo-item>
        <div>
          <SectionTitle>Discrepancias</SectionTitle>
          <ul className="bullet-stats">
            <li><b>{s.both}</b> días con detección en ambos sensores</li>
            <li><b>{s.onlyV}</b> días solo VIIRS</li>
            <li><b>{s.onlyM}</b> días solo MODIS</li>
            <li><b>{s.missing}</b> días sin detecciones registradas; cobertura desconocida</li>
          </ul>
        </div>
        <div>
          <SectionTitle>{env.dataMode === 'api' ? 'VIIRS frente a MODIS (originales)' : 'VIIRS frente a MODIS·k'}</SectionTitle>
          <ScatterSensors points={points ?? []} factor={k} />
        </div>
      </div>

      <div data-holo-item>
        {env.dataMode === 'api' ? <Note>Recuentos originales de type=0. Una detección no equivale a un incendio único. El índice exploratorio usa normalización robusta por sensor, sin calibración física. {meta?.harmonization.notes} Cobertura satelital desconocida.</Note> : <Note>
          VIIRS observa píxeles de ~375 m y MODIS de ~1 km: VIIRS suele registrar más focos y detecta fuegos pequeños que
          MODIS omite. Los recuentos no equivalen a número de incendios ni a superficie quemada. La capa armonizada
          aplica un factor de calibración k (ilustrativo en esta demo) y se muestra separada de los valores originales.
        </Note>}
        <div className="action-row">
          <button type="button" className="btn" onClick={() => setLayer('modis')}>Ver capa MODIS</button>
          <button type="button" className="btn" onClick={() => setLayer('viirs')}>Ver capa VIIRS</button>
          <button type="button" className="btn" onClick={() => setLayer('harmonized')}>Ver armonizado</button>
        </div>
      </div>
    </div>
  );
}
