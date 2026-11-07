// A small SVG line/area chart drawn to one scale. Colours come from CSS tokens so it follows the theme.
import { short } from "../../lib/format";

type Pt = [number, number];
export interface PlotProps {
  label: string;
  w?: number;
  h?: number;
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax: number;
  areas?: { color: string; opacity?: number; hi: Pt[]; lo: Pt[] }[];
  lines?: { color: string; pts: Pt[]; width?: number; dash?: string; end?: boolean }[];
  marks?: { x: number; label: string }[];
  xTicks?: { x: number; label: string; anchor?: "start" | "middle" | "end" }[];
}

export function niceTicks(min: number, max: number, n = 4): number[] {
  if (max <= min) max = min + 1;
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const t: number[] = [];
  for (let v = lo; v < max + step * 0.999; v += step) t.push(+v.toFixed(6));
  return t;
}

export function Plot(o: PlotProps) {
  const w = o.w ?? 680, h = o.h ?? 240, pl = 62, pr = 16, pt = 12, pb = 26;
  const ticks = niceTicks(Math.min(0, o.yMin ?? 0), o.yMax);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (x: number) => pl + ((x - o.xMin) / (o.xMax - o.xMin || 1)) * (w - pl - pr);
  const Y = (y: number) => pt + (1 - (y - y0) / (y1 - y0 || 1)) * (h - pt - pb);
  const pts = (a: Pt[]) => a.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  return (
    <svg className="plot" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={o.label}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} />
          <text x={pl - 8} y={Y(t) + 4} textAnchor="end">{short(t)}</text>
        </g>
      ))}
      {o.areas?.map((a, i) => (
        <polygon key={i} points={pts(a.hi) + " " + pts([...a.lo].reverse())} style={{ fill: a.color, fillOpacity: a.opacity ?? 0.85, stroke: "none" }} />
      ))}
      {o.lines?.map((l, i) =>
        l.pts.length ? (
          <g key={i}>
            <polyline points={pts(l.pts)} style={{ fill: "none", stroke: l.color, strokeWidth: l.width ?? 2, strokeLinejoin: "round", strokeLinecap: "round", strokeDasharray: l.dash }} />
            {l.end && <circle cx={X(l.pts[l.pts.length - 1][0])} cy={Y(l.pts[l.pts.length - 1][1])} r={3.5} style={{ fill: l.color, stroke: "var(--surface)", strokeWidth: 1.5 }} />}
          </g>
        ) : null,
      )}
      {o.marks?.map((m, i) => {
        const x = X(m.x);
        const right = x > w - 160;
        const lab = m.label.length > 22 ? m.label.slice(0, 21) + "…" : m.label;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={pt} y2={h - pb} style={{ stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" }} />
            <text x={right ? x - 4 : x + 4} y={pt + 10 + i * 14} textAnchor={right ? "end" : "start"}>{lab}</text>
          </g>
        );
      })}
      {o.xTicks?.map((t, i) => (
        <text key={i} x={X(t.x)} y={h - 8} textAnchor={t.anchor ?? "middle"}>{t.label}</text>
      ))}
    </svg>
  );
}
