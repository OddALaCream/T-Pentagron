'use client';
/**
 * Interfaz del observatorio alrededor del planeta. Se revela con una coreografía GSAP
 * cuando termina la introducción.
 */
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { Orbit } from 'lucide-react';
import { useIsCompact } from '@/hooks/useViewport';
import { isReducedMotion, useStore } from '@/state/store';
import { InspectorPanel } from '@/components/dashboard/InspectorPanel';
import { TopBar } from './TopBar';
import { TimelineDock } from './TimelineDock';
import { Legend } from './Legend';
import { CameraControls } from './CameraControls';
import { DrawerHost } from './Drawers';
import { MascotStatus, SelectionTether } from './SceneOverlays';

export function ObservatoryHUD() {
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const panelOpen = useStore((s) => s.panel.open);
  const setTransition = useStore((s) => s.setTransition);
  const compact = useIsCompact();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || phase !== 'observatory') return;
    const items = el.querySelectorAll('[data-reveal]');
    if (isReducedMotion()) {
      gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.03 });
      return;
    }
    const tl = gsap.timeline({ delay: 0.15 });
    tl.fromTo(
      items,
      { opacity: 0, y: (i) => (i === 0 ? -18 : 18), filter: 'blur(8px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, ease: 'expo.out', stagger: 0.09, clearProps: 'filter,transform' },
    );
    return () => {
      tl.kill();
    };
  }, [phase]);

  const hidden = phase !== 'observatory' || view !== 'global';

  return (
    <div ref={ref} className={`hud ${panelOpen && selection ? 'has-inspector' : ''} ${hidden ? 'is-hidden' : ''}`} aria-hidden={hidden}>
      <TopBar />
      <DrawerHost />
      <Legend />
      <CameraControls />
      <TimelineDock compact={compact} />
      <InspectorPanel />
      <SelectionTether />
      <MascotStatus />
      {compact && selection && !panelOpen && (
        <button type="button" className="explore-fab btn btn--primary" onClick={() => setTransition('entering')}>
          <Orbit size={15} /> Explorar zona
        </button>
      )}
    </div>
  );
}
