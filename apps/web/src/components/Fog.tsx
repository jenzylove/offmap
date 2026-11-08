import type { ReactNode } from "react";

/**
 * An uncharted region, drawn like an old chart: a dotted coastline, hatching, and fog that breathes over it.
 * Children render underneath the fog.
 */
export function Fog({ children, label = "Terra incognita", lifted = false }: { children?: ReactNode; label?: string; lifted?: boolean }) {
  return (
    <div className="relative isolate overflow-hidden">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 300">
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--contour)" strokeWidth="1" />
          </pattern>
        </defs>
        <path
          d="M24,46 C70,18 140,30 190,22 C252,12 318,30 372,54 C392,98 384,150 378,198 C372,246 330,282 270,280 C200,278 150,290 96,276 C46,262 20,226 22,170 C24,120 8,86 24,46 Z"
          fill="url(#hatch)"
          stroke="var(--ink-3)"
          strokeWidth="1.2"
          strokeDasharray="2 5"
          vectorEffect="non-scaling-stroke"
          opacity={lifted ? 0.35 : 1}
        />
      </svg>
      <div className="relative">{children}</div>
      {!lifted && (
        <>
          <svg aria-hidden="true" className="breathe pointer-events-none absolute -inset-[12%] h-[124%] w-[124%]" preserveAspectRatio="none" viewBox="0 0 400 300">
            <defs>
              <filter id="fogf" x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="4" result="n" />
                <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.6 -0.15" result="a" />
                <feComposite in="SourceGraphic" in2="a" operator="in" />
              </filter>
              <radialGradient id="fogmask" cx="50%" cy="50%" r="60%">
                <stop offset="0" stopColor="var(--paper)" stopOpacity="0.8" />
                <stop offset="1" stopColor="var(--paper)" stopOpacity="0.45" />
              </radialGradient>
            </defs>
            <rect width="400" height="300" fill="url(#fogmask)" />
            <rect width="400" height="300" fill="var(--paper)" filter="url(#fogf)" opacity="0.9" />
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="italic-serif text-[clamp(26px,3.4vw,44px)] leading-none text-ink-2">{label}</div>
              <div className="eyebrow mt-3">uncharted · not on any public map</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
