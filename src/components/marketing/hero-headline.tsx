import { motion, useReducedMotion } from 'framer-motion';
import { DURATION, EASE_OUT_EXPO } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface HeroLine {
  text: string;
  /** Renders in the outlined treatment used for the closing phrase. */
  outline?: boolean;
}

/**
 * Headline that reveals one line at a time, each sliding up out of its own mask.
 *
 * The mask is the whole trick: a line that only fades in looks like it flickered,
 * whereas clipping it to a fixed-height box and translating the text from
 * entirely below makes it look like it was always there being uncovered.
 *
 * Lines are explicit rather than measured from the rendered DOM. Measuring means
 * reading back a ref and splitting on every resize, and the split can land
 * mid-word on a narrow viewport; authored lines stay identical everywhere.
 *
 * `text-balance` is deliberately not used here — the lines are already balanced,
 * and balancing them again would let the browser rewrap and desynchronise the
 * masks from the text they are supposed to be clipping.
 */
export function HeroHeadline({
  lines,
  className,
  baseDelay = 0.08,
}: {
  lines: HeroLine[];
  className?: string;
  baseDelay?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <h1 className={cn('heading-display', className)}>
        {lines.map((line) => (
          <span key={line.text} className={cn('block', line.outline && 'text-outline')}>
            {line.text}
          </span>
        ))}
      </h1>
    );
  }

  return (
    <h1 className={cn('heading-display', className)}>
      {lines.map((line, index) => (
        // `overflow-hidden` is the mask. The negative top margin and matching
        // padding give descenders (g, y, p) somewhere to go so the mask does not
        // shave the bottom off them; without it the tail of the word is clipped.
        <span
          key={line.text}
          className="block overflow-hidden pt-[0.14em] -mt-[0.14em]"
        >
          <motion.span
            className={cn('block', line.outline && 'text-outline')}
            initial={{ y: '108%' }}
            animate={{ y: '0%' }}
            transition={{
              duration: DURATION.slow + 0.25,
              delay: baseDelay + index * 0.11,
              ease: EASE_OUT_EXPO,
            }}
          >
            {line.text}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}
