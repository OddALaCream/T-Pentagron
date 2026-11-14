'use client';
import { useEffect, useState } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

/** Tamaño de la ventana (con rebote mínimo). */
export function useViewport(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() =>
    typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize({ width: window.innerWidth, height: window.innerHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

export function useIsCompact(): boolean {
  const { width } = useViewport();
  return width < 900;
}
