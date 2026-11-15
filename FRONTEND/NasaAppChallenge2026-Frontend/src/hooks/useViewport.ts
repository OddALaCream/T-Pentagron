'use client';
import { useEffect, useState, type RefObject } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

/** The globe follows the space left by controls and panels, not the whole window. */
export function useElementSize(ref: RefObject<HTMLElement | null>): ViewportSize | null {
  const [size, setSize] = useState<ViewportSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
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
