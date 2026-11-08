// The daily-check grid from the landing page's Features section (CheckGrid in src/components/landing/Features.tsx),
// with real data: one square per day for the last twelve weeks, newest at the bottom right.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { StoreChecks } from "@/api/types";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkCells, checkLevel, type CheckCell, type CheckLevel } from "./series";

const CELL = 14;
const GAP = 3;

const levelClass: Record<Exclude<CheckLevel, "failed">, string> = {
  0: "border border-dashed border-input bg-transparent",
  1: "bg-foreground/15",
  2: "bg-foreground/40",
  3: "bg-foreground/65",
  4: "bg-foreground/90",
};

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function describe(cell: CheckCell): string {
  const day = dayFormat.format(new Date(cell.day + "T00:00:00Z"));
  if (!cell.check) return `${day}: no check`;
  if (!cell.check.ok) return `${day}: check failed`;
  return `${day}: checked, ${cell.check.changes ? plural(cell.check.changes, "change") : "no changes"}`;
}

function Square({ level, className }: { level: CheckLevel; className?: string }) {
  return (
    <span
      className={cn(
        "block size-[14px] rounded-[3px]",
        level === "failed" ? "relative border border-foreground bg-background after:absolute after:inset-0 after:m-auto after:h-px after:w-[9px] after:-rotate-45 after:bg-foreground" : levelClass[level],
        className,
      )}
    />
  );
}

/** Twelve weeks of daily checks for one store. Hover or tap a square to read that day. */
export function CheckGrid({ checks }: { checks: StoreChecks }) {
  const reduced = useReducedMotion() ?? false;
  const cells = checkCells(checks.from, checks.to, checks.days);
  const [active, setActive] = useState<CheckCell | null>(null);

  // Columns are weeks, so the first column starts on the weekday of `from`.
  const columns = Math.ceil(cells.length / 7);
  const checked = cells.filter(cell => cell.check?.ok).length;
  const failed = cells.filter(cell => cell.check && !cell.check.ok).length;
  const changes = cells.reduce((total, cell) => total + (cell.check?.changes ?? 0), 0);
  const summary = `Checked on ${checked} of the last ${cells.length} days. ${failed ? `${plural(failed, "check")} failed. ` : ""}${plural(changes, "change")} found.`;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={summary}
          className="grid grid-flow-col grid-rows-7"
          style={{ gap: GAP, gridTemplateColumns: `repeat(${columns}, ${CELL}px)` }}
          onPointerLeave={() => setActive(null)}
        >
          {cells.map((cell, i) => {
            const level = checkLevel(cell.check);
            const week = Math.floor(i / 7);
            return (
              <motion.span
                key={cell.day}
                title={describe(cell)}
                onPointerEnter={() => setActive(cell)}
                onPointerDown={() => setActive(cell)}
                initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: reduced ? 0 : 0.3, ease: [0.2, 0.8, 0.2, 1], delay: reduced ? 0 : week * 0.03 }}
              >
                <Square level={level} className={cn(active?.day === cell.day && "ring-2 ring-ring ring-offset-1 ring-offset-background")} />
              </motion.span>
            );
          })}
        </div>
      </div>

      <p className="dash-meta min-h-[18px] tabular-nums" aria-live="polite">
        {active ? describe(active) : summary}
      </p>

      <div className="dash-meta flex flex-wrap items-center gap-x-4 gap-y-2" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          No changes
          {([1, 2, 3, 4] as const).map(level => (
            <Square key={level} level={level} />
          ))}
          Many changes
        </span>
        <span className="flex items-center gap-1.5">
          <Square level="failed" /> Failed
        </span>
        <span className="flex items-center gap-1.5">
          <Square level={0} /> No check
        </span>
      </div>
    </div>
  );
}
