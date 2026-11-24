import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { RoomCreateForm } from "@/features/hotels/hotel-moderator/RoomCreateForm";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel } from "@/features/hotels/hotel-moderator/server-fetch";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add a room" };

export default async function NewRoomPage() {
  const user = await requireHotelModerator("/moderator/hotel/rooms/new");
  if (!user) return <AccessDenied />;

  const hotel = await getMyHotel();

  return (
    <div className="page-container page-content stack">
      <h1>Add a room</h1>
      <ModeratorNav />
      {!hotel ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : (
        <RoomCreateForm hotelId={hotel._id} />
      )}
    </div>
  );
}
