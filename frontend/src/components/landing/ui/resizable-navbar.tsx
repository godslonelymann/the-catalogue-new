// Aceternity UI Resizable Navbar (https://ui.aceternity.com/components/resizable-navbar).
// Changes: fixed to the top, a 760 px pill after 80 px of scroll (was 40% after 100 px),
// landing tokens, the shared spring, a real toggle button, and Escape closes the mobile menu.
import { cn } from "@/lib/utils";
import { IconMenu2, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import React, { useEffect, useState } from "react";
import { DURATION, EASE, SPRING } from "../motion";

/** Scroll distance (px) after which the bar becomes a pill. */
const SHRINK_AT = 80;

const PILL_SHADOW =
  "0 0 24px rgba(34, 42, 53, 0.06), 0 1px 1px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.08), 0 16px 68px rgba(47, 48, 55, 0.05)";

export const Navbar = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const { scrollY } = useScroll();
  const [visible, setVisible] = useState(false);

  useMotionValueEvent(scrollY, "change", latest => setVisible(latest > SHRINK_AT));

  return (
    <div className={cn("fixed inset-x-0 top-0 z-40 w-full", className)}>
      {React.Children.map(children, child =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ visible?: boolean }>, { visible })
          : child,
      )}
    </div>
  );
};

export const NavBody = ({
  children,
  className,
  visible,
}: {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={false}
      animate={{
        maxWidth: visible ? 760 : 1168,
        height: visible ? 52 : 64,
        y: visible ? 12 : 0,
        boxShadow: visible ? PILL_SHADOW : "0 0 0 0 rgba(0,0,0,0)",
        backgroundColor: visible ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0)",
      }}
      transition={reduced ? { duration: 0 } : SPRING}
      className={cn(
        "relative z-[60] mx-auto hidden w-full flex-row items-center justify-between rounded-full px-6 lg:flex",
        visible && "backdrop-blur-md",
        className,
      )}
    >
      {children}
    </motion.div>
  );
};

export const NavItems = ({
  items,
  className,
  onItemClick,
}: {
  items: { name: string; link: string }[];
  className?: string;
  onItemClick?: () => void;
}) => {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      onMouseLeave={() => setHovered(null)}
      className={cn(
        "pointer-events-none absolute inset-0 hidden flex-1 flex-row items-center justify-center gap-1 text-sm font-medium lg:flex",
        className,
      )}
    >
      {items.map((item, idx) => (
        <a
          onMouseEnter={() => setHovered(idx)}
          onFocus={() => setHovered(idx)}
          onBlur={() => setHovered(null)}
          onClick={onItemClick}
          className="pointer-events-auto relative rounded-full px-4 py-2 text-(--l-muted) transition-colors duration-150 hover:text-(--l-ink)"
          key={item.link}
          href={item.link}
        >
          {hovered === idx && (
            <motion.div
              layoutId="landing-nav-hover"
              transition={SPRING}
              className="absolute inset-0 h-full w-full rounded-full bg-black/[0.05]"
            />
          )}
          <span className="relative z-20">{item.name}</span>
        </a>
      ))}
    </div>
  );
};

export const MobileNav = ({
  children,
  className,
  visible,
}: {
  children: React.ReactNode;
  className?: string;
  visible?: boolean;
}) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={false}
      animate={{
        y: visible ? 8 : 0,
        boxShadow: visible ? PILL_SHADOW : "0 0 0 0 rgba(0,0,0,0)",
        backgroundColor: visible ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0)",
      }}
      transition={reduced ? { duration: 0 } : SPRING}
      className={cn(
        "relative z-50 mx-4 flex flex-col items-center justify-between rounded-[26px] px-4 py-2 lg:hidden",
        visible && "backdrop-blur-md",
        className,
      )}
    >
      {children}
    </motion.div>
  );
};

export const MobileNavHeader = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("flex h-9 w-full flex-row items-center justify-between", className)}>{children}</div>
);

export const MobileNavMenu = ({
  id,
  children,
  className,
  isOpen,
  onClose,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  isOpen: boolean;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id={id}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DURATION.state, ease: EASE }}
          className={cn(
            "absolute inset-x-0 top-14 z-50 flex w-full flex-col items-stretch gap-1 rounded-2xl border border-(--l-line) bg-(--l-surface) p-3",
            className,
          )}
          style={{ boxShadow: PILL_SHADOW }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const MobileNavToggle = ({
  isOpen,
  onClick,
  controls,
}: {
  isOpen: boolean;
  onClick: () => void;
  controls: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={isOpen}
    aria-controls={controls}
    aria-label={isOpen ? "Close menu" : "Open menu"}
    className="-mr-2 grid size-10 place-items-center rounded-full text-(--l-ink)"
  >
    {isOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
  </button>
);
