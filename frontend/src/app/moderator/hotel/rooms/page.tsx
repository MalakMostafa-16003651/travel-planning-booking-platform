import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { RoomsList } from "@/features/hotels/hotel-moderator/RoomsList";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel, getOwnRooms } from "@/features/hotels/hotel-moderator/server-fetch";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your rooms" };

export default async function ModeratorRoomsPage() {
  const user = await requireHotelModerator("/moderator/hotel/rooms");
  if (!user) return <AccessDenied />;

  const hotel = await getMyHotel();
  const rooms = hotel ? await getOwnRooms(hotel._id) : null;

  return (
    <div className="page-container page-content stack">
      <h1>Rooms</h1>
      <ModeratorNav />
      {!hotel || !rooms ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : (
        <RoomsList hotelId={hotel._id} initialPage={rooms} />
      )}
    </div>
  );
}
