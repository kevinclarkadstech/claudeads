import { useEffect, useId, useRef, useState } from "react";
import { shortDate } from "../lib/format";

interface Point {
  date: string;
  value: number;
}

/** "Nice" axis maximum and tick step for a 0-based y scale. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * Math.ceil(max / step), step };
}

const PAD = { top: 12, right: 12, bottom: 24, left: 52 };
const HEIGHT = 180;

/**
 * Single-series line chart with a recessive grid, a crosshair + tooltip on hover/touch,
 * and arrow-key navigation. No legend: the title names the series.
 */
export function LineChart({
  title,
  points,
  format,
  formatAxis = format,
}: {
  title: string;
  points: Point[];
  format: (v: number) => string;
  formatAxis?: (v: number) => string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const { top, step } = niceScale(Math.max(0, ...points.map((p) => p.value)));
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const yTicks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) yTicks.push(v);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / innerW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  }

  const a = active !== null ? points[active] : null;

  return (
    <figure className="chart" ref={wrap}>
      <figcaption id={titleId} className="chart-title">{title}</figcaption>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end">{formatAxis(v)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text
              key={p.date}
              className="axis"
              x={x(i)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? "start" : x(i) > width - PAD.right - 30 ? "end" : "middle"}
            >
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
        <path className="series" d={path} />
        {a && active !== null && (
          <g>
            <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} />
            <circle className="marker" cx={x(active)} cy={y(a.value)} r={4.5} />
          </g>
        )}
        {/* Full-area hit target. */}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" />
      </svg>
      {a && active !== null && (
        <div
          className="tooltip"
          role="status"
          style={{
            left: Math.min(Math.max(x(active), 70), width - 70),
            top: Math.max(0, y(a.value) - 8),
          }}
        >
          <span className="muted">{shortDate(a.date)}</span>
          <strong>{format(a.value)}</strong>
        </div>
      )}
    </figure>
  );
}
