'use client';
import dynamic from 'next/dynamic';

/** Carga diferida de toda la experiencia (WebGL, GSAP, datos) solo en el cliente. */
const Experience = dynamic(() => import('./Experience'), {
  ssr: false,
  loading: () => (
    <div className="boot" role="status">
      <span className="boot__pulse" aria-hidden="true" />
      <span>Iniciando observatorio…</span>
    </div>
  ),
});

export function ExperienceLoader() {
  return <Experience />;
}
