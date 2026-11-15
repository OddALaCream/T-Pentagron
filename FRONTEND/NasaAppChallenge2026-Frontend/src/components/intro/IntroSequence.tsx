'use client';
/**
 * Introducción cinematográfica. Se ejecuta en cada carga de la aplicación (no al
 * navegar entre vistas), puede omitirse en cualquier momento y nunca bloquea:
 * si WebGL o un recurso falla, se pasa directamente al observatorio.
 */
import { useEffect, useRef, useState } from 'react';
import { SkipForward } from 'lucide-react';
import { brand } from '@/config/brand';
import { appConfig } from '@/config/app';
import { IntroScene } from '@/scene/introScene';
import { globeBridge } from '@/scene/bridge';
import { useReducedMotion, useStore } from '@/state/store';

export default function IntroSequence() {
  const phase = useStore((s) => s.phase);
  const introRun = useStore((s) => s.introRun);
  const quality = useStore((s) => s.settings.quality);
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<IntroScene | null>(null);
  const [active, setActive] = useState(true);
  const [wordmark, setWordmark] = useState(0);
  const [lastRun, setLastRun] = useState(introRun);

  // Repetir la introducción desde Configuración.
  if (introRun !== lastRun) {
    setLastRun(introRun);
    setActive(true);
  }

  useEffect(() => {
    if (!active || phase !== 'intro' || !containerRef.current) return;
    const s = useStore.getState();
    const prepare = () => {
      const bridge = globeBridge.get();
      if (!bridge) return;
      bridge.globe.pointOfView(appConfig.initialView, 0);
      bridge.globe.resumeAnimation();
    };
    globeBridge.get()?.globe.pauseAnimation();
    // Al repetir la intro se parte de un estado limpio; en la primera carga se respeta la
    // selección que venga en la URL (enlaces compartidos).
    if (introRun > 0) s.clearSelection();
    const container = containerRef.current;
    let scene: IntroScene | null = null;
    // Se difiere un tick: si el efecto se desmonta enseguida (modo estricto), no se crea
    // un contexto WebGL efímero que compita con el definitivo.
    const timer = window.setTimeout(() => {
      try {
        scene = new IntroScene(container, {
          reduced,
          quality,
          callbacks: {
            onPrepare: prepare,
            onHandoff: () => useStore.getState().finishIntro(),
            onDone: () => setActive(false),
            onWordmark: setWordmark,
          },
        });
        sceneRef.current = scene;
        scene.start();
      } catch (error) {
        console.warn('Introducción no disponible, se continúa al observatorio.', error);
        prepare();
        useStore.getState().finishIntro();
        setActive(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      scene?.dispose();
      sceneRef.current = null;
    };
    // La intro se configura una vez por ejecución.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, introRun]);

  // Teclado: Escape / Enter omiten.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') sceneRef.current?.skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!active) return null;

  return (
    <div ref={containerRef} className="intro" data-phase={phase}>
      <div className="intro__wordmark" style={{ opacity: wordmark }} aria-hidden={wordmark < 0.5}>
        <span className="intro__eyebrow">{brand.event}</span>
        <span className="intro__name">{brand.name}</span>
        <span className="intro__tag">{brand.tagline}</span>
      </div>
      <button
        type="button"
        className="intro__skip"
        onClick={() => sceneRef.current?.skip()}
        aria-label="Omitir introducción"
      >
        <span>Omitir introducción</span>
        <SkipForward size={15} aria-hidden="true" />
      </button>
      <p className="sr-only" role="status">
        Introducción animada en curso. Pulsa Escape para omitirla.
      </p>
    </div>
  );
}
