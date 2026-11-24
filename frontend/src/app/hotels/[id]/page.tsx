import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PhotoGallery } from "@/features/hotels/hotel-detail/PhotoGallery";
import { ReviewsSection } from "@/features/hotels/hotel-detail/ReviewsSection";
import { RoomSelector } from "@/features/hotels/hotel-detail/RoomSelector";
import { StayCheckForm } from "@/features/hotels/hotel-detail/StayCheckForm";
import { getHotelDetail } from "@/features/hotels/hotel-detail/server-fetch";

// Rendering: dynamic. Profile is mostly public, but availableRooms/reviews are
// request-specific (stay dates, and a signed-in moderator/admin sees more).
export const dynamic = "force-dynamic";

type Raw = Record<string, string | string[] | undefined>;
const one = (value: Raw[string]) => (Array.isArray(value) ? value[0] : value);

export default async function HotelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Raw>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const checkIn = one(raw.checkIn) ?? "";
  const checkOut = one(raw.checkOut) ?? "";
  const guests = Math.max(1, Number(one(raw.guests)) || 1);

  const hotel = await getHotelDetail(id, { checkIn: checkIn || undefined, checkOut: checkOut || undefined, guests });
  if (!hotel) notFound();

  const hasStay = Boolean(checkIn && checkOut);

  return (
    <div className="page-container page-content stack">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="m-0">{hotel.name}</h1>
          {hotel.starClass && (
            <span className="flex items-center gap-0.5 text-sand" aria-label={`${hotel.starClass} star hotel`}>
              {Array.from({ length: hotel.starClass }, (_, index) => <Star key={index} size={18} fill="currentColor" aria-hidden="true" />)}
            </span>
          )}
        </div>
        <p className="muted">{hotel.address}, {hotel.city}, {hotel.countryCode}</p>
      </div>

      <PhotoGallery photos={hotel.photos} hotelName={hotel.name} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="stack">
          {hotel.description && <p className="m-0">{hotel.description}</p>}
          {hotel.amenities && hotel.amenities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hotel.amenities.map(amenity => <Badge key={amenity} tone="info">{amenity}</Badge>)}
            </div>
          )}
        </div>
        <div className="grid gap-2 rounded-card border border-border bg-card p-4 text-sm">
          <p className="m-0"><strong>Check-in:</strong> {hotel.checkInTime}</p>
          <p className="m-0"><strong>Check-out:</strong> {hotel.checkOutTime}</p>
          {hotel.cancellationTiers.length > 0 ? (
            <div>
              <p className="m-0 font-semibold text-ink">Cancellation policy</p>
              <ul className="m-0 pl-4">
                {hotel.cancellationTiers.map(tier => (
                  <li key={tier.daysBeforeCheckIn}>{tier.refundPercentage}% refund, {tier.daysBeforeCheckIn}+ days before check-in</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="m-0 text-muted">No refunds on cancellation.</p>
          )}
        </div>
      </div>

      <section aria-labelledby="hotel-rooms-heading" className="stack">
        <h2 id="hotel-rooms-heading" className="m-0">Available rooms</h2>
        <StayCheckForm hotelId={hotel.hotelId} initialCheckIn={checkIn} initialCheckOut={checkOut} initialGuests={guests} />
        {hasStay && hotel.availableRooms && (
          <RoomSelector hotelId={hotel.hotelId} rooms={hotel.availableRooms} checkIn={checkIn} checkOut={checkOut} initialGuests={guests} />
        )}
      </section>

      {hotel.reviews && <ReviewsSection hotelId={hotel.hotelId} initialPage={hotel.reviews} />}
    </div>
  );
}
