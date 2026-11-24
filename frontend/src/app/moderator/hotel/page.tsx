import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { HotelPhotosManager } from "@/features/hotels/hotel-moderator/HotelPhotosManager";
import { HotelProfileForm } from "@/features/hotels/hotel-moderator/HotelProfileForm";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel } from "@/features/hotels/hotel-moderator/server-fetch";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your hotel" };

export default async function ModeratorHotelPage() {
  const user = await requireHotelModerator("/moderator/hotel");
  if (!user) return <AccessDenied />;

  const hotel = await getMyHotel();

  return (
    <div className="page-container page-content stack">
      <h1>Your hotel</h1>
      <ModeratorNav />
      {!hotel ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : (
        <>
          <section aria-labelledby="hp-heading" className="stack">
            <h2 id="hp-heading" className="m-0">Profile</h2>
            <HotelProfileForm hotel={hotel} />
          </section>
          <section aria-labelledby="hphotos-heading" className="stack">
            <h2 id="hphotos-heading" className="m-0">Photos</h2>
            <HotelPhotosManager hotelId={hotel._id} photos={hotel.photos} />
          </section>
        </>
      )}
    </div>
  );
}
