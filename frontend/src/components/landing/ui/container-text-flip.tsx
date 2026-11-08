// Aceternity UI Container Text Flip (https://ui.aceternity.com/components/container-text-flip).
// Changes: renders inline (a <span>, so it can sit inside the <h1>), no gradient box,
// measures the next word before it shows, stops with reduced motion, and a polite live region.
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE } from "../motion";

export interface ContainerTextFlipProps {
  /** Words to cycle through. */
  words: string[];
  /** Time in milliseconds between words. */
  interval?: number;
  className?: string;
  /** Duration of the width and letter animation in milliseconds. */
  animationDuration?: number;
}

export function ContainerTextFlip({ words, interval = 3000, className, animationDuration = 700 }: ContainerTextFlipProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number | "auto">("auto");
  const measureRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (measureRef.current) setWidth(measureRef.current.scrollWidth);
  }, [index]);

  useEffect(() => {
    if (reduced || words.length < 2) return;
    const id = setInterval(() => setIndex(i => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words, interval, reduced]);

  const word = words[index];

  return (
    <motion.span
      animate={{ width }}
      transition={{ duration: animationDuration / 2000, ease: EASE }}
      className={cn("relative inline-flex justify-start whitespace-nowrap align-bottom", className)}
    >
      {/* Invisible copy for measuring the next width. */}
      <span ref={measureRef} aria-hidden className="invisible absolute left-0 top-0 whitespace-nowrap">
        {word}
      </span>
      <span className="sr-only" aria-live="polite">
        {word}
      </span>
      <span key={word} aria-hidden className="inline-block">
        {word.split("").map((letter, i) => (
          <motion.span
            key={i}
            className="inline-block whitespace-pre"
            initial={reduced ? false : { opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ delay: i * 0.02, duration: animationDuration / 1000, ease: EASE }}
          >
            {letter}
          </motion.span>
        ))}
      </span>
    </motion.span>
  );
}
