import { useEffect, useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

/**
 * A trailing dot that follows the pointer.
 *
 * The native cursor is deliberately left alone. Hiding it makes text selection,
 * resize handles, form fields and every OS affordance harder to use for anyone
 * who lands on the site with a trackpad, and the dot alone already reads as
 * deliberate. The native cursor also keeps working if this component never mounts
 * at all, which is the case on touch devices and under reduced motion.
 *
 * Pointer devices only: on a touchscreen there is no pointer to trail, and a dot
 * frozen at the origin is worse than no dot.
 */
const DOT_SIZE = 10;

const INTERACTIVE =
  'a, button, input, select, textarea, summary, [role="button"], [role="tab"], [data-cursor="hover"]';

export function CustomCursor() {
  const reduceMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  const x = useMotionValue(-DOT_SIZE);
  const y = useMotionValue(-DOT_SIZE);
  const scale = useMotionValue(1);
  const opacity = useMotionValue(0);

  // Under reduced motion the dot tracks the pointer exactly instead of trailing
  // behind it, so the thing that follows the mouse stops being animated motion.
  const springX = useSpring(x, { stiffness: 900, damping: 60, mass: 0.35 });
  const springY = useSpring(y, { stiffness: 900, damping: 60, mass: 0.35 });
  const springScale = useSpring(scale, { stiffness: 500, damping: 32, mass: 0.4 });
  const springOpacity = useSpring(opacity, { duration: 0.25 });

  const dotX = reduceMotion ? x : springX;
  const dotY = reduceMotion ? y : springY;
  const dotScale = reduceMotion ? scale : springScale;
  const dotOpacity = reduceMotion ? opacity : springOpacity;

  useEffect(() => {
    // `pointer: coarse` is the touchscreen signal; `hover: none` catches
    // devices that report a mouse but cannot hover. Either is enough to skip.
    const fine = window.matchMedia('(pointer: fine)');
    const canHover = window.matchMedia('(hover: hover)');
    if (!fine.matches || !canHover.matches) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      // Guard the first move so the dot does not flash in the corner on load.
      setEnabled(true);
      x.set(event.clientX);
      y.set(event.clientY);
      opacity.set(1);
      const target = event.target;
      scale.set(target instanceof Element && target.closest(INTERACTIVE) ? 2.1 : 1);
    };

    const onLeave = () => opacity.set(0);
    const onEnter = () => opacity.set(1);

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerenter', onEnter);

    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
    };
  }, [x, y, scale, opacity]);

  if (!enabled) return null;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[90] rounded-full border border-kv-silver/70 bg-kv-silver/10 mix-blend-screen"
      style={{
        x: dotX,
        y: dotY,
        scale: dotScale,
        opacity: dotOpacity,
        width: DOT_SIZE,
        height: DOT_SIZE,
        // Offsets the centre onto the pointer. A translate would collide with the
        // transforms framer writes for x/y/scale, so the offset is done in layout.
        marginLeft: -DOT_SIZE / 2,
        marginTop: -DOT_SIZE / 2,
      }}
    />
  );
}
