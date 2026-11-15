'use client';
/**
 * Navegación espacial: TIERRA (misión principal) · ÓRBITA · MARTE · UNIVERSO.
 * Cambia el destino; las transiciones son desplazamientos de cámara (globo o escena espacial).
 */
import { Globe2, Orbit, Sparkles } from 'lucide-react';
import { useStore, type Destination } from '@/state/store';

function MarsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.6 6.2c2.2 1 4.6.4 8.6-.6M4.4 10.6c2-.6 4.4-.2 7.2.6" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
    </svg>
  );
}

const ITEMS: { id: Destination; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'earth', label: 'Tierra', hint: 'Observatorio de actividad térmica', icon: <Globe2 size={16} /> },
  { id: 'orbit', label: 'Órbita', hint: 'Satélites e instrumentos MODIS y VIIRS', icon: <Orbit size={16} /> },
  { id: 'mars', label: 'Marte', hint: 'Exploración (sección secundaria)', icon: <MarsIcon /> },
  { id: 'universe', label: 'Universo', hint: 'Contexto espacial (sección secundaria)', icon: <Sparkles size={16} /> },
];

export function DestinationNav() {
  const destination = useStore((s) => s.destination);
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const setDestination = useStore((s) => s.setDestination);
  if (phase !== 'observatory' || view !== 'global') return null;
  return (
    <nav className="dest-nav glass" aria-label="Destinos">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`dest-nav__item ${destination === it.id ? 'is-active' : ''}`}
          aria-pressed={destination === it.id}
          title={it.hint}
          onClick={() => setDestination(it.id)}
        >
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
