// Aceternity UI Text Hover Effect (https://ui.aceternity.com/components/text-hover-effect).
// Changes: monochrome outline, unique SVG ids, a wider viewBox for a long word, Geist,
// the draw-in plays once on scroll into view, and the SVG is decorative (aria-hidden).
import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";

export const TextHoverEffect = ({ text, duration = 0 }: { text: string; duration?: number }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [maskPosition, setMaskPosition] = useState({ cx: "50%", cy: "50%" });

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    setMaskPosition({
      cx: `${((e.clientX - box.left) / box.width) * 100}%`,
      cy: `${((e.clientY - box.top) / box.height) * 100}%`,
    });
  };

  const textProps = {
    x: "50%",
    y: "50%",
    textAnchor: "middle",
    dominantBaseline: "middle",
    strokeWidth: 0.6,
    style: { fontFamily: "var(--l-sans)", fontSize: 92, fontWeight: 700, letterSpacing: "-0.05em" },
  } as const;

  return (
    <svg
      ref={svgRef}
      aria-hidden
      width="100%"
      viewBox="0 0 640 120"
      xmlns="http://www.w3.org/2000/svg"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={onMove}
      className="block select-none"
    >
      <defs>
        <motion.radialGradient
          id={`${uid}-reveal`}
          gradientUnits="userSpaceOnUse"
          r="22%"
          initial={{ cx: "50%", cy: "50%" }}
          animate={maskPosition}
          transition={{ duration, ease: "easeOut" }}
        >
          <stop offset="0%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </motion.radialGradient>
        <mask id={`${uid}-mask`}>
          <rect x="0" y="0" width="100%" height="100%" fill={`url(#${uid}-reveal)`} />
        </mask>
      </defs>
      {/* Resting fill: the pale wordmark. */}
      <text {...textProps} fill="#ededed" stroke="none">
        {text}
      </text>
      {/* Faint outline, shown while hovered. */}
      <text {...textProps} fill="transparent" stroke="#d4d4d4" style={{ ...textProps.style, opacity: hovered ? 0.8 : 0, transition: "opacity 300ms" }}>
        {text}
      </text>
      {/* Draw-in outline. */}
      <motion.text
        {...textProps}
        fill="transparent"
        stroke="#d4d4d4"
        initial={reduced ? false : { strokeDashoffset: 1000, strokeDasharray: 1000 }}
        whileInView={{ strokeDashoffset: 0, strokeDasharray: 1000 }}
        viewport={{ once: true }}
        transition={{ duration: 4, ease: "easeInOut" }}
      >
        {text}
      </motion.text>
      {/* Ink outline under the cursor. */}
      <text {...textProps} fill="transparent" stroke="#0a0a0a" mask={`url(#${uid}-mask)`} style={{ ...textProps.style, opacity: hovered ? 1 : 0 }}>
        {text}
      </text>
    </svg>
  );
};
