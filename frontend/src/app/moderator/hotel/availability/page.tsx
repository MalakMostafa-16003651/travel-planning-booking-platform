import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { AvailabilityManager } from "@/features/hotels/hotel-moderator/AvailabilityManager";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel, getOwnAvailability } from "@/features/hotels/hotel-moderator/server-fetch";
import { addDaysToDateOnly, todayDateOnly } from "@/features/hotels/date-only";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Room availability" };

type Raw = Record<string, string | string[] | undefined>;
const one = (value: Raw[string]) => (Array.isArray(value) ? value[0] : value);

export default async function ModeratorAvailabilityPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const user = await requireHotelModerator("/moderator/hotel/availability");
  if (!user) return <AccessDenied />;

  const raw = await searchParams;
  const from = one(raw.from) || todayDateOnly();
  const to = one(raw.to) || addDaysToDateOnly(from, 14);

  const hotel = await getMyHotel();
  const availability = hotel ? await getOwnAvailability(hotel._id, { from, to }) : null;

  return (
    <div className="page-container page-content stack">
      <h1>Room availability</h1>
      <ModeratorNav />
      {!hotel || !availability ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : availability.items.length === 0 ? (
        <EmptyState title="No rooms yet" description="Add a room first to manage its availability." />
      ) : (
        <AvailabilityManager hotelId={hotel._id} initialData={availability} initialFrom={from} initialTo={to} />
      )}
    </div>
  );
}
