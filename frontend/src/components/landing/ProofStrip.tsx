import { useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { TextFlippingBoard } from "./ui/text-flipping-board";

const stats = [
  { board: "10 STORES", caption: "Shopify brands per account" },
  { board: "DAILY CHECK", caption: "Prices and stock, every day" },
  { board: "ONE EMAIL", caption: "Per restock, for your size" },
];

const COLS = 11;

/** Three split-flap stats between the hero and the steps. The boards flip once, on scroll into view. */
export function ProofStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();

  return (
    <section aria-label="At a glance" className="border-y border-(--l-line) bg-(--l-surface)">
      <div ref={ref} className="l-wrap grid gap-6 py-8 sm:grid-cols-3 sm:gap-6">
        {stats.map(stat => {
          const padded = stat.board.padStart(Math.floor((COLS + stat.board.length) / 2)).padEnd(COLS);
          return (
            <div key={stat.board} className="flex flex-col items-center gap-3">
              {reduced ? (
                <p className="l-mono flex h-[52px] items-center text-[22px] font-medium tracking-[0.08em]">{stat.board}</p>
              ) : (
                <TextFlippingBoard
                  rows={[inView ? padded : " ".repeat(COLS)]}
                  boardRows={1}
                  boardCols={COLS}
                  duration={1.4}
                  label={stat.board}
                  className="max-w-[300px] rounded-lg p-1.5 md:rounded-xl md:p-2"
                />
              )}
              <p className="text-[13px] text-(--l-muted)">{stat.caption}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
