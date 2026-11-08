import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router";
import { Icon } from "../Icon";
import { STAGGER, reveal, stagger } from "./motion";
import { ContainerTextFlip } from "./ui/container-text-flip";
import { DottedGlowBackground } from "./ui/dotted-glow-background";
import { MagneticButton } from "./ui/magnetic-button";

const FLIP_WORDS = ["back in stock.", "on sale.", "back in your size."];

export function Hero() {
  const reduced = useReducedMotion() ?? false;
  const item = reveal(reduced);

  return (
    <section aria-labelledby="hero-heading" className="relative isolate overflow-hidden pt-[112px] pb-[72px] md:pt-[160px] md:pb-[96px]">
      {/* The only moving background on the page, faded out before the edges. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        style={{
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent)",
        }}
      >
        <DottedGlowBackground gap={14} radius={1.4} color="rgba(10,10,10,0.55)" glowColor="rgba(10,10,10,0.6)" opacity={0.7} speedMin={0.2} speedMax={0.8} />
      </div>

      <div className="l-wrap flex flex-col items-center text-center">
        <motion.div variants={stagger(STAGGER.hero)} initial="hidden" animate="shown" className="flex flex-col items-center">
          <motion.p variants={item} className="l-chip l-eyebrow text-(--l-muted)">
            <span aria-hidden className="size-1.5 rounded-full bg-(--l-ink)" />
            Shopify price and restock tracker
          </motion.p>

          <h1 id="hero-heading" className="l-display mt-6 max-w-[16ch] md:max-w-none">
            <motion.span variants={item} className="block">
              Know the moment your size
            </motion.span>
            <motion.span variants={item} className="block">
              is <ContainerTextFlip words={FLIP_WORDS} interval={3000} />
            </motion.span>
          </h1>

          <motion.p variants={item} className="l-sub mt-6 max-w-[520px]">
            Monitor up to 10 Shopify brands. See every price drop, and get one email when your exact size and colour return.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <MagneticButton strength={0.3}>
              <Link to="/signup" className="l-btn l-btn-primary">
                Get started <Icon name="arrow" className="size-4" />
              </Link>
            </MagneticButton>
            <a href="#how-it-works" className="l-btn l-btn-ghost">
              See how it works
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
