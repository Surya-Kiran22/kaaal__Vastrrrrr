import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ProductGalleryProps {
  images: string[];
  alt: string;
  className?: string;
}

export function ProductGallery({ images, alt, className }: ProductGalleryProps) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [failed, setFailed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setIndex(0);
  }, [images]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(false);
      if (event.key === 'ArrowRight') setIndex((prev) => (prev + 1) % images.length);
      if (event.key === 'ArrowLeft') setIndex((prev) => (prev - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [lightbox, images.length]);

  const hasImages = images.length > 0;
  const go = (direction: 1 | -1) => {
    if (!hasImages) return;
    setIndex((prev) => (prev + direction + images.length) % images.length);
  };

  return (
    <>
      <div className={cn('space-y-3', className)}>
        <div className="group relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-kv-line bg-kv-raised">
          {hasImages && !failed.has(index) ? (
            <motion.img
              key={images[index]}
              src={images[index]}
              alt={`${alt} — view ${index + 1}`}
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              onError={() => setFailed((prev) => new Set(prev).add(index))}
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={() => setLightbox(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xs uppercase tracking-widest text-kv-dim">
              No image available
            </div>
          )}

          {hasImages && images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-kv-line bg-kv-bg/70 text-kv-white backdrop-blur transition-all duration-300 hover:bg-kv-bg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next image"
                className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-kv-line bg-kv-bg/70 text-kv-white backdrop-blur transition-all duration-300 hover:bg-kv-bg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="absolute bottom-3 right-3 rounded-full border border-kv-line bg-kv-bg/70 px-2.5 py-1 text-2xs tabular-nums text-kv-silver backdrop-blur">
                {index + 1} / {images.length}
              </span>
            </>
          ) : null}
        </div>

        {images.length > 1 ? (
          <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
            {images.map((image, thumbIndex) => (
              <button
                key={image}
                type="button"
                onClick={() => setIndex(thumbIndex)}
                aria-label={`View image ${thumbIndex + 1}`}
                aria-current={thumbIndex === index}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-lg border transition-all duration-300 ease-premium',
                  thumbIndex === index
                    ? 'border-kv-white/70 opacity-100'
                    : 'border-kv-line opacity-55 hover:opacity-90',
                )}
              >
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden';
                  }}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {lightbox && hasImages ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} image viewer`}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-kv-bg/95 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="Close image viewer"
            className="absolute right-5 top-5 rounded-full border border-kv-line bg-kv-surface p-2 text-kv-silver transition-colors hover:text-kv-white"
          >
            <X className="h-4 w-4" />
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  go(-1);
                }}
                aria-label="Previous image"
                className="absolute left-4 rounded-full border border-kv-line bg-kv-surface p-3 text-kv-white transition-colors hover:bg-kv-hover"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  go(1);
                }}
                aria-label="Next image"
                className="absolute right-4 rounded-full border border-kv-line bg-kv-surface p-3 text-kv-white transition-colors hover:bg-kv-hover"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
          <img
            src={images[index]}
            alt={`${alt} — view ${index + 1}`}
            className="max-h-[88dvh] max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
