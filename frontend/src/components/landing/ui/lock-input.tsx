// EasyUI LockInput (https://easyui.site/components/lock-input).
// Changes: a display-only version for the landing illustration. A `locked` prop drives the
// ring in place of focus, it uses `motion/react` and the landing tokens, and it is read-only.
import { cn } from "@/lib/utils";
import { motion, useReducedMotion, type Transition } from "motion/react";
import React from "react";

// EasyUI motion token springSnappy.
const SPRING_SNAPPY: Transition = { type: "spring", stiffness: 380, damping: 30, mass: 0.5 };

export function LockInput({
  label,
  value,
  locked,
  leftIcon,
  rightIcon,
  className,
}: {
  label: string;
  value: string;
  locked: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: 0 } : SPRING_SNAPPY;

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      <span className="block text-sm font-medium tracking-tight text-(--l-ink) select-none">{label}</span>
      <div className="relative flex h-11 w-full items-center rounded-lg border border-(--l-line) bg-(--l-surface) px-3.5 text-[15px] text-(--l-ink)">
        {leftIcon && <span className={cn("mr-2 flex transition-colors duration-200", locked ? "text-(--l-ink)" : "text-(--l-faint)")}>{leftIcon}</span>}
        <span className="l-mono min-w-0 flex-1 truncate">{value}</span>
        {rightIcon && <span className="ml-2 flex">{rightIcon}</span>}

        {/* Focus ring: scales in from 0.94 to 1 so the field "locks" into place. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg"
          initial={false}
          animate={{ opacity: locked ? 1 : 0, scale: locked ? 1 : 0.94 }}
          transition={transition}
          style={{ boxShadow: "0 0 0 2px rgba(10, 10, 10, 0.16)" }}
        />
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg"
          initial={false}
          animate={{ opacity: locked ? 1 : 0 }}
          transition={transition}
          style={{ boxShadow: "inset 0 0 0 1px #0a0a0a" }}
        />
      </div>
    </div>
  );
}
