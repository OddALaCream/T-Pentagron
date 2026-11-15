'use client';
/**
 * "Voz" de la estrella guardiana: mensajes breves de estado que aparecen junto a ella.
 * Sobrios y científicos (sin infantilizar).
 */
import { create } from 'zustand';

interface NarratorState {
  message: string | null;
  tone: 'info' | 'scan' | 'warn';
  nonce: number;
  say: (message: string, tone?: NarratorState['tone'], ms?: number) => void;
  clear: () => void;
}

let timer: number | undefined;

export const useNarrator = create<NarratorState>()((set) => ({
  message: null,
  tone: 'info',
  nonce: 0,
  say: (message, tone = 'info', ms = 3800) => {
    if (typeof window !== 'undefined') {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => set({ message: null }), ms);
    }
    set((s) => ({ message, tone, nonce: s.nonce + 1 }));
  },
  clear: () => set({ message: null }),
}));

export const POKE_LINES = [
  'Vigía en línea. Observando MODIS y VIIRS.',
  'Sensores calibrados. Lista para escanear.',
  'Recuerda: una detección no es un incendio confirmado.',
  'Sin detección registrada no significa sin fuego.',
  'Resolución H3 6: unos 36 km² por celda.',
  'VIIRS ve focos más pequeños que MODIS (375 m vs 1 km).',
];
