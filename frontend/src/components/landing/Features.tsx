import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../Icon";
import { DURATION, EASE, SPRING, STAGGER, VIEWPORT, reveal, stagger } from "./motion";
import { SectionHeading } from "./SectionHeading";
import { CardSpotlight } from "./ui/card-spotlight";
import { InteractiveAreaChart, type AreaChartData, type ChartPoint } from "./ui/interactive-area-chart";

export function Features() {
  const reduced = useReducedMotion() ?? false;
  return (
    <section id="features" aria-labelledby="features-heading" className="l-section">
      <div className="l-wrap">
        <SectionHeading
          id="features-heading"
          eyebrow="Features"
          title="Everything you need to stop refreshing."
          sub="One place for the stores you follow: their prices, their stock, and the one size you are waiting for."
        />

        {/* Bento: price history (2 × 1), size alerts (1 × 2), daily check and store gatekeeper (1 × 1). */}
        <motion.div
          variants={stagger(STAGGER.list)}
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, amount: 0.15 }}
          className="grid grid-cols-1 gap-4 md:auto-rows-[minmax(320px,auto)] md:grid-cols-3"
        >
          <BentoCell
            className="md:col-span-2"
            title="Price history"
            description="Every price from the daily check, so you know a real drop from a fake sale."
            reduced={reduced}
          >
            <PriceHistory />
          </BentoCell>

          <BentoCell
            className="md:row-span-2"
            title="Exact-size alerts"
            description="Save a size and colour. We email you once, when that exact variant returns."
            reduced={reduced}
            fill
          >
            <SizeAlerts reduced={reduced} />
          </BentoCell>

          <BentoCell title="Daily check" description="Every store you follow is read again each day." reduced={reduced}>
            <CheckGrid reduced={reduced} />
          </BentoCell>

          <BentoCell title="Only real Shopify stores" description="We check each address before we add it." reduced={reduced}>
            <Gatekeeper reduced={reduced} />
          </BentoCell>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * Aceternity Bento Grid item, inside a Card Spotlight. Title and description sit at the bottom.
 * The visual is centred. With `fill`, it starts at the top and fills the space down to the title,
 * for a tall cell whose visual is a list.
 */
function BentoCell({
  title,
  description,
  className,
  children,
  reduced,
  fill = false,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
  reduced: boolean;
  fill?: boolean;
}) {
  return (
    <motion.div variants={reveal(reduced)} className={cn("flex", className)}>
      <CardSpotlight className="flex w-full flex-col justify-between gap-6 p-6 md:p-7">
        <div className={cn("relative z-10 flex flex-1 flex-col", fill ? "justify-start" : "justify-center")}>{children}</div>
        <div className="relative z-10">
          <h3 className="l-h3">{title}</h3>
          <p className="mt-1 text-[15px] leading-6 text-(--l-muted)">{description}</p>
        </div>
      </CardSpotlight>
    </motion.div>
  );
}

const DAY = 86_400_000;
const TODAY = Date.UTC(2026, 10, 9);

/** A 90-day price line: full price, one sale, back up, then a real drop. Illustration only. */
function priceSeries(days: number): ChartPoint[] {
  const all = Array.from({ length: 90 }, (_, i) => {
    const value = i < 28 ? 1699 : i < 36 ? 1499 : i < 70 ? 1699 : i < 78 ? 1599 : 1299;
    return { date: TODAY - (89 - i) * DAY, value };
  });
  return all.slice(90 - days);
}

function PriceHistory() {
  const data = useMemo<AreaChartData>(() => ({ "30D": priceSeries(30), "90D": priceSeries(90) }), []);
  return <InteractiveAreaChart data={data} defaultRange="90D" title="Racer Club Oversized Tee" height={170} />;
}

const alerts = [
  { name: "Utility Cargo Trousers", variant: "Olive · 32", flips: true },
  { name: "Racer Club Oversized Tee", variant: "Black · L", flips: false },
  { name: "Fleece Hoodie", variant: "Grey · M", flips: false },
  { name: "Oxford Shirt", variant: "White · 40", flips: false },
  { name: "Weekend Cap", variant: "Navy · One size", flips: false },
  { name: "Linen Overshirt", variant: "Ecru · L", flips: false },
];

function SizeAlerts({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLUListElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [restocked, setRestocked] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const id = setTimeout(() => setRestocked(true), reduced ? 0 : 1500);
    return () => clearTimeout(id);
  }, [inView, reduced]);

  return (
    <motion.ul
      ref={ref}
      aria-hidden
      variants={stagger(STAGGER.list, 0.2)}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      // Fills the tall cell: the rows spread out evenly, with at least 8 px between them.
      className="flex flex-1 flex-col justify-between gap-2"
    >
      {alerts.map(alert => {
        const back = alert.flips && restocked;
        return (
          <motion.li
            key={alert.name}
            variants={reveal(reduced)}
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-300",
              back ? "border-(--l-ink) bg-(--l-surface)" : "border-(--l-line) bg-(--l-bg)",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium">{alert.name}</p>
              <p className="l-mono text-[12px] text-(--l-muted)">{alert.variant}</p>
            </div>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={back ? "back" : "watching"}
                className={cn("l-badge shrink-0", back ? "bg-(--l-ink) text-(--l-on-inverse)" : "bg-transparent text-(--l-muted)")}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }}
                transition={{ duration: DURATION.state, ease: EASE }}
              >
                {back ? (
                  <>
                    <Icon name="mail" className="size-3.5" /> Back in stock
                  </>
                ) : (
                  "Watching"
                )}
              </motion.span>
            </AnimatePresence>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

const WEEKS = 12;
const DAYS = 7;

/**
 * A 7 × 12 grid of daily checks, built in the style of the RareUI GitHub Activity grid
 * (that component reads the GitHub API, so it is not copied). Columns fade in left to right.
 */
function CheckGrid({ reduced }: { reduced: boolean }) {
  // Deterministic levels: most days pass, a few show changes.
  const levels = useMemo(
    () =>
      Array.from({ length: WEEKS * DAYS }, (_, i) => {
        const n = (i * 37 + 11) % 23;
        return n < 2 ? 0.25 : n < 8 ? 0.5 : n < 15 ? 0.75 : 1;
      }),
    [],
  );
  return (
    <div aria-hidden className="grid grid-flow-col grid-rows-7 gap-[3px] self-start" style={{ gridTemplateColumns: `repeat(${WEEKS}, 14px)` }}>
      {levels.map((level, i) => {
        const week = Math.floor(i / DAYS);
        return (
          <motion.span
            key={i}
            className="size-[14px] rounded-[3px] bg-(--l-ink)"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
            whileInView={{ opacity: level * 0.85, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: reduced ? DURATION.feedback : 0.3, ease: EASE, delay: reduced ? 0 : week * 0.04 }}
          />
        );
      })}
    </div>
  );
}

const checks = [
  { url: "fugazee.com", ok: true },
  { url: "fugazee.com/products/tee", ok: false },
  { url: "www.fugazee.com", ok: true, same: true },
];

function Gatekeeper({ reduced }: { reduced: boolean }) {
  return (
    <motion.ul
      aria-hidden
      variants={stagger(0.25, 0.2)}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      className="flex flex-col gap-2"
    >
      {checks.map(check => (
        <motion.li
          key={check.url}
          variants={{
            hidden: { opacity: 0, x: reduced ? 0 : -8 },
            shown: { opacity: 1, x: 0, transition: reduced ? { duration: DURATION.feedback } : SPRING },
          }}
          className="flex items-center justify-between gap-3 rounded-xl border border-(--l-line) bg-(--l-bg) px-3.5 py-2.5"
        >
          <span className="l-mono truncate text-[12px]">{check.url}</span>
          <span className={cn("l-badge shrink-0", check.ok ? "" : "bg-transparent text-(--l-muted) line-through")}>
            {check.ok ? (check.same ? "Same store" : "Approved") : "Refused"}
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
