import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router";
import { Icon } from "../Icon";
import { STAGGER, VIEWPORT, reveal, stagger } from "./motion";
import { BackgroundLines } from "./ui/background-lines";
import { MagneticButton } from "./ui/magnetic-button";

export function FinalCta() {
  const reduced = useReducedMotion() ?? false;
  const item = reveal(reduced);
  return (
    <section aria-labelledby="cta-heading" className="l-inverse overflow-hidden bg-(--l-inverse) text-(--l-on-inverse)">
      <BackgroundLines svgOptions={{ duration: 12 }}>
        <motion.div
          variants={stagger(STAGGER.hero)}
          initial="hidden"
          whileInView="shown"
          viewport={VIEWPORT}
          className="l-wrap flex flex-col items-center py-24 text-center md:py-40"
        >
          <motion.h2
            variants={item}
            id="cta-heading"
            className="text-[36px] leading-10 font-semibold tracking-[-0.03em] md:text-[56px] md:leading-[60px]"
          >
            Stop checking. Start knowing.
          </motion.h2>
          <motion.p variants={item} className="mt-5 max-w-[440px] text-[16px] leading-[26px] text-white/60 md:text-[18px] md:leading-7">
            Add a store, pick your size, and let the daily check do the rest.
          </motion.p>
          <motion.div variants={item} className="mt-8">
            <MagneticButton strength={0.3}>
              <Link to="/signup" className="l-btn l-btn-inverse">
                Get started <Icon name="arrow" className="size-4" />
              </Link>
            </MagneticButton>
          </motion.div>
        </motion.div>
      </BackgroundLines>
    </section>
  );
}
