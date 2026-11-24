"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface MediaItem {
  id: string;
  url: string;
}

export interface MediaUploaderProps {
  /** What this uploader is for, shown above the grid and used in alt text ("Hotel photos", "Airline logo"). */
  label: string;
  value: MediaItem[];
  maxCount: number;
  /** Caller owns the actual endpoint (hotel photos, post images, activity images, airline logo, ...). */
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<MediaItem>;
  /** Omit for an uploader with no removal, e.g. a logo that a new upload simply replaces. */
  onRemove?: (item: MediaItem) => Promise<void>;
  helpText?: string;
  disabled?: boolean;
}

function validate(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Only JPG or PNG images are accepted.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

export function MediaUploader({ label, value, maxCount, onUpload, onRemove, helpText, disabled }: MediaUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const atLimit = value.length >= maxCount;

  async function handleFile(file: File) {
    const validationError = validate(file);
    if (validationError) { setError(validationError); return; }
    setError(null);
    setProgress(0);
    try {
      await onUpload(file, setProgress);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The upload failed. Please try again.");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(item: MediaItem) {
    if (!onRemove) return;
    setError(null);
    setRemovingId(item.id);
    try {
      await onRemove(item);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn’t remove that image. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="stack">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm font-semibold text-ink">{label}</p>
        <span className="text-sm text-muted">{value.length} / {maxCount}</span>
      </div>
      {helpText && <p className="m-0 text-sm text-muted">{helpText}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {value.map(item => (
          <div key={item.id} className="group relative aspect-[4/3] overflow-hidden rounded-control border border-border bg-canvas">
            {/* eslint-disable-next-line @next/next/no-img-element -- images are served from our own API, not an optimizable remote host */}
            <img src={item.url} alt={label} className="size-full object-cover" />
            {onRemove && (
              <button
                type="button"
                onClick={() => handleRemove(item)}
                disabled={disabled || removingId === item.id}
                aria-label={`Remove ${label.toLowerCase()}`}
                className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full border border-border bg-card text-ink shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {removingId === item.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              </button>
            )}
          </div>
        ))}
        {!atLimit && (
          <label className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-control border border-dashed border-border text-sm text-muted transition-colors ${disabled || uploading ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary hover:text-primary"}`}>
            {uploading ? (
              <>
                <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                <span>{progress}%</span>
              </>
            ) : (
              <>
                <ImagePlus size={20} aria-hidden="true" />
                <span>Add photo</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              className="sr-only"
              aria-label={label}
              disabled={disabled || uploading}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </label>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
