'use client';
/**
 * Transición inmersiva global ⇄ regional:
 * acercamiento cinematográfico → el planeta llena la vista → se atraviesa una capa de
 * nubes → destello atmosférico → aparece la vista regional. Y el camino inverso.
 */
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { cellCenter } from '@/lib/geo/h3';
import { globeBridge } from '@/scene/bridge';
import { useRegionMap } from '@/hooks/data';
import { isReducedMotion, useStore } from '@/state/store';
import { useNarrator } from '@/state/narrator';
import type { Region } from '@/lib/types/domain';

export function RegionalTransition() {
  const transition = useStore((s) => s.transition);
  const regions = useRegionMap();
  const overlayRef = useRef<HTMLDivElement>(null);
  const say = useNarrator((s) => s.say);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!transition || !overlay) return;
    // Salvaguarda: si la animación no avanza (pestaña en segundo plano, error), la vista
    // llega igualmente a un estado estable.
    const failsafe = window.setTimeout(() => {
      const st = useStore.getState();
      if (st.transition !== transition) return;
      if (transition === 'entering') {
        const id = st.selection?.regionId ?? st.regionalId;
        if (id) st.enterRegional(id);
      } else {
        st.exitRegional();
        const region = st.regionalId ? regions[st.regionalId] : undefined;
        const center = st.selection?.kind === 'cell' ? cellCenter(st.selection.h3) : region?.center;
        if (center) globeBridge.get()?.globe.pointOfView({ ...center, altitude: 1.15 }, 0);
      }
      overlay.style.opacity = '0';
      st.setTransition(null);
    }, transition === 'entering' ? 4500 : 3000);
    const tl = choreograph(overlay, transition, regions, say);
    return () => {
      window.clearTimeout(failsafe);
      tl?.kill();
    };
  }, [transition, regions, say]);

  return (
    <div ref={overlayRef} className="transition-overlay" aria-hidden="true">
      <div className="cloud-layer cloud-layer--1" />
      <div className="cloud-layer cloud-layer--2" />
      <div className="cloud-layer cloud-layer--3" />
      <div className="atmo-flash" />
    </div>
  );
}

function choreograph(
  overlay: HTMLDivElement,
  transition: 'entering' | 'leaving',
  regions: Record<string, Region>,
  say: (m: string, tone?: 'info' | 'scan' | 'warn', ms?: number) => void,
): gsap.core.Timeline | null {
    const s = useStore.getState();
    const reduced = isReducedMotion();
    const layers = overlay.querySelectorAll('.cloud-layer');
    const flash = overlay.querySelector('.atmo-flash');
    const bridge = globeBridge.get();

    if (transition === 'entering') {
      const regionId = s.selection?.regionId ?? s.regionalId;
      const region = regionId ? regions[regionId] : undefined;
      if (!region) {
        s.setTransition(null);
        return null;
      }
      const center = s.selection?.kind === 'cell' ? cellCenter(s.selection.h3) : region.center;
      s.setPlaying(false);
      s.setDrawer(null);
      say(`Descendiendo a ${region.name}…`, 'scan', 2600);
      if (reduced) {
        const tl = gsap.timeline({ onComplete: () => s.setTransition(null) });
        tl.to(overlay, { opacity: 1, duration: 0.25 });
        tl.call(() => s.enterRegional(region.id));
        tl.to(overlay, { opacity: 0, duration: 0.3 });
        return tl;
      }
      bridge?.globe.pointOfView({ lat: center.lat, lng: center.lng, altitude: 0.035 }, 1900);
      const tl = gsap.timeline({ onComplete: () => useStore.getState().setTransition(null) });
      tl.set(overlay, { opacity: 1 });
      tl.fromTo(layers, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1.6, duration: 1.1, ease: 'power2.in', stagger: 0.12 }, 0.75);
      tl.fromTo(flash, { opacity: 0 }, { opacity: 0.9, duration: 0.35, ease: 'power2.in' }, 1.55);
      tl.call(() => useStore.getState().enterRegional(region.id), [], 1.95);
      tl.to(layers, { opacity: 0, scale: 3.2, duration: 1.0, ease: 'power2.out', stagger: 0.08 }, 2.0);
      tl.to(flash, { opacity: 0, duration: 0.8, ease: 'power1.out' }, 2.0);
      tl.set(overlay, { opacity: 0 }, 3.0);
      return tl;
    }

    // Regreso al observatorio.
    const region = s.regionalId ? regions[s.regionalId] : undefined;
    const center = s.selection?.kind === 'cell' ? cellCenter(s.selection.h3) : region?.center;
    if (reduced) {
      const tl = gsap.timeline({ onComplete: () => s.setTransition(null) });
      tl.to(overlay, { opacity: 1, duration: 0.2 });
      tl.call(() => {
        s.exitRegional();
        if (center) bridge?.globe.pointOfView({ ...center, altitude: 1.1 }, 0);
      });
      tl.to(overlay, { opacity: 0, duration: 0.3 });
      return tl;
    }
    const tl = gsap.timeline({ onComplete: () => useStore.getState().setTransition(null) });
    tl.set(overlay, { opacity: 1 });
    tl.fromTo(layers, { opacity: 0, scale: 3.2 }, { opacity: 1, scale: 1.5, duration: 0.6, ease: 'power2.in', stagger: 0.06 }, 0);
    tl.fromTo(flash, { opacity: 0 }, { opacity: 0.6, duration: 0.3 }, 0.3);
    tl.call(() => {
      const st = useStore.getState();
      st.exitRegional();
      if (center && bridge) {
        bridge.globe.pointOfView({ ...center, altitude: 0.05 }, 0);
        bridge.globe.pointOfView({ ...center, altitude: 1.15 }, 1800);
      }
    }, [], 0.65);
    tl.to(layers, { opacity: 0, scale: 0.8, duration: 1.0, ease: 'power2.out', stagger: 0.06 }, 0.75);
    tl.to(flash, { opacity: 0, duration: 0.6 }, 0.75);
    tl.set(overlay, { opacity: 0 }, 1.9);
    return tl;
}
