'use client';
/**
 * Modo ÓRBITA: cómo se obtienen los datos. Panel explicativo + rótulos sobre los satélites.
 * Altitud, inclinación, lanzamiento y hora de paso son nominales (fichas de misión);
 * la posición de los satélites es conceptual.
 */
import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { globeBridge } from '@/scene/bridge';
import { PLATFORMS, SENSOR_ORBIT_COLOR } from '@/scene/orbitLayer';
import { useStore } from '@/state/store';

export function OrbitPanel() {
  const destination = useStore((s) => s.destination);
  const setDestination = useStore((s) => s.setDestination);
  const labelsRef = useRef<HTMLDivElement>(null);

  // Rótulos de satélites: se reposicionan cada fotograma sin re-renderizar React.
  useEffect(() => {
    if (destination !== 'orbit') return;
    let off: (() => void) | undefined;
    const attach = () => {
      const b = globeBridge.get();
      if (!b?.orbit || !labelsRef.current) return false;
      const els = Array.from(labelsRef.current.children) as HTMLElement[];
      off = b.engine.addFrameListener((info) => {
        b.orbit!.positions().forEach((p, i) => {
          const el = els[i];
          if (!el) return;
          const s = info.project(p.lat, p.lng, p.alt);
          if (!s) { el.style.opacity = '0'; return; }
          el.style.opacity = '1';
          el.style.transform = `translate3d(${Math.round(s.x + 10)}px, ${Math.round(s.y - 10)}px, 0)`;
        });
      });
      return true;
    };
    if (!attach()) {
      const unsub = globeBridge.subscribe(() => { if (attach()) unsub(); });
      return () => { unsub(); off?.(); };
    }
    return () => off?.();
  }, [destination]);

  if (destination !== 'orbit') return null;
  return (
    <>
      <div ref={labelsRef} className="orbit-labels" aria-hidden="true">
        {PLATFORMS.map((p) => (
          <span key={p.name} className="orbit-label" style={{ '--c': SENSOR_ORBIT_COLOR[p.sensor] } as React.CSSProperties}>
            {p.name} · {p.sensor}
          </span>
        ))}
      </div>
      <aside className="orbit-panel glass" aria-label="Órbitas e instrumentos">
        <div className="orbit-panel__eyebrow">ÓRBITA · INSTRUMENTOS</div>
        <h2 className="orbit-panel__title">Cómo se obtienen los datos</h2>
        <p className="orbit-panel__lead">Cinco satélites en órbita polar heliosíncrona barren la Tierra cada día. MODIS y VIIRS miden la radiación infrarroja y marcan como detección cada píxel con una anomalía térmica.</p>
        <div className="orbit-compare">
          <div style={{ '--c': SENSOR_ORBIT_COLOR.MODIS } as React.CSSProperties}>
            <strong>MODIS</strong>
            <span>píxel de fuego <b>1 km</b></span>
            <span>franja <b>2.330 km</b></span>
            <span>desde <b>2000</b></span>
          </div>
          <div style={{ '--c': SENSOR_ORBIT_COLOR.VIIRS } as React.CSSProperties}>
            <strong>VIIRS</strong>
            <span>píxel de fuego <b>375 m</b></span>
            <span>franja <b>3.040 km</b></span>
            <span>desde <b>2012</b></span>
          </div>
        </div>
        <table className="orbit-table">
          <thead><tr><th>Plataforma</th><th>Sensor</th><th>Altitud</th><th>Paso</th></tr></thead>
          <tbody>
            {PLATFORMS.map((p) => (
              <tr key={p.name}>
                <td><i style={{ background: SENSOR_ORBIT_COLOR[p.sensor] }} />{p.name} <small>({p.launch})</small></td>
                <td>{p.sensor}</td>
                <td>{p.altKm} km · {p.incDeg}°</td>
                <td>{p.crossing}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="orbit-panel__note">
          <b>Visualización conceptual:</b> altitud e inclinación son nominales; la posición de los satélites y la orientación de las órbitas son ilustrativas (sin efemérides). Una detección es un píxel caliente, no un incendio confirmado.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => setDestination('earth')}>
          <ArrowLeft size={14} /> Volver al observatorio
        </button>
      </aside>
    </>
  );
}
