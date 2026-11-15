/** Monograma de la estrella guardiana (SVG, sin dependencias de marca). */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
      <defs>
        <radialGradient id="bm-core" cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor="#fff7e2" />
          <stop offset="0.55" stopColor="#ffc56e" />
          <stop offset="1" stopColor="#ff8a3d" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="none" stroke="rgba(143,220,255,0.35)" strokeWidth="0.8" strokeDasharray="2 3" />
      <path
        d="M16 4.5c1.1 4.6 2.6 6.4 7.6 7.1-3.8 2.6-4.6 4.6-3.4 9.3-3.9-2.8-5.8-2.8-8.4 0 1.1-4.7.4-6.7-3.4-9.3 5-.7 6.5-2.5 7.6-7.1z"
        fill="url(#bm-core)"
      />
      <path d="M10.6 13.6h10.8" stroke="#0b1424" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10.9 13.6h10.2" stroke="#7fe8ff" strokeWidth="0.9" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
