import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { STORE, catalogue, rupees, shopifyImage, soldOut } from "./fugazee";
import { DURATION, EASE, SPRING, STAGGER, VIEWPORT, reveal, stagger } from "./motion";
import { SectionHeading } from "./SectionHeading";
import { LockInput } from "./ui/lock-input";
import { StepPlayer } from "./ui/step-player";

const STEP_MS = 4000;

const steps = [
  { title: "Add a store", body: "Paste a Shopify store’s address. We check it before we add it." },
  { title: "Browse the catalogue", body: "See prices, stock, and price history from the daily check." },
  { title: "Pick your size", body: "Choose the exact size and colour. We email you once when it returns." },
];

export function HowItWorks() {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [step, setStep] = useState(0);
  // Auto-play only while the section is on screen, and never with reduced motion.
  const [paused, setPaused] = useState(reduced);
  const playing = inView && !paused;

  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="l-section">
      <div className="l-wrap">
        <SectionHeading id="how-heading" eyebrow="How it works" title="Three steps. No spreadsheets." />

        <div ref={ref} className="grid gap-10 md:grid-cols-12 md:gap-6">
          <div className="flex flex-col gap-6 md:col-span-5">
            <motion.ol
              variants={stagger(STAGGER.list)}
              initial="hidden"
              whileInView="shown"
              viewport={VIEWPORT}
              className="flex flex-col gap-2"
            >
              {steps.map((item, i) => (
                <motion.li key={item.title} variants={reveal(reduced)}>
                  <button
                    type="button"
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => setStep(i)}
                    className={cn(
                      "w-full rounded-2xl border p-5 text-left transition-colors duration-300",
                      i === step ? "border-(--l-line) bg-(--l-surface)" : "border-transparent hover:bg-black/[0.02]",
                    )}
                  >
                    <span className="l-mono text-[13px] text-(--l-muted)">0{i + 1}</span>
                    <span className={cn("l-h3 mt-2 block transition-colors duration-300", i === step ? "text-(--l-ink)" : "text-(--l-muted)")}>
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[15px] leading-6 text-(--l-muted)">{item.body}</span>
                  </button>
                </motion.li>
              ))}
            </motion.ol>

            <StepPlayer
              steps={steps.map(s => ({ label: s.title, duration: STEP_MS }))}
              value={step}
              onValueChange={setStep}
              playing={playing}
              onPlayingChange={next => setPaused(!next)}
              loop
              seekable
              size={36}
              controlPosition="left"
              className="self-start"
            />
          </div>

          <div className="md:col-span-7">
            <div className="l-card relative h-[380px] overflow-hidden md:sticky md:top-[120px] md:h-[440px]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.06)_1px,transparent_0)] [background-size:16px_16px]" aria-hidden />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={step}
                  className="absolute inset-0 flex items-center justify-center p-6 md:p-10"
                  initial={{ opacity: 0, filter: reduced ? "none" : "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: reduced ? "none" : "blur(4px)" }}
                  transition={{ duration: DURATION.state, ease: EASE }}
                >
                  {step === 0 && <AddStoreVisual reduced={reduced} />}
                  {step === 1 && <CatalogueVisual reduced={reduced} />}
                  {step === 2 && <SizeVisual reduced={reduced} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


function AddStoreVisual({ reduced }: { reduced: boolean }) {
  const [typed, setTyped] = useState(reduced ? STORE.domain.length : 0);
  const done = typed >= STORE.domain.length;

  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setTyped(n => n + 1), 70);
    return () => clearTimeout(id);
  }, [typed, done]);

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-(--l-line) bg-(--l-surface) p-5" aria-hidden>
      <LockInput
        label="Store address"
        value={STORE.domain.slice(0, typed) || " "}
        locked={done}
        leftIcon={<Icon name="store" className="size-4" />}
        rightIcon={
          <motion.span initial={false} animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.6 }} transition={SPRING}>
            <Icon name="check" className="size-4" />
          </motion.span>
        }
      />
      <motion.div
        className="mt-4 flex flex-wrap items-center gap-2"
        initial={false}
        animate={{ opacity: done ? 1 : 0, y: done ? 0 : 6 }}
        transition={{ duration: DURATION.state, ease: EASE, delay: done ? 0.15 : 0 }}
      >
        <span className="l-badge">
          <Icon name="shield" className="size-3.5" /> Shopify store found
        </span>
        <span className="l-mono text-[12px] text-(--l-muted)">
          {STORE.productCount} products · {STORE.currency}
        </span>
      </motion.div>
    </div>
  );
}

function CatalogueVisual({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="grid w-full max-w-[460px] grid-cols-3 gap-3"
      variants={stagger(STAGGER.list)}
      initial="hidden"
      animate="shown"
    >
      {catalogue.map(p => (
        <motion.div key={p.title} variants={reveal(reduced)} className="overflow-hidden rounded-xl border border-(--l-line) bg-(--l-surface)">
          <img
            src={shopifyImage(p.image, 240)}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-[4/3] w-full bg-(--l-chip) object-cover object-[center_20%]"
          />
          <div className="px-2.5 py-2">
            <p className="truncate text-[12px] font-medium">{p.title}</p>
            <p className="text-[11px] text-(--l-muted) tabular-nums">
              {rupees(p.price)} <s className="text-(--l-faint)">{rupees(p.compareAt)}</s>
            </p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function SizeVisual({ reduced }: { reduced: boolean }) {
  const [picked, setPicked] = useState(reduced);

  useEffect(() => {
    if (picked) return;
    const id = setTimeout(() => setPicked(true), 700);
    return () => clearTimeout(id);
  }, [picked]);

  return (
    <div aria-hidden className="w-full max-w-[400px] rounded-2xl border border-(--l-line) bg-(--l-surface) p-5">
      <div className="flex items-center gap-3">
        <img
          src={shopifyImage(soldOut.image, 120)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-12 shrink-0 rounded-lg bg-(--l-chip) object-cover object-top"
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium">{soldOut.title}</p>
          <p className="mt-0.5 text-[13px] text-(--l-muted)">Sold out in {soldOut.pick}</p>
        </div>
      </div>
      <p className="l-eyebrow mt-5 text-(--l-muted)">Size</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {soldOut.sizes.map(({ size, available }) => {
          const active = picked && size === soldOut.pick;
          return (
            <span
              key={size}
              className={cn(
                "relative grid h-10 min-w-14 place-items-center rounded-lg border px-2 text-[13px] font-medium transition-colors duration-300",
                active ? "border-(--l-ink) text-(--l-on-inverse)" : available ? "border-(--l-line) text-(--l-ink)" : "border-dashed border-(--l-line-hover) text-(--l-muted)",
              )}
            >
              {active && <motion.span layoutId="size-pick" transition={SPRING} className="absolute inset-0 rounded-[7px] bg-(--l-ink)" />}
              <span className="relative">{size}</span>
            </span>
          );
        })}
      </div>
      <motion.div
        className="mt-5 flex items-center gap-3"
        initial={false}
        animate={{ opacity: picked ? 1 : 0.4 }}
        transition={{ duration: DURATION.state, ease: EASE }}
      >
        <span className="l-btn l-btn-primary l-btn-sm">
          <Icon name="bell" className="size-4" /> Notify me
        </span>
        <motion.span
          className="text-[13px] text-(--l-muted)"
          initial={false}
          animate={{ opacity: picked ? 1 : 0, x: picked ? 0 : -6 }}
          transition={{ duration: DURATION.state, ease: EASE, delay: picked ? 0.5 : 0 }}
        >
          We’ll email you once.
        </motion.span>
      </motion.div>
    </div>
  );
}
