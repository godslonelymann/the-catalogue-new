// The price chart from the landing page's Features section (src/components/landing/ui/interactive-area-chart.tsx),
// adapted for real prices in the dashboard:
// - straight lines between days, because a curve would show prices that never existed,
// - prices in the store currency's minor unit,
// - a flat line (a price that never changed) gets a visible range,
// - dashboard colour tokens in place of the landing palette,
// - each price change marked on the line, a dashed line at the lowest price, and a header that says what happened.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { money } from "@/lib/format";
import { priceChanges, priceRange, type ChartPoint, type PriceChange } from "./series";

export type ChartRanges = Record<string, ChartPoint[]>;

const N = 180; // every range is resampled to N points so ranges can morph 1:1. Dense, so steps stay sharp.
const MAX_LABELS = 4; // more changes keep their dots, and only the biggest get a label
const PAD = { t: 16, r: 12, b: 28, l: 64 };
const TIP_W = 132;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const f = (n: number) => Math.round(n * 100) / 100;

/** Linear sampling: no overshoot, so the line never shows a price that wasn't charged. */
function sample(values: number[], pos: number) {
  if (values.length === 1) return values[0];
  const i = Math.min(Math.floor(pos), values.length - 2);
  return values[i] + (values[i + 1] - values[i]) * (pos - i);
}

function niceScale(min: number, max: number, count = 4) {
  // A price that never changed still needs a range, so the line sits in the middle.
  if (max - min < 1) {
    const pad = Math.max(Math.abs(max) * 0.1, 100);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const lo = Math.max(0, Math.floor(min / step) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

interface RangeModel {
  pts: ChartPoint[];
  ny: Float64Array;
  lo: number;
  hi: number;
  ticks: number[];
  changes: PriceChange[];
  labelled: Set<number>;
  low: ChartPoint;
  /** Days the range button asks for, such as 90 for "90D". */
  rangeDays: number;
}

function buildModel(data: ChartRanges) {
  const out: Record<string, RangeModel> = {};
  for (const [key, pts] of Object.entries(data)) {
    const vals = pts.map(p => p.value);
    const { lo, hi, ticks } = niceScale(Math.min(...vals), Math.max(...vals));
    const ny = new Float64Array(N);
    for (let k = 0; k < N; k++) ny[k] = (sample(vals, (k / (N - 1)) * (vals.length - 1)) - lo) / (hi - lo);
    const changes = priceChanges(pts);
    const biggest = [...changes].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, MAX_LABELS);
    out[key] = {
      pts,
      ny,
      lo,
      hi,
      ticks,
      changes,
      labelled: new Set(biggest.map(change => change.index)),
      low: priceRange(pts)!.low,
      rangeDays: Number.parseInt(key, 10) || pts.length,
    };
  }
  return out;
}

const fmtDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** "in 90 days" when the series covers the whole range, otherwise "since 9 Oct". */
function spanText(m: RangeModel) {
  return m.pts.length >= m.rangeDays ? `in ${m.rangeDays} days` : `since ${fmtDay.format(m.pts[0].date)}`;
}

/** One line that says what happened to the price. */
function story(m: RangeModel, currency: string): string {
  const last = m.changes.at(-1);
  const now = m.pts[m.pts.length - 1].value;
  if (!last) return m.pts.length >= m.rangeDays ? `Same price for ${m.rangeDays} days` : `Same price since ${fmtDay.format(m.pts[0].date)}`;
  const amount = money(Math.abs(last.to - last.from), currency);
  if (last.to < last.from) {
    const lowest = now <= m.low.value ? `lowest ${spanText(m)}` : `lowest was ${money(m.low.value, currency)}`;
    return `↓ ${amount} on ${fmtDay.format(last.date)} · ${lowest}`;
  }
  return `↑ ${amount} on ${fmtDay.format(last.date)} · was ${money(last.from, currency)}`;
}

/** The whole history in words, for screen readers. */
function spoken(m: RangeModel, currency: string, title: string): string {
  const parts = [`${title}. ${money(m.pts[0].value, currency)} on ${fmtDay.format(m.pts[0].date)}.`];
  for (const change of m.changes.slice(-6)) {
    parts.push(`${change.to < change.from ? "Dropped" : "Rose"} to ${money(change.to, currency)} on ${fmtDay.format(change.date)}.`);
  }
  parts.push(`Now ${money(m.pts[m.pts.length - 1].value, currency)}. Lowest ${money(m.low.value, currency)}.`);
  parts.push("Use the left and right arrow keys to move between price changes.");
  return parts.join(" ");
}

const linePath = (p: [number, number][]) => p.map(([x, y], i) => `${i ? "L" : "M"}${f(x)} ${f(y)}`).join("");

const fmtTip = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const axisFmt = (len: number, narrow: boolean) =>
  new Intl.DateTimeFormat(undefined, narrow ? { month: "numeric", day: "numeric", timeZone: "UTC" } : len <= 60 ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", timeZone: "UTC" });

/**
 * A price line with range buttons, a hover and keyboard tooltip, and a draw-in on first show.
 * Needs at least two points per range. Give it a new `key` when the data is for another option.
 */
export function PriceChart({
  data,
  currency,
  defaultRange,
  title,
  height = 220,
  className = "",
}: {
  data: ChartRanges;
  currency: string;
  defaultRange?: string;
  title: string;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const model = useMemo(() => buildModel(data), [data]);
  const keys = Object.keys(model);

  const [range, setRange] = useState(defaultRange && keys.includes(defaultRange) ? defaultRange : keys[0]);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<Float64Array>(model[range].ny);
  const toRef = useRef<Float64Array>(model[range].ny);
  const morphCtl = useRef<{ stop: () => void } | null>(null);
  const started = useRef(false);
  const lastHover = useRef(0);

  const money0 = (v: number) => money(Math.round(v / 100) * 100, currency);
  const t = useMotionValue(1);
  const ver = useMotionValue(0);
  const wMV = useMotionValue(0);
  const reveal = useMotionValue(reduce ? 1 : 0);
  const cx = useMotionValue(0);
  const cxS = useSpring(cx, { stiffness: 520, damping: 42, mass: 0.6 });

  const innerH = height - PAD.t - PAD.b;
  const bottom = PAD.t + innerH;
  const yPx = (n: number) => PAD.t + (1 - n) * innerH;
  const disp = (k: number) => {
    const a = fromRef.current[k];
    return a + (toRef.current[k] - a) * t.get();
  };
  const points = (w: number) => {
    const iw = Math.max(1, w - PAD.l - PAD.r);
    return Array.from({ length: N }, (_, k) => [PAD.l + (k / (N - 1)) * iw, yPx(disp(k))] as [number, number]);
  };
  const sampleY = (frac: number) => {
    const k = clamp(frac, 0, 1) * (N - 1);
    const i = Math.min(Math.floor(k), N - 2);
    const a = disp(i);
    return yPx(a + (disp(i + 1) - a) * (k - i));
  };

  const lineD = useTransform([t, wMV, ver], () => {
    const w = wMV.get();
    return w ? linePath(points(w)) : "M0 0";
  });
  const areaD = useTransform([t, wMV, ver], () => {
    const w = wMV.get();
    if (!w) return "M0 0";
    const p = points(w);
    return `${linePath(p)}L${f(p[N - 1][0])} ${bottom}L${f(p[0][0])} ${bottom}Z`;
  });
  const clipW = useTransform([reveal, wMV], ([r, w]: number[]) => (r >= 0.999 ? w : PAD.l + Math.max(0, w - PAD.l - PAD.r) * r));
  const leadX = useTransform([reveal, wMV], ([r, w]: number[]) => PAD.l + Math.max(0, w - PAD.l - PAD.r) * r);
  const leadY = useTransform([reveal, t, wMV, ver], ([r]: number[]) => sampleY(r));
  const leadO = useTransform(reveal, [0, 0.02, 0.96, 1], [0, 1, 1, 0]);
  // Markers appear once the line has drawn in.
  const marksO = useTransform(reveal, [0.85, 1], [0, 1]);
  const dotY = useTransform([cxS, t, wMV, ver], ([c]: number[]) => sampleY((c - PAD.l) / Math.max(1, wMV.get() - PAD.l - PAD.r)));
  const tipX = useTransform([cxS, wMV], ([c, w]: number[]) => clamp(c - TIP_W / 2, 0, Math.max(0, w - TIP_W)));

  // Track the width, and draw the line in once it is known.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const start = (w: number) => {
      setWidth(w);
      wMV.set(w);
      if (started.current) return;
      started.current = true;
      if (reduce) reveal.set(1);
      else animate(reveal, 1, { duration: 1.1, ease: EASE_IN_OUT });
    };
    const initial = Math.round(el.getBoundingClientRect().width || el.offsetWidth || 0);
    if (initial > 0) start(initial);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) start(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = model[range] ?? model[keys[0]];
  const len = m.pts.length;

  const changeRange = (next: string) => {
    if (next === range) return;
    morphCtl.current?.stop();
    const e = t.get();
    const cur = new Float64Array(N);
    for (let k = 0; k < N; k++) cur[k] = fromRef.current[k] + (toRef.current[k] - fromRef.current[k]) * e;
    fromRef.current = cur;
    toRef.current = model[next].ny;
    t.set(0);
    ver.set(ver.get() + 1);
    morphCtl.current = animate(t, 1, { duration: reduce ? 0 : 0.55, ease: EASE_IN_OUT });
    setRange(next);
    setHover(null);
  };

  const moveTo = (idx: number) => {
    const iw = Math.max(1, width - PAD.l - PAD.r);
    const target = PAD.l + (len > 1 ? idx / (len - 1) : 0.5) * iw;
    cx.set(target);
    if (hover === null) cxS.jump(target);
    lastHover.current = idx;
    setHover(idx);
  };
  const onScrub = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const frac = clamp((e.clientX - box.left - PAD.l) / Math.max(1, width - PAD.l - PAD.r), 0, 1);
    moveTo(Math.round(frac * (len - 1)));
  };

  const shown = m.pts[hover ?? len - 1];
  const tipIndex = Math.min(lastHover.current, len - 1);
  const tipPt = m.pts[tipIndex];
  const tipChange = m.changes.find(change => change.index === tipIndex);
  const hoverChange = hover === null ? undefined : m.changes.find(change => change.index === hover);
  // Arrow keys stop at the first day, each change, and today.
  const stops = [...new Set([0, ...m.changes.map(change => change.index), len - 1])].sort((a, b) => a - b);
  const narrow = width > 0 && width < 380;
  const iw = Math.max(1, width - PAD.l - PAD.r);
  const xAt = (index: number) => PAD.l + (len > 1 ? index / (len - 1) : 0) * iw;
  const yAt = (value: number) => yPx((value - m.lo) / (m.hi - m.lo));
  const lastValue = m.pts[len - 1].value;
  const showLowest = m.changes.length > 0;
  // The lowest-price label goes on the side where the line is away from it.
  const lowestLeft = lastValue === m.low.value && m.pts[0].value !== m.low.value;
  const axis = axisFmt(len, narrow);
  const labelCount = narrow ? 3 : width < 520 ? 4 : 5;
  const xLabels = [...new Set(Array.from({ length: labelCount }, (_, j) => Math.round((j / (labelCount - 1)) * (len - 1))))];

  return (
    <div className={`w-full ${className}`}>
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="dash-meta">{title}</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{money(shown.value, currency)}</p>
          <p className="dash-meta mt-1 tabular-nums">
            {hover === null ? (
              <span className="font-medium text-foreground">{story(m, currency)}</span>
            ) : hoverChange ? (
              <>
                <span className="font-medium text-foreground">
                  {hoverChange.to < hoverChange.from ? "↓" : "↑"} {money(Math.abs(hoverChange.to - hoverChange.from), currency)}
                </span>{" "}
                from {money(hoverChange.from, currency)} on {fmtTip.format(shown.date)}
              </>
            ) : (
              `on ${fmtTip.format(shown.date)}`
            )}
          </p>
        </div>

        {keys.length > 1 && (
          <div role="tablist" aria-label="Range" className="flex shrink-0 self-start rounded-full border bg-secondary p-0.5 sm:self-auto">
            {keys.map(k => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={k === range}
                onClick={() => changeRange(k)}
                className={`relative z-10 min-h-9 rounded-full px-3 text-xs font-medium outline-none transition-[color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] ${
                  k === range ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {k === range && (
                  <motion.span
                    layoutId={`${uid}-pill`}
                    className="absolute inset-0 -z-10 rounded-full border bg-background"
                    transition={{ type: "spring", duration: 0.3, bounce: 0.15 }}
                  />
                )}
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={wrapRef} className="relative" style={{ height }}>
        {width > 0 && (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              tabIndex={0}
              aria-label={spoken(m, currency, title)}
              className="block text-foreground outline-none select-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={e => {
                const at = hover ?? len - 1;
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  moveTo(stops.find(stop => stop > at) ?? len - 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  moveTo([...stops].reverse().find(stop => stop < at) ?? 0);
                } else if (e.key === "Home" || e.key === "End") {
                  e.preventDefault();
                  moveTo(e.key === "Home" ? 0 : len - 1);
                } else if (e.key === "Escape") setHover(null);
              }}
              onBlur={() => setHover(null)}
            >
              <defs>
                <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
                <clipPath id={`${uid}-clip`}>
                  <motion.rect x={0} y={0} height={height} width={clipW} />
                </clipPath>
              </defs>

              <AnimatePresence>
                <motion.g key={range} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
                  {m.ticks.map(v => {
                    const y = yPx((v - m.lo) / (m.hi - m.lo));
                    return (
                      <g key={v}>
                        <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} stroke="currentColor" className="text-border" />
                        <text x={PAD.l - 10} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                          {money0(v)}
                        </text>
                      </g>
                    );
                  })}
                  {xLabels.map((idx, j) => (
                    <text
                      key={idx}
                      x={PAD.l + (len > 1 ? idx / (len - 1) : 0) * (width - PAD.l - PAD.r)}
                      y={height - 6}
                      textAnchor={j === 0 ? "start" : j === xLabels.length - 1 ? "end" : "middle"}
                      className="fill-muted-foreground text-[11px]"
                    >
                      {axis.format(m.pts[idx].date)}
                    </text>
                  ))}
                </motion.g>
              </AnimatePresence>

              <g clipPath={`url(#${uid}-clip)`}>
                <motion.path d={areaD} fill={`url(#${uid}-fill)`} />
                <motion.path d={lineD} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <motion.circle cx={leadX} cy={leadY} r={3.5} fill="currentColor" style={{ opacity: leadO }} />

              {/* Price changes and the lowest price, in the chart itself. */}
              <AnimatePresence>
                <motion.g key={range} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} pointerEvents="none">
                  <motion.g style={{ opacity: marksO }}>
                    {showLowest && (
                      <g>
                        <line x1={PAD.l} x2={width - PAD.r} y1={yAt(m.low.value)} y2={yAt(m.low.value)} stroke="currentColor" strokeOpacity={0.55} strokeDasharray="4 4" />
                        <text
                          x={lowestLeft ? PAD.l + 4 : width - PAD.r - 4}
                          y={yAt(m.low.value) - 6}
                          textAnchor={lowestLeft ? "start" : "end"}
                          className="fill-muted-foreground text-[11px] font-medium tabular-nums"
                          stroke="var(--background)"
                          strokeWidth={4}
                          style={{ paintOrder: "stroke" }}
                        >
                          Lowest {money(m.low.value, currency)}
                        </text>
                      </g>
                    )}
                    {m.changes.map(change => {
                      const x = xAt(change.index);
                      const y = yAt(change.to);
                      const midY = (yAt(change.from) + y) / 2;
                      const right = x + 64 < width - PAD.r;
                      return (
                        <g key={change.index}>
                          <circle cx={x} cy={y} r={4} stroke="currentColor" strokeWidth={2} className="fill-background" />
                          {m.labelled.has(change.index) && (
                            <text
                              x={right ? x + 8 : xAt(change.index - 1) - 8}
                              y={midY}
                              textAnchor={right ? "start" : "end"}
                              dominantBaseline="middle"
                              className="fill-foreground text-[12px] font-semibold tabular-nums"
                              stroke="var(--background)"
                              strokeWidth={4}
                              style={{ paintOrder: "stroke" }}
                            >
                              {change.to < change.from ? "↓" : "↑"} {money(Math.abs(change.to - change.from), currency)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {m.changes.length === 0 && (
                      <g>
                        <circle cx={xAt(0)} cy={yAt(m.pts[0].value)} r={4} stroke="currentColor" strokeWidth={2} className="fill-background" />
                        <text
                          x={xAt(0) + 8}
                          y={yAt(m.pts[0].value) - 10}
                          className="fill-muted-foreground text-[11px] font-medium"
                          stroke="var(--background)"
                          strokeWidth={4}
                          style={{ paintOrder: "stroke" }}
                        >
                          {m.pts.length >= m.rangeDays ? "Same price all period" : `Tracking since ${fmtDay.format(m.pts[0].date)}`}
                        </text>
                      </g>
                    )}
                  </motion.g>
                </motion.g>
              </AnimatePresence>

              <motion.g initial={false} animate={{ opacity: hover !== null ? 1 : 0 }} transition={{ duration: 0.15, ease: EASE_OUT }} pointerEvents="none">
                <motion.line x1={cxS} x2={cxS} y1={PAD.t - 6} y2={bottom} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 3" />
                <motion.circle cx={cxS} cy={dotY} r={4.5} stroke="currentColor" strokeWidth={2} className="fill-background" />
              </motion.g>

              <rect
                x={0}
                y={0}
                width={width}
                height={height}
                fill="transparent"
                style={{ touchAction: "pan-y", cursor: "crosshair" }}
                onPointerMove={onScrub}
                onPointerDown={onScrub}
                onPointerLeave={() => setHover(null)}
              />
            </svg>

            <motion.div
              className="pointer-events-none absolute top-0 left-0 rounded-lg border bg-background px-2.5 py-1.5 shadow-sm"
              style={{ x: tipX, width: TIP_W }}
              initial={false}
              animate={{ opacity: hover !== null ? 1 : 0 }}
              transition={{ duration: 0.15, ease: EASE_OUT }}
            >
              <p className="text-[11px] leading-tight text-muted-foreground">{fmtTip.format(tipPt.date)}</p>
              <p className="text-sm font-medium tabular-nums">{money(tipPt.value, currency)}</p>
              {tipChange && (
                <p className="text-[11px] leading-tight font-medium">
                  {tipChange.to < tipChange.from ? "↓" : "↑"} {money(Math.abs(tipChange.to - tipChange.from), currency)} that day
                </p>
              )}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
