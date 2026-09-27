import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
export function Reveal({ children, className, delay = 0, y = 18, as = 'div' }: RevealProps) {
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
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Component>
  );
}
