import { DragEvent, useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { cx } from '../../lib/format';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Drag-and-drop / click image picker with preview (PNG, JPG, WebP, GIF, 5MB). */
export default function ImageDrop({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return setError('Unsupported file type. Use PNG, JPG, WebP or GIF.');
    if (f.size > MAX_IMAGE_BYTES) return setError('Image is too large. Max size is 5MB.');
    setError(null);
    onFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  }

  return (
    <div>
      {preview ? (
        <div className="relative overflow-hidden rounded-xl border border-border bg-base">
          <img src={preview} alt="Preview" className="max-h-80 w-full object-contain" />
          <button
            type="button"
            onClick={() => onFile(null)}
            aria-label="Remove image"
            className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white hover:bg-black"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Choose an image to upload"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-12 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            dragging ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
          )}
        >
          <ImagePlus className="text-accent" />
          <p className="text-sm font-semibold">Drop a screenshot or click to choose</p>
          <p className="text-xs text-text-muted">PNG, JPG, WebP or GIF, up to 5MB</p>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
