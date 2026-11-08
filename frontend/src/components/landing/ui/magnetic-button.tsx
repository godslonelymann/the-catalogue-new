// Aceternity UI Magnetic Button (https://ui.aceternity.com/components/magnetic-button).
// Changes: no dashed debug outline, inline layout, motion values instead of state
// (no re-render per mouse move), and no pull with reduced motion or touch input.
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import React, { useRef } from "react";

export const MagneticButton = ({
  children,
  strength = 0.3,
  maxDistance = 24,
}: {
  children: React.ReactNode;
  strength?: number;
  maxDistance?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const spring = { stiffness: 150, damping: 25, mass: 0.1 };
  const x = useSpring(useMotionValue(0), spring);
  const y = useSpring(useMotionValue(0), spring);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    const { width, height, left, top } = ref.current.getBoundingClientRect();
    let dx = (e.clientX - (left + width / 2)) * strength;
    let dy = (e.clientY - (top + height / 2)) * strength;
    const distance = Math.hypot(dx, dy);
    if (distance > maxDistance) {
      dx *= maxDistance / distance;
      dy *= maxDistance / distance;
    }
    x.set(dx);
    y.set(dy);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <div onPointerMove={handlePointerMove} onPointerLeave={reset} className="-m-3 inline-block p-3">
      <motion.div ref={ref} style={{ x, y }} className="inline-block">
        {children}
      </motion.div>
    </div>
  );
};
