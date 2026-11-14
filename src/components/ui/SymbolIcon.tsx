import { CATEGORY, type VisualKind } from '@/lib/science/categories';

/** Símbolo SVG de cada categoría (idéntico en forma al marcador del globo). */
export function SymbolIcon({ kind, size = 14, animated = false, title }: { kind: VisualKind; size?: number; animated?: boolean; title?: string }) {
  const meta = CATEGORY[kind];
  const c = meta.color;
  const common = { fill: c, stroke: 'rgba(255,255,255,0.55)', strokeWidth: 1 };
  let shape: React.ReactNode;
  switch (meta.symbol) {
    case 'circle':
      shape = <circle cx="8" cy="8" r="4.6" {...common} />;
      break;
    case 'triangle':
      shape = <path d="M8 2.6 L13.4 12.4 L2.6 12.4 Z" {...common} strokeLinejoin="round" />;
      break;
    case 'diamond':
      shape = <path d="M8 1.8 L14.2 8 L8 14.2 L1.8 8 Z" {...common} strokeLinejoin="round" />;
      break;
    case 'hexagon':
      shape = <path d="M8 2 L13.2 5 L13.2 11 L8 14 L2.8 11 L2.8 5 Z" {...common} strokeLinejoin="round" />;
      break;
    case 'wave':
      shape = (
        <g fill="none" stroke={c} strokeWidth="1.4">
          <circle cx="8" cy="8" r="2" fill={c} stroke="none" />
          <circle cx="8" cy="8" r="4.6" opacity="0.85" />
          <circle cx="8" cy="8" r="7" opacity="0.4" />
        </g>
      );
      break;
    case 'void':
      shape = (
        <g fill="none" stroke={c} strokeWidth="1.6">
          <circle cx="8" cy="8" r="5" />
          <path d="M4.4 11.6 L11.6 4.4" />
        </g>
      );
      break;
    default:
      shape = <circle cx="8" cy="8" r="2.2" fill={c} opacity="0.7" />;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`symbol-icon symbol-icon--${kind}${animated ? ' is-animated' : ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {shape}
    </svg>
  );
}
