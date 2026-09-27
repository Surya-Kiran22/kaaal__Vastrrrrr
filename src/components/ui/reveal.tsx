import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { DURATION, EASE_OUT_EXPO, RISE_DISTANCE, staggerContainer } from '@/lib/motion';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger in milliseconds. */
  delay?: number;
  y?: number;
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer';
}

/**
 * Small scroll reveal used sparingly across marketing sections.
 * Disabled entirely when the user prefers reduced motion.
 */
export function Reveal({ children, className, delay = 0, y = RISE_DISTANCE, as = 'div' }: RevealProps) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as];

  if (reduceMotion) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }

  return (
    <Component
      className={cn(className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      // `once` because a section that re-animates every time it scrolls back
      // into view is distracting on a page you scroll through repeatedly.
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: DURATION.slow, delay, ease: EASE_OUT_EXPO }}
    >
      {children}
    </Component>
  );
}

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  /** Seconds between each child starting. */
  stagger?: number;
  as?: 'div' | 'ul' | 'ol' | 'section';
}

/**
 * Cascades its `StaggerItem` children into view.
 *
 * For lists that resolve after a fetch. A grid of products or a list of orders
 * appearing all at once reads as a hard cut; a short cascade makes the same
 * arrival feel deliberate.
 *
 * The cascade only runs on the initial `animate`, not on every re-render, so
 * it does not replay when a filter changes or a row updates in place.
 */
export function StaggerList({
  children,
  className,
  stagger = 0.045,
  as = 'div',
}: StaggerListProps) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as];

  if (reduceMotion) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }

  return (
    <Component
      className={cn(className)}
      variants={staggerContainer(stagger)}
      initial="hidden"
      animate="visible"
    >
      {children}
    </Component>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  /**
   * Position in the list, used to cap the delay. Without a cap, row 20 of an
   * order history would still be waiting to appear a full second later, which
   * reads as a hang rather than a cascade.
   */
  index?: number;
  as?: 'div' | 'li' | 'article';
}

/** A child of `StaggerList`. Renders no motion wrapper at all under reduced motion. */
export function StaggerItem({ children, className, index = 0, as = 'div' }: StaggerItemProps) {
  const reduceMotion = useReducedMotion();
  const Component = motion[as];

  if (reduceMotion) {
    const Static = as;
    return <Static className={className}>{children}</Static>;
  }

  return (
    <Component
      className={cn(className)}
      variants={{
        hidden: { opacity: 0, y: RISE_DISTANCE },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: DURATION.base,
            ease: EASE_OUT_EXPO,
            // 8 frames ≈ 360ms; past that the tail is imperceptible anyway.
            delay: Math.min(index, 8) * 0.045,
          },
        },
      }}
    >
      {children}
    </Component>
  );
}
