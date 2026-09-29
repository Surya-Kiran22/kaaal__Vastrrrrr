import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Inertial smooth scrolling, matched to the design reference.
 *
 * Lenis takes over the wheel and scrollbar gestures, so the native
 * `scroll-behavior: smooth` rule in index.css is intentionally not used
 * alongside it - running both makes anchor jumps fight the wheel animation.
 *
 * Mounted once at the root. Renders nothing.
 */
export function SmoothScroll() {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReducedMotion.matches) return;

    const lenis = new Lenis({ duration: 1.2, smoothWheel: true });

    let frame = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
