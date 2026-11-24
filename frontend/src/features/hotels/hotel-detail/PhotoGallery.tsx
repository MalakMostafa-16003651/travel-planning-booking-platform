"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import type { HotelPhoto } from "./types";

export interface PhotoGalleryProps {
  photos: HotelPhoto[];
  hotelName: string;
}

export function PhotoGallery({ photos, hotelName }: PhotoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-card border border-border bg-canvas text-muted">
        <Building2 size={48} aria-hidden="true" />
      </div>
    );
  }

  const active = photos[Math.min(activeIndex, photos.length - 1)];

  return (
    <div className="grid gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- images are served from our own API, not an optimizable remote host */}
      <img src={active.url} alt={`${hotelName} photo ${activeIndex + 1} of ${photos.length}`} className="aspect-video w-full rounded-card border border-border object-cover" />
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((photo, index) => (
            <button
              key={photo._id}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Show photo ${index + 1}`}
              aria-current={index === activeIndex}
              className={`size-16 shrink-0 overflow-hidden rounded-control border ${index === activeIndex ? "border-primary" : "border-border"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
              <img src={photo.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
