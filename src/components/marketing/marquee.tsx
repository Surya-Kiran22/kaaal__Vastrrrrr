const ITEMS = [
  'Heavyweight Staples',
  'Sharp Silhouettes',
  'Monochrome Essentials',
  'Designed in Mumbai',
  'Kaal Vastr',
] as const;

const SEPARATOR = '?' as const;

/**
 * Full-width scrolling statement strip, matching the design reference.
 *
 * The track holds the item list repeated four times and is translated by
 * exactly -50%, so the fourth copy lines up with the first and the loop is
 * seamless. The four repeats exist only to keep the strip populated across a
 * wide viewport while the -50% jump happens off-screen.
 *
 * Decorative and non-interactive: it is aria-hidden and the copy is repeated
 * elsewhere on the page, so screen readers skip it entirely.
 */
export function Marquee() {
  const track = [...ITEMS, ...ITEMS, ...ITEMS, ...ITEMS].flatMap((item) => [item, SEPARATOR]);

  return (
    <section
      className="overflow-hidden border-y border-kv-line bg-kv-surface py-6"
      aria-hidden="true"
    >
      <div className="marquee-track flex w-max items-center whitespace-nowrap">
        {track.map((item, index) => (
          <span
            // The list is a fixed literal, so the index is a stable identity.
            key={`${item}-${index}`}
            className={
              item === SEPARATOR
                ? 'px-6 text-kv-crimson'
                : 'px-6 font-display text-2xl uppercase leading-none tracking-[0.02em] text-kv-silver'
            }
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
