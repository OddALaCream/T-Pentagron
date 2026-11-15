'use client';
/**
 * Asistente astronauta: discreto tras la intro. Saluda una sola vez por sesión, luego solo
 * habla si el usuario lo abre. Sin audio. Se puede ocultar (preferencia persistida).
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useGlobeSnapshot } from '@/hooks/data';
import { formatDate } from '@/lib/time/dates';
import { useNarrator } from '@/state/narrator';
import { useStore } from '@/state/store';

/** Retrato del astronauta de la intro (misma identidad: casco blanco, visor dorado, LED ámbar). */
export function AstronautAvatar({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id="tp-visor" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffe2a6" stopOpacity="0.9" />
          <stop offset="0.25" stopColor="#8a5f22" />
          <stop offset="1" stopColor="#1a1206" />
        </radialGradient>
        <linearGradient id="tp-shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9c2cd" />
        </linearGradient>
      </defs>
      <path d="M8 46c1-8 7-12 16-12s15 4 16 12" fill="#cfd5dd" />
      <path d="M17 36h14" stroke="#8f98a4" strokeWidth="2" />
      <circle cx="24" cy="20" r="14" fill="url(#tp-shell)" />
      <ellipse cx="24" cy="21" rx="10.5" ry="8.5" fill="url(#tp-visor)" />
      <path d="M16.5 17.5c2.5-3 9-4 13-1.5" stroke="#fff6dc" strokeOpacity="0.55" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <circle cx="35.5" cy="27" r="1.6" fill="#ffb24a" />
    </svg>
  );
}

export function AstronautAssistant() {
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const destination = useStore((s) => s.destination);
  const assistant = useStore((s) => s.assistant);
  const setAssistant = useStore((s) => s.setAssistant);
  const layer = useStore((s) => s.layer);
  const date = useStore((s) => s.date);
  const selection = useStore((s) => s.selection);
  const { data: snap } = useGlobeSnapshot();
  // Mensajes de estado breves del observatorio (escaneo, celda sin observación, etc.).
  const status = useNarrator((s) => s.message);
  const statusTone = useNarrator((s) => s.tone);
  const statusNonce = useNarrator((s) => s.nonce);

  // Saludo único tras la intro (no se repite en la sesión).
  useEffect(() => {
    if (phase !== 'observatory' || assistant.greeted || assistant.hidden) return;
    const open = window.setTimeout(() => setAssistant({ open: true, greeted: true }), 1600);
    return () => window.clearTimeout(open);
  }, [phase, assistant.greeted, assistant.hidden, setAssistant]);
  // Al cambiar de destino la tarjeta se cierra: cada sección ya trae su propio panel.
  useEffect(() => {
    useStore.getState().setAssistant({ open: false });
  }, [destination]);
  useEffect(() => {
    if (!assistant.open) return;
    const close = window.setTimeout(() => setAssistant({ open: false }), 9000);
    return () => window.clearTimeout(close);
  }, [assistant.open, setAssistant]);

  if (phase !== 'observatory' || view !== 'global') return null;
  if (assistant.hidden) {
    return (
      <button type="button" className="astro-restore" onClick={() => setAssistant({ hidden: false })} aria-label="Mostrar asistente">
        <AstronautAvatar size={22} />
      </button>
    );
  }

  const active = snap?.totals?.activeCells ?? 0;
  let tip: string;
  if (destination === 'orbit') tip = 'Estas órbitas explican de dónde salen los datos: MODIS ve píxeles de 1 km y VIIRS de 375 m. Las posiciones son ilustrativas.';
  else if (destination === 'mars' || destination === 'universe') tip = 'Sección de contexto. La misión está en la Tierra: vuelve cuando quieras con «Volver a la Tierra».';
  else if (selection) tip = 'Celda seleccionada: en el panel verás detecciones, sensores y su evolución. Doble clic para explorar la zona.';
  else if (!assistant.greeted || active)
    tip = `Mira nuestro planeta: ${active ? `${active} celdas con detecciones` : 'detecciones'} del ${formatDate(date)} en la capa ${layer === 'harmonized' ? 'armonizada' : layer.toUpperCase()}. Toca una para inspeccionarla.`;
  else tip = 'Sin detecciones en esta fecha y filtros. Prueba otra fecha en la línea de tiempo.';

  return (
    <div className={`astro ${assistant.open ? 'is-open' : ''} ${destination === 'mars' || destination === 'universe' ? 'is-space' : ''} ${destination === 'orbit' ? 'is-orbit' : ''}`}>
      <button
        type="button"
        className="astro__avatar"
        aria-expanded={assistant.open}
        aria-label={assistant.open ? 'Cerrar asistente' : 'Abrir asistente'}
        onClick={() => setAssistant({ open: !assistant.open, greeted: true })}
      >
        <AstronautAvatar />
      </button>
      {!assistant.open && status && (
        <p key={statusNonce} className={`astro__say astro__say--${statusTone}`} role="status">{status}</p>
      )}
      {assistant.open && (
        <div className="astro__card glass" role="status">
          <p>{tip}</p>
          <p className="astro__fine">Una detección es un píxel caliente observado por satélite, no un incendio confirmado.</p>
          <div className="astro__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setAssistant({ open: false, hidden: true })}>Ocultar asistente</button>
            <button type="button" className="icon-close" onClick={() => setAssistant({ open: false })} aria-label="Cerrar"><X size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
