import Link from "next/link";
import { Building2, MapPin, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatHotelPrice } from "./format";
import type { HotelSearchResult } from "./types";

export interface HotelCardProps {
  hotel: HotelSearchResult;
  /** Preserves the search context so the detail page can show the same stay. */
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

export function HotelCard({ hotel, checkIn, checkOut, guests, rooms }: HotelCardProps) {
  const detailHref = `/hotels/${hotel.hotelId}?${new URLSearchParams({ checkIn, checkOut, guests: String(guests), rooms: String(rooms) })}`;

  return (
    <Card className="grid grid-cols-[120px_1fr] gap-4 p-4 sm:grid-cols-[160px_1fr] sm:p-5">
      <div className="flex aspect-[4/3] items-center justify-center rounded-control border border-border bg-canvas text-muted">
        <Building2 size={32} aria-hidden="true" />
      </div>
      <div className="grid content-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={detailHref} className="no-underline">
              <h3 className="m-0 text-lg">{hotel.name}</h3>
            </Link>
            {hotel.starClass && (
              <span className="flex items-center gap-0.5 text-sand" aria-label={`${hotel.starClass} star hotel`}>
                {Array.from({ length: hotel.starClass }, (_, index) => <Star key={index} size={14} fill="currentColor" aria-hidden="true" />)}
              </span>
            )}
          </div>
          <p className="m-0 flex items-center gap-1 text-sm text-muted">
            <MapPin size={14} aria-hidden="true" />
            {hotel.city}, {hotel.countryCode}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {hotel.averageRating !== null ? (
              <Badge tone="success">{hotel.averageRating.toFixed(1)} ★ ({hotel.ratingCount})</Badge>
            ) : (
              <Badge>Not yet rated</Badge>
            )}
            {hotel.amenities?.slice(0, 3).map(amenity => <Badge key={amenity} tone="info">{amenity}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="m-0 text-sm text-muted">{hotel.availableRooms} room{hotel.availableRooms === 1 ? "" : "s"} available for these dates</p>
          <div className="text-right">
            <p className="m-0 text-xl font-semibold text-ink">{formatHotelPrice(hotel.fromPrice, hotel.currency)}</p>
            <p className="m-0 text-sm text-muted">per night, from</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
