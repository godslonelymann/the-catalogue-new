import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { STAGGER, VIEWPORT, reveal, stagger } from "./motion";

/** Eyebrow, H2 and subhead, revealed one after another. 56 px (40 px on phones) above the content. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  sub,
  align = "center",
  className,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  align?: "center" | "start";
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const item = reveal(reduced);
  return (
    <motion.div
      variants={stagger(STAGGER.hero)}
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      className={cn(
        "mb-10 flex flex-col gap-4 md:mb-14",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-left",
        className,
      )}
    >
      <motion.p variants={item} className="l-eyebrow text-(--l-muted)">
        {eyebrow}
      </motion.p>
      <motion.h2 variants={item} id={id} className="l-h2 max-w-[640px]">
        {title}
      </motion.h2>
      {sub && (
        <motion.p variants={item} className="l-sub max-w-[520px]">
          {sub}
        </motion.p>
      )}
    </motion.div>
  );
}
