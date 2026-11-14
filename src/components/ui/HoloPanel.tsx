'use client';
/**
 * Panel holográfico / fragmento mineral flotante.
 *
 * Entrada: proyección de partículas desde el punto de origen (celda en el globo) →
 * se traza el contorno luminoso → se construye la superficie translúcida (barrido) →
 * el contenido se materializa. Después flota suavemente y responde al cursor.
 * Salida: el contenido se disuelve y la superficie colapsa en una línea de luz.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { Maximize2, Minimize2, Minus, X, ChevronUp } from 'lucide-react';
import { isReducedMotion } from '@/state/store';

interface HoloPanelProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  origin?: { x: number; y: number } | null;
  minimized?: boolean;
  expanded?: boolean;
  onClose?: () => void;
  onMinimize?: (v: boolean) => void;
  onExpand?: (v: boolean) => void;
  className?: string;
  children: ReactNode;
  toolbar?: ReactNode;
  ariaLabel: string;
  accent?: string;
}

function chamferPath(w: number, h: number, a = 18, b = 28): string {
  return `M${a} 0.5 H${w - 0.5} V${h - b} L${w - b} ${h - 0.5} H0.5 V${a} Z`;
}

export function HoloPanel({
  open, title, subtitle, eyebrow, icon, origin, minimized, expanded, onClose, onMinimize, onExpand, className = '', children,
  toolbar, ariaLabel, accent,
}: HoloPanelProps) {
  const [present, setPresent] = useState(open);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setPresent(true);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<SVGPathElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 400, h: 500 });
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // Contorno ajustado al tamaño real.
  useEffect(() => {
    if (!present) return;
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(40, width), h: Math.max(40, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [present]);

  const runParticles = useCallback((from: { x: number; y: number }, to: DOMRect, reverse = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = 90;
    const parts = Array.from({ length: n }, () => ({
      tx: to.left + Math.random() * to.width,
      ty: to.top + Math.random() * to.height,
      d: Math.random() * 0.25,
      s: 0.6 + Math.random() * 1.8,
      c: Math.random() < 0.7 ? '150,230,255' : '190,170,255',
    }));
    const state = { t: 0 };
    gsap.to(state, {
      t: 1,
      duration: reverse ? 0.45 : 0.62,
      ease: 'power2.inOut',
      onUpdate: () => {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        for (const p of parts) {
          const k = Math.min(1, Math.max(0, (state.t - p.d) / (1 - p.d)));
          const e = reverse ? 1 - k : k;
          const x = from.x + (p.tx - from.x) * e;
          const y = from.y + (p.ty - from.y) * e + Math.sin(e * Math.PI) * -24;
          const a = Math.sin(k * Math.PI) * 0.9;
          ctx.fillStyle = `rgba(${p.c},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, p.s, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      onComplete: () => ctx.clearRect(0, 0, window.innerWidth, window.innerHeight),
    });
  }, []);

  // Animación de entrada.
  useLayoutEffect(() => {
    if (!open || !present) return;
    const root = rootRef.current;
    const surface = surfaceRef.current;
    if (!root || !surface) return;
    tlRef.current?.kill();
    const reduced = isReducedMotion();
    const items = root.querySelectorAll('[data-holo-item]');
    if (reduced) {
      tlRef.current = gsap.timeline().fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      return;
    }
    const rect = surface.getBoundingClientRect();
    const from = origin ?? { x: rect.left - 80, y: rect.top + rect.height / 2 };
    runParticles(from, rect);
    const frame = frameRef.current;
    const length = frame ? frame.getTotalLength() : 2000;
    const tl = gsap.timeline();
    tl.set(root, { opacity: 1 });
    if (frame) tl.fromTo(frame, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, 0.18);
    tl.fromTo(surface, { clipPath: 'inset(48% 0% 48% 0%)', opacity: 0.2, filter: 'blur(6px)' }, { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out' }, 0.38);
    tl.fromTo(items, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.045, ease: 'power2.out' }, 0.62);
    tl.add(() => {
      surface.style.clipPath = '';
      surface.style.filter = '';
    });
    tlRef.current = tl;
    return () => {
      tl.kill();
    };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, present]);

  // Animación de salida.
  useEffect(() => {
    if (open || !present) return;
    const root = rootRef.current;
    const surface = surfaceRef.current;
    if (!root || !surface) {
      setPresent(false);
      return;
    }
    tlRef.current?.kill();
    if (isReducedMotion()) {
      const tl = gsap.to(root, { opacity: 0, duration: 0.18, onComplete: () => setPresent(false) });
      return () => {
        tl.kill();
      };
    }
    const rect = surface.getBoundingClientRect();
    runParticles(origin ?? { x: rect.left - 60, y: rect.top + rect.height / 2 }, rect, true);
    const tl = gsap.timeline({ onComplete: () => setPresent(false) });
    tl.to(root.querySelectorAll('[data-holo-item]'), { opacity: 0, y: -6, duration: 0.18, stagger: 0.015 }, 0);
    tl.to(surface, { clipPath: 'inset(49.5% 0% 49.5% 0%)', duration: 0.32, ease: 'power3.in' }, 0.08);
    tl.to(root, { opacity: 0, duration: 0.16 }, 0.36);
    return () => {
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, present]);

  // Respuesta al cursor (inclinación sutil + reflejo).
  useEffect(() => {
    if (!present) return;
    const root = rootRef.current;
    if (!root || window.matchMedia('(pointer: coarse)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (isReducedMotion()) return;
        const r = root.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 1.2)));
        const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height * 1.2)));
        root.style.setProperty('--tilt-x', `${(-dy * 1.6).toFixed(2)}deg`);
        root.style.setProperty('--tilt-y', `${(dx * 2.2).toFixed(2)}deg`);
        root.style.setProperty('--sheen-x', `${((e.clientX - r.left) / r.width) * 100}%`);
        root.style.setProperty('--sheen-y', `${((e.clientY - r.top) / r.height) * 100}%`);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [present]);

  if (!present) return null;

  return (
    <>
      <canvas ref={canvasRef} className="holo-particles" aria-hidden="true" />
      <section
        ref={rootRef}
        className={`holo ${minimized ? 'is-minimized' : ''} ${expanded ? 'is-expanded' : ''} ${className}`}
        aria-label={ariaLabel}
        style={{ opacity: 0, ...(accent ? ({ '--holo-accent': accent } as React.CSSProperties) : {}) }}
      >
        <div className="holo__float">
          <div ref={surfaceRef} className="holo__surface">
            <svg className="holo__frame" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
              <defs>
                <linearGradient id="holo-edge" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--holo-accent, #8fdcff)" stopOpacity="0.95" />
                  <stop offset="0.45" stopColor="#a68bff" stopOpacity="0.35" />
                  <stop offset="1" stopColor="var(--holo-accent, #8fdcff)" stopOpacity="0.7" />
                </linearGradient>
              </defs>
              <path ref={frameRef} d={chamferPath(size.w, size.h)} fill="none" stroke="url(#holo-edge)" strokeWidth="1" />
              <path d={`M18 0.5 L0.5 18`} stroke="var(--holo-accent, #8fdcff)" strokeOpacity="0.9" strokeWidth="1.5" />
              <path d={`M${size.w - 0.5} ${size.h - 28} L${size.w - 28} ${size.h - 0.5}`} stroke="#a68bff" strokeOpacity="0.8" strokeWidth="1.5" />
            </svg>
            <div className="holo__facets" aria-hidden="true" />
            <header className="holo__header" data-holo-item>
              {icon && <span className="holo__icon">{icon}</span>}
              <div className="holo__titles">
                {eyebrow && <span className="holo__eyebrow">{eyebrow}</span>}
                <h2 className="holo__title">{title}</h2>
                {subtitle && <span className="holo__subtitle">{subtitle}</span>}
              </div>
              <div className="holo__controls">
                {onMinimize && (
                  <button type="button" className="icon-btn icon-btn--ghost" onClick={() => onMinimize(!minimized)} aria-label={minimized ? 'Restaurar panel' : 'Minimizar panel'} title={minimized ? 'Restaurar' : 'Minimizar'}>
                    {minimized ? <ChevronUp size={16} /> : <Minus size={16} />}
                  </button>
                )}
                {onExpand && !minimized && (
                  <button type="button" className="icon-btn icon-btn--ghost hide-compact" onClick={() => onExpand(!expanded)} aria-label={expanded ? 'Reducir panel' : 'Expandir panel'} title={expanded ? 'Reducir' : 'Expandir'}>
                    {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                )}
                {onClose && (
                  <button type="button" className="icon-btn icon-btn--ghost" onClick={onClose} aria-label="Cerrar panel" title="Cerrar (Esc)">
                    <X size={16} />
                  </button>
                )}
              </div>
            </header>
            {toolbar && !minimized && <div className="holo__toolbar" data-holo-item>{toolbar}</div>}
            {!minimized && <div className="holo__body">{children}</div>}
          </div>
        </div>
      </section>
    </>
  );
}
