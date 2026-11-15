'use client';
import { useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { CATEGORY, LEGEND_ORDER } from '@/lib/science/categories';
import { useStore } from '@/state/store';
import { SymbolIcon } from '@/components/ui/SymbolIcon';

/** Leyenda interactiva: color + símbolo + comportamiento; clic para mostrar/ocultar. */
export function Legend() {
  // En pantallas bajas empieza plegada para no tapar a la estrella ni al planeta.
  const [open, setOpen] = useState(false);
  const kinds = useStore((s) => s.filters.kinds);
  const toggleKind = useStore((s) => s.toggleKind);
  const layer = useStore((s) => s.layer);
  const drawer = useStore((s) => s.drawer);
  const order = LEGEND_ORDER.filter((k) => (layer === 'prediction' ? k !== 'anomaly' : k !== 'forecast'));
  return (
    <aside className={`legend glass ${open ? 'is-open' : ''} ${drawer ? 'is-behind' : ''}`} aria-label="Leyenda" data-reveal>
      <button type="button" className="legend__head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Leyenda</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="legend__list">
          {order.map((k) => {
            const m = CATEGORY[k];
            const on = kinds[k];
            return (
              <li key={k}>
                <button type="button" className={`legend__item ${on ? '' : 'is-off'}`} onClick={() => toggleKind(k)} aria-pressed={on} title={`${m.description} — clic para ${on ? 'ocultar' : 'mostrar'}`}>
                  <SymbolIcon kind={k} size={15} animated={on} />
                  <span className="legend__text">
                    <span className="legend__label">{m.label}</span>
                    <span className="legend__behavior">{m.behavior}</span>
                  </span>
                  {on ? <Eye size={13} className="legend__eye" /> : <EyeOff size={13} className="legend__eye" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <p className="legend__foot">Vista agrupada: acércate para inspeccionar celdas. Los totales incluyen todas las detecciones. Detección térmica ≠ incendio confirmado.</p>}
    </aside>
  );
}
