/**
 * Topographic contour lines, generated deterministically from a seed so server and client agree.
 * Each "peak" is a set of nested, wobbling rings, the way a survey map draws a hill.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Peak {
  cx: number;
  cy: number;
  rings: number;
  step: number;
  phase: number[];
  amp: number[];
}

function ring(p: Peak, r: number, k: number): string {
  const N = 72;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const wob =
      1 +
      p.amp[0]! * Math.sin(2 * th + p.phase[0]! + k * 0.13) +
      p.amp[1]! * Math.sin(3 * th + p.phase[1]! - k * 0.09) +
      p.amp[2]! * Math.sin(5 * th + p.phase[2]! + k * 0.21);
    const rr = r * wob;
    pts.push(`${(p.cx + rr * Math.cos(th)).toFixed(1)},${(p.cy + rr * Math.sin(th) * 0.78).toFixed(1)}`);
  }
  return "M" + pts.join("L") + "Z";
}

export function Contours({
  seed = 7,
  peaks = 4,
  width = 1440,
  height = 900,
  className = "",
  strong = false,
}: {
  seed?: number;
  peaks?: number;
  width?: number;
  height?: number;
  className?: string;
  strong?: boolean;
}) {
  const r = rng(seed);
  const list: Peak[] = Array.from({ length: peaks }, () => ({
    cx: r() * width,
    cy: r() * height,
    rings: 7 + Math.floor(r() * 7),
    step: 26 + r() * 22,
    phase: [r() * 6.28, r() * 6.28, r() * 6.28],
    amp: [0.08 + r() * 0.1, 0.05 + r() * 0.08, 0.02 + r() * 0.05],
  }));
  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {list.map((p, i) => (
        <g key={i} className={i % 2 ? "drift" : "drift-b"} style={{ animationDelay: `${-i * 7}s` }}>
          {Array.from({ length: p.rings }, (_, k) => (
            <path
              key={k}
              d={ring(p, p.step * (k + 1), k)}
              fill="none"
              stroke={k % 5 === 4 ? "var(--contour-strong)" : "var(--contour)"}
              strokeWidth={k % 5 === 4 ? (strong ? 1.4 : 1.1) : 0.8}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
