"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaUploader, type MediaItem } from "@/features/media/media-uploader";
import { apiClient, uploadFile } from "@/lib/api/client";
import type { HotelPhoto } from "@/features/hotels/hotel-detail/types";

export interface HotelPhotosManagerProps {
  hotelId: string;
  photos: HotelPhoto[];
}

export function HotelPhotosManager({ hotelId, photos }: HotelPhotosManagerProps) {
  const router = useRouter();
  const [value, setValue] = useState<MediaItem[]>(photos.map(photo => ({ id: photo._id, url: photo.url })));

  return (
    <MediaUploader
      label="Hotel photos"
      value={value}
      maxCount={5}
      helpText="JPG or PNG, up to 5 MB each, up to 5 photos."
      onUpload={async (file, onProgress) => {
        const updated = await uploadFile<{ photos: { _id: string; url: string }[] }>(`/hotels/${hotelId}/photos`, "photo", file, onProgress);
        const newest = updated.photos[updated.photos.length - 1];
        const item: MediaItem = { id: newest._id, url: newest.url };
        setValue(current => [...current, item]);
        router.refresh();
        return item;
      }}
      onRemove={async item => {
        await apiClient(`/hotels/${hotelId}/photos/${item.id}`, { method: "DELETE" });
        setValue(current => current.filter(existing => existing.id !== item.id));
        router.refresh();
      }}
    />
  );
}
