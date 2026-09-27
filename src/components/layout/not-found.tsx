import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <div className="container-kv flex min-h-[70dvh] flex-col items-center justify-center py-24 text-center">
      <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-full border border-kv-line bg-kv-surface text-kv-muted">
        <Compass className="h-7 w-7" />
      </div>
      <p className="eyebrow">Error 404</p>
      <h1 className="heading-display mt-4">This page is out of stock</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-kv-muted">
        The page you were looking for does not exist, or the piece has been archived. Head back to the
        collection to keep browsing.
      </p>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link to="/shop">Browse the collection</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
