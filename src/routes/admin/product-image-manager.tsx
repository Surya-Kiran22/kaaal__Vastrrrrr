import { ImagePlus, Loader2, Star, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDeleteStoredImage, useUploadProductImage, storagePathFromUrl } from '@/hooks/useAdminMutations';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ImageValue {
  image_url: string | null;
  images: string[];
}

interface ProductImageManagerProps {
  formValue: ImageValue;
  onChange: (next: ImageValue) => void;
  maxImages?: number;
}

export function ProductImageManager({
  formValue,
  onChange,
  maxImages = 6,
}: ProductImageManagerProps) {
  const upload = useUploadProductImage();
  const removeStored = useDeleteStoredImage();
  const inputRef = useRef<HTMLInputElement>(null);

  const [urlDraft, setUrlDraft] = useState('');
  const [uploading, setUploading] = useState(false);

  const gallery = formValue.images ?? [];
  const primary = formValue.image_url;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const room = maxImages - gallery.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${maxImages} images.`);
      return;
    }

    setUploading(true);
    try {
      const accepted = Array.from(files).slice(0, room);
      const uploadedUrls: string[] = [];
      for (const file of accepted) {
        const result = await upload.mutateAsync(file);
        uploadedUrls.push(result.publicUrl);
      }

      const nextGallery = [...gallery, ...uploadedUrls];
      onChange({ images: nextGallery, image_url: primary ?? nextGallery[0] ?? null });
      toast.success(`${uploadedUrls.length} image${uploadedUrls.length === 1 ? '' : 's'} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const addUrl = () => {
    const value = urlDraft.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      toast.error('Enter a full image URL starting with http:// or https://');
      return;
    }
    if (gallery.includes(value)) {
      toast.error('That image is already attached.');
      return;
    }
    const nextGallery = [...gallery, value];
    onChange({ images: nextGallery, image_url: primary ?? value });
    setUrlDraft('');
  };

  const detach = async (url: string) => {
    const nextGallery = gallery.filter((entry) => entry !== url);
    onChange({
      images: nextGallery,
      image_url: primary === url ? (nextGallery[0] ?? null) : primary,
    });

    // Only remove from storage if the file belongs to this project's bucket.
    const path = storagePathFromUrl(url);
    if (path) {
      try {
        await removeStored.mutateAsync(path);
      } catch {
        // Detaching from the product is what matters; storage cleanup can retry later.
      }
    }
  };

  const makePrimary = (url: string) => onChange({ ...formValue, image_url: url });

  return (
    <div className="space-y-4">
      {/* Uploader ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-kv-line p-4 sm:flex-row sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || gallery.length >= maxImages}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload images'}
        </Button>
        <p className="text-2xs leading-relaxed text-kv-dim">
          JPEG, PNG, WebP or AVIF up to 5 MB each. The first image becomes the cover shot. Maximum{' '}
          {maxImages} images.
        </p>
      </div>

      {/* URL input ------------------------------------------------------ */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addUrl();
            }
          }}
          placeholder="Or paste an image URL…"
          aria-label="Image URL"
          className="w-full rounded-lg border border-kv-line bg-kv-surface px-3.5 py-2.5 text-sm text-kv-white placeholder:text-kv-dim transition-colors hover:border-kv-lineStrong focus:border-kv-white/50 focus:outline-none focus:ring-1 focus:ring-kv-white/30"
        />
        <Button type="button" variant="outline" onClick={addUrl} className="shrink-0">
          <ImagePlus className="h-4 w-4" />
          Attach URL
        </Button>
      </div>

      {/* Gallery -------------------------------------------------------- */}
      {gallery.length === 0 ? (
        <p className="rounded-lg border border-dashed border-kv-line px-4 py-8 text-center text-xs text-kv-dim">
          No images attached. Products without imagery still publish, but shoppers convert far better with
          photos.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {gallery.map((url, index) => {
            const isPrimary = url === primary;
            return (
              <li
                key={url}
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-lg border bg-kv-raised transition-colors',
                  isPrimary ? 'border-kv-white/70' : 'border-kv-line',
                )}
              >
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />

                {isPrimary ? (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-kv-white px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-kv-bg">
                    Cover
                  </span>
                ) : null}

                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                  {!isPrimary ? (
                    <button
                      type="button"
                      onClick={() => makePrimary(url)}
                      aria-label="Set as cover image"
                      title="Set as cover"
                      className="rounded-full bg-kv-bg/85 p-1.5 text-kv-silver backdrop-blur transition-colors hover:text-kv-white"
                    >
                      <Star className="h-3 w-3" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void detach(url)}
                    aria-label="Remove image"
                    title="Remove image"
                    className="rounded-full bg-kv-bg/85 p-1.5 text-kv-silver backdrop-blur transition-colors hover:text-kv-danger"
                  >
                    {isPrimary ? <X className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>

                <span className="absolute right-1.5 top-1.5 rounded-full bg-kv-bg/85 px-1.5 py-0.5 text-[0.5625rem] tabular-nums text-kv-dim backdrop-blur">
                  {index + 1}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-start gap-2 text-2xs text-kv-dim">
        {/* aria-label rather than a visible <label>: the placeholder is not an
            accessible name, so this input was previously announced only as
            "edit text". */}
        <input
          id="image_url"
          type="text"
          aria-label="Cover image URL"
          value={primary ?? ''}
          onChange={(event) => onChange({ ...formValue, image_url: event.target.value || null })}
          placeholder="Cover image URL (optional — usually set by uploading above)"
          className="w-full rounded-lg border border-kv-line bg-kv-surface px-3 py-2 text-xs text-kv-white placeholder:text-kv-dim focus:border-kv-white/50 focus:outline-none focus:ring-1 focus:ring-kv-white/30"
        />
      </div>
    </div>
  );
}
