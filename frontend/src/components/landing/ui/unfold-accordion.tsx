// EasyUI UnfoldAccordion (https://easyui.site/components/unfold-accordion).
// Changes: `motion/react` in place of `framer-motion`, landing tokens, 64 px rows,
// aria-controls / region wiring, and instant changes with reduced motion.
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import React, { useId, useState } from "react";

// EasyUI motion tokens (lib/motion-tokens.ts): springGentle and springSnappy.
const SPRING_GENTLE: Transition = { type: "spring", stiffness: 170, damping: 26, mass: 0.9 };
const SPRING_SNAPPY: Transition = { type: "spring", stiffness: 380, damping: 30, mass: 0.5 };
const INSTANT: Transition = { duration: 0 };

export interface UnfoldAccordionItem {
  id: string;
  title: string;
  content: React.ReactNode;
}

export function UnfoldAccordion({
  items,
  allowMultiple = false,
  defaultOpen = [],
  className,
}: {
  items: UnfoldAccordionItem[];
  allowMultiple?: boolean;
  defaultOpen?: string[];
  className?: string;
}) {
  const uid = useId();
  const reduced = useReducedMotion();
  const [openIds, setOpenIds] = useState<string[]>(defaultOpen);

  const toggle = (id: string) => {
    if (allowMultiple) setOpenIds(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
    else setOpenIds(prev => (prev.includes(id) ? [] : [id]));
  };

  return (
    <div className={cn("l-card flex flex-col divide-y divide-(--l-line) overflow-hidden", className)}>
      {items.map(item => {
        const isOpen = openIds.includes(item.id);
        const buttonId = `${uid}-${item.id}-button`;
        const panelId = `${uid}-${item.id}-panel`;
        return (
          <div key={item.id}>
            <h3>
              <button
                id={buttonId}
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 px-5 text-left text-[15px] font-medium text-(--l-ink) transition-colors duration-150 hover:bg-black/[0.02] md:px-6"
              >
                {item.title}
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={reduced ? INSTANT : SPRING_SNAPPY}
                  className="shrink-0 text-(--l-muted)"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </motion.span>
              </button>
            </h3>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reduced ? INSTANT : SPRING_GENTLE}
                  className="overflow-hidden"
                >
                  <motion.div
                    initial={reduced ? false : { y: -4, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -4, opacity: 0 }}
                    transition={reduced ? INSTANT : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                    className="px-5 pb-5 text-[15px] leading-6 text-(--l-muted) md:px-6"
                  >
                    {item.content}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
