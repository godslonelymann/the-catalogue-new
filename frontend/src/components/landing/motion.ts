import type { Transition, Variants } from "motion/react";

/**
 * Landing page motion system. Every section uses these values, so the page moves as one.
 * Animate only transform, opacity and filter.
 */

/** ease-out-quint, for every tween. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  /** Hover and press. */
  feedback: 0.15,
  /** UI state changes (toggles, crossfades). */
  state: 0.3,
  /** Section reveals. */
  reveal: 0.6,
  /** Hero entrance. */
  hero: 0.9,
} as const;

/** Drag, magnetic pull and layout. */
export const SPRING: Transition = { type: "spring", stiffness: 300, damping: 30, mass: 0.8 };

export const STAGGER = {
  /** Between list children. */
  list: 0.06,
  /** Between hero lines. */
  hero: 0.08,
} as const;

/** whileInView settings for section reveals: play once, when 30% is visible. */
export const VIEWPORT = { once: true, amount: 0.3 } as const;

/**
 * The reveal pattern: opacity 0→1, y 16→0, blur 6→0, 600 ms.
 * With reduced motion it is a 150 ms opacity fade only.
 */
export function reveal(reduced: boolean, delay = 0): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      shown: { opacity: 1, transition: { duration: DURATION.feedback, delay } },
    };
  }
  return {
    hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
    shown: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: DURATION.reveal, ease: EASE, delay },
    },
  };
}

/** A parent that staggers its `reveal` children. */
export function stagger(gap: number = STAGGER.list, delayChildren = 0): Variants {
  return {
    hidden: {},
    shown: { transition: { staggerChildren: gap, delayChildren } },
  };
}
