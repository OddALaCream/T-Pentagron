'use client';
import { forwardRef, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { env } from '@/config/env';
import { useArchiveYears } from '@/state/store';

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: number; badge?: ReactNode }
>(function IconButton({ icon: Icon, label, active, size = 17, badge, className = '', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      <Icon size={size} aria-hidden="true" />
      {badge !== undefined && badge !== null && <span className="icon-btn__badge">{badge}</span>}
    </button>
  );
});

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  accent?: string;
}

/** Control segmentado accesible (radiogroup con flechas). */
export function Segmented<T extends string>({
  options, value, onChange, label, size = 'md', className = '',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`segmented segmented--${size} ${className}`} role="radiogroup" aria-label={label} data-own-keys>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          className={o.value === value ? 'is-on' : ''}
          style={o.accent ? ({ '--seg-accent': o.accent } as React.CSSProperties) : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

/** Pestañas accesibles (WAI-ARIA) con navegación por flechas. */
export function Tabs<T extends string>({
  tabs, value, onChange, label,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === value}
            tabIndex={t.id === value ? 0 : -1}
            className={t.id === value ? 'is-on' : ''}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {description && <span className="toggle__desc">{description}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

export function DemoBadge({ compact = false }: { compact?: boolean }) {
  const years = useArchiveYears();
  if (env.dataMode === 'api') return <span className="api-badge">{compact ? 'API' : `NASA FIRMS · Bolivia ${years}`}</span>;
  return (
    <span className="demo-badge" title="Todos los valores mostrados son datos simulados de demostración, no detecciones oficiales de NASA FIRMS.">
      <span className="demo-badge__dot" aria-hidden="true" />
      {compact ? 'DEMO' : 'Datos de demostración'}
    </span>
  );
}

export function Stat({ label, value, unit, hint, tone }: { label: string; value: ReactNode; unit?: string; hint?: string; tone?: string }) {
  return (
    <div className="stat" title={hint} style={tone ? ({ '--stat-tone': tone } as React.CSSProperties) : undefined}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </span>
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <h3>{children}</h3>
      {aside}
    </div>
  );
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'demo' }) {
  return <p className={`note note--${tone}`}>{children}</p>;
}
