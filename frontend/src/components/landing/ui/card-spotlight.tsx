// Aceternity UI Card Spotlight (https://ui.aceternity.com/components/card-spotlight).
// Changes: a plain white glow (no CanvasRevealEffect, so no WebGL), landing card styles,
// and no glow with reduced motion.
import { cn } from "@/lib/utils";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "motion/react";
import React from "react";

export const CardSpotlight = ({
  children,
  radius = 280,
  color = "rgba(0, 0, 0, 0.035)",
  className,
  ...props
}: {
  radius?: number;
  color?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const reduced = useReducedMotion();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const mask = useMotionTemplate`radial-gradient(${radius}px circle at ${mouseX}px ${mouseY}px, white, transparent 80%)`;

  function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn("group/spotlight l-card l-card-hover relative overflow-hidden", className)}
      onMouseMove={handleMouseMove}
      {...props}
    >
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-px z-0 opacity-0 transition duration-300 group-hover/spotlight:opacity-100"
          style={{ backgroundColor: color, maskImage: mask, WebkitMaskImage: mask }}
        />
      )}
      {children}
    </div>
  );
};
