import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { ReservationsList } from "@/features/hotels/hotel-moderator/ReservationsList";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel, getOwnReservations } from "@/features/hotels/hotel-moderator/server-fetch";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservations" };

export default async function ModeratorReservationsPage() {
  const user = await requireHotelModerator("/moderator/hotel/reservations");
  if (!user) return <AccessDenied />;

  const hotel = await getMyHotel();
  const reservations = hotel ? await getOwnReservations(hotel._id) : null;

  return (
    <div className="page-container page-content stack">
      <h1>Reservations</h1>
      <ModeratorNav />
      {!hotel || !reservations ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : (
        <ReservationsList hotelId={hotel._id} initialPage={reservations} />
      )}
    </div>
  );
}
