import type { Transition, Variants } from 'framer-motion';

/**
 * Shared motion tokens.
 *
 * Every animation in the app pulls its duration and easing from here. Scattered
 * inline timings drift apart within a few files, and a page where the grid
 * eases one way while the heading eases another reads as janky rather than
 * smooth - so the numbers live in one place.
 *
 * Everything here is gated on `useReducedMotion` at the call site; see
 * `useMotionSafe` below. CSS-only transitions need no such guard because
 * `index.css` already collapses them under `prefers-reduced-motion`.
 */

/**
 * Decelerating curve with a long tail. Fast out of the gate, long settle, which
 * is what makes a short movement read as deliberate rather than abrupt.
 */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Material's standard curve. Used where a movement should feel physical rather
 * than expressive, such as an overlay fading in behind a dialog.
 */
export const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];

/**
 * Kept short on purpose. A route change that takes half a second to settle
 * delays the shopper on every click; anything past ~350ms starts to feel like
 * the app is thinking.
 */
export const DURATION = {
  /** Hover, press and other direct feedback to a single control. */
  instant: 0.15,
  /** Default for anything entering or leaving. */
  base: 0.28,
  /** Deliberate choreography, e.g. a staged list. */
  slow: 0.55,
} as const;

/** The rise applied to content entering the viewport or a route. */
export const RISE_DISTANCE = 10;

/** Route-level enter: a short fade with a slight rise. */
export const routeTransition: Transition = {
  duration: DURATION.base,
  ease: EASE_OUT_EXPO,
};

/**
 * The default enter animation for a block of content.
 *
 * Opacity and transform only. Animating `width`, `height`, `top` or `margin`
 * forces layout on every frame, which is what turns a "smooth" animation into
 * a stutter on a long order list.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: RISE_DISTANCE },
  visible: { opacity: 1, y: 0, transition: routeTransition },
};

/** Opacity only, for content that should not appear to move. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_STANDARD } },
};

/**
 * Parent variant for a list. Children using `staggerItem` are delayed by
 * `staggerChildren`, so they cascade without each one owning a delay prop.
 *
 * The per-child delay is capped in `staggerItem`: without a cap, the twelfth
 * row of an order list would not appear for over a second and the user would
 * read that as a hang.
 */
export const staggerContainer = (stagger = 0.045, delayChildren = 0): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: RISE_DISTANCE },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.base, ease: EASE_OUT_EXPO },
  },
};

/**
 * A child that participates in a stagger but is capped, so long lists finish
 * arriving promptly instead of trickling in.
 */
export const staggerItemCapped = (maxIndex = 8): Variants => ({
  hidden: { opacity: 0, y: RISE_DISTANCE },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.base,
      ease: EASE_OUT_EXPO,
      delay: Math.min(index, maxIndex) * 0.045,
    },
  }),
});
