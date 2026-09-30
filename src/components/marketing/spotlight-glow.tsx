import { useEffect, type RefObject } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

const GLOW_SIZE_REM = 46;
const GLOW_HALF_REM = GLOW_SIZE_REM / 2;

/**
 * A soft radial glow that trails the pointer inside one section.
 *
 * Scoped to a container rather than the whole viewport on purpose: a glow over
 * the entire page reads as a haze and washes out the contrast of everything
 * underneath it. Inside the hero, where the background is already a dark image at
 * low opacity, it reads as light falling on it.
 *
 * The offset from the centre is baked into a motion template so the position
 * lands on `transform`. Moving a 46rem element via `left`/`top` would relayout
 * it on every pointer move; as a translate the browser can composite it.
 */
export function SpotlightGlow({ target }: { target: RefObject<HTMLElement | null> }) {
  const reduceMotion = useReducedMotion();

  const x = useMotionValue(50);
  const y = useMotionValue(50);
  const springX = useSpring(x, { stiffness: 220, damping: 26, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 220, damping: 26, mass: 0.5 });

  const glowX = reduceMotion ? x : springX;
  const glowY = reduceMotion ? y : springY;

  // `useMotionTemplate` keeps the output subscribed to the motion values.
  // Interpolating them into a plain template string would capture the value once
  // and the glow would sit still.
  const offsetX = useMotionTemplate`calc(${glowX}% - ${GLOW_HALF_REM}rem)`;
  const offsetY = useMotionTemplate`calc(${glowY}% - ${GLOW_HALF_REM}rem)`;

  useEffect(() => {
    const element = target.current;
    if (!element) return;

    // Reduced motion: park the glow in the middle and never listen. A light
    // source that keeps drifting is motion even though nothing is translating.
    if (reduceMotion) {
      x.set(50);
      y.set(50);
      return;
    }

    // Scoped to the section so the glow cannot be dragged around outside its
    // bounds or latch onto a coordinate from another part of the page.
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      x.set(((event.clientX - rect.left) / rect.width) * 100);
      y.set(((event.clientY - rect.top) / rect.height) * 100);
    };

    element.addEventListener('pointermove', onMove, { passive: true });
    return () => element.removeEventListener('pointermove', onMove);
  }, [target, reduceMotion, x, y]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute left-0 top-0 rounded-full"
        style={{
          x: offsetX,
          y: offsetY,
          width: `${GLOW_SIZE_REM}rem`,
          height: `${GLOW_SIZE_REM}rem`,
          background:
            'radial-gradient(circle, rgba(148,163,184,0.17) 0%, rgba(148,163,184,0.07) 40%, transparent 70%)',
        }}
      />
    </div>
  );
}
