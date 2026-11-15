'use client';
/**
 * Destinos secundarios MARTE y UNIVERSO. Escena propia (Three.js) que aparece sobre el
 * globo con un desplazamiento de cámara desde la Tierra, y siempre ofrece volver a la misión.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { SpaceScene, type SpaceTarget } from '@/scene/spaceScene';
import { useReducedMotion, useStore } from '@/state/store';

const MARS_FACTS: [string, string][] = [
  ['Radio medio', '3.389,5 km'],
  ['Gravedad', '3,71 m/s²'],
  ['Día solar (sol)', '24 h 39 min'],
  ['Distancia media al Sol', '1,52 UA'],
  ['Temperatura media', '≈ −65 °C'],
  ['Lunas', 'Fobos y Deimos'],
];

export function SpaceDestination() {
  const destination = useStore((s) => s.destination);
  const setDestination = useStore((s) => s.setDestination);
  const quality = useStore((s) => s.settings.quality);
  const reduced = useReducedMotion();
  const target: SpaceTarget | null = destination === 'mars' || destination === 'universe' ? destination : null;
  const [mounted, setMounted] = useState<SpaceTarget | null>(target);
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const earthLabel = useRef<HTMLSpanElement>(null);
  const marsLabel = useRef<HTMLSpanElement>(null);

  // Montaje / desmontaje con fundido (la escena sale hacia la Tierra antes de cerrarse).
  if (target && target !== mounted) setMounted(target);
  if (!target && visible) setVisible(false);
  useEffect(() => {
    if (target) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    const id = window.setTimeout(() => setMounted(null), reduced ? 0 : 700);
    return () => window.clearTimeout(id);
  }, [target, reduced]);

  // Escena: se crea al montar y viaja al destino elegido.
  useEffect(() => {
    if (!mounted || !canvasRef.current) return;
    if (!sceneRef.current) {
      try {
        sceneRef.current = new SpaceScene(canvasRef.current, quality);
        sceneRef.current.startFromEarth();
      } catch (e) {
        console.warn('Escena espacial no disponible', e);
        setDestination('earth');
        return;
      }
    }
    sceneRef.current.goTo(mounted, reduced);
  }, [mounted, quality, reduced, setDestination]);

  useEffect(() => {
    if (mounted) return;
    sceneRef.current?.dispose();
    sceneRef.current = null;
  }, [mounted]);
  useEffect(() => () => { sceneRef.current?.dispose(); sceneRef.current = null; }, []);

  // Rótulos de la Tierra y Marte (vista Universo).
  useEffect(() => {
    if (!mounted) return;
    let id = 0;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const s = sceneRef.current;
      if (!s) return;
      for (const [which, el] of [['earth', earthLabel.current], ['mars', marsLabel.current]] as const) {
        if (!el) continue;
        const p = s.project(which);
        const show = Boolean(p) && (mounted === 'universe' || which === 'earth');
        el.style.opacity = show ? '1' : '0';
        if (p) el.style.transform = `translate3d(${Math.round(p.x + 12)}px, ${Math.round(p.y - 12)}px, 0)`;
      }
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [mounted]);

  // Escape vuelve a la Tierra.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDestination('earth'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, setDestination]);

  if (!mounted) return null;
  return (
    <div className={`space-dest ${visible ? 'is-visible' : ''}`} role="region" aria-label={mounted === 'mars' ? 'Marte' : 'Universo'}>
      <canvas ref={canvasRef} className="space-dest__canvas" aria-hidden="true" />
      <span ref={earthLabel} className="space-label">Tierra · misión principal</span>
      <span ref={marsLabel} className="space-label space-label--mars">Marte</span>
      {mounted === 'mars' ? (
        <aside className="space-panel glass">
          <div className="space-panel__eyebrow">MARTE · EXPLORACIÓN</div>
          <h2>El planeta rojo</h2>
          <p className="space-panel__lead">Una sección secundaria para comparar escalas. T-PENTAGRON analiza la Tierra: aquí no hay detecciones ni alertas de incendios.</p>
          <dl className="space-facts">
            {MARS_FACTS.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          <p className="space-panel__note">
            Datos: NASA NSSDCA · Mars Fact Sheet{' '}
            <a href="https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html" target="_blank" rel="noreferrer" aria-label="Abrir la ficha de Marte de la NASA">
              <ExternalLink size={11} />
            </a>
            . Superficie procedural ilustrativa: no es un mapa real de Marte.
          </p>
          <div className="space-panel__actions">
            <button type="button" className="btn btn--primary" onClick={() => setDestination('earth')}><ArrowLeft size={14} /> Volver a la Tierra</button>
            <button type="button" className="btn" onClick={() => setDestination('universe')}>Ver el universo</button>
          </div>
        </aside>
      ) : (
        <aside className="space-panel glass">
          <div className="space-panel__eyebrow">UNIVERSO · CONTEXTO</div>
          <h2>Nuestro vecindario</h2>
          <p className="space-panel__lead">La Tierra y Marte frente a la escala del espacio. Las luces de cada detección son diminutas a esta distancia: por eso miramos de cerca.</p>
          <p className="space-panel__note">Campo estelar, banda galáctica y nebulosas ilustrativos. Distancias no a escala.</p>
          <div className="space-panel__actions">
            <button type="button" className="btn btn--primary" onClick={() => setDestination('earth')}><ArrowLeft size={14} /> Volver a la Tierra</button>
            <button type="button" className="btn" onClick={() => setDestination('mars')}>Ir a Marte</button>
          </div>
        </aside>
      )}
    </div>
  );
}
