import type { Metadata } from "next";
import { AccessDenied, ModeratorNav } from "@/features/hotels/hotel-moderator/ModeratorNav";
import { PoliciesForm } from "@/features/hotels/hotel-moderator/PoliciesForm";
import { requireHotelModerator } from "@/features/hotels/hotel-moderator/require-moderator";
import { getMyHotel } from "@/features/hotels/hotel-moderator/server-fetch";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hotel policies" };

export default async function ModeratorPoliciesPage() {
  const user = await requireHotelModerator("/moderator/hotel/policies");
  if (!user) return <AccessDenied />;

  const hotel = await getMyHotel();

  return (
    <div className="page-container page-content stack">
      <h1>Policies</h1>
      <ModeratorNav />
      {!hotel ? (
        <EmptyState title="No hotel assigned" description="Ask an administrator to assign you to a hotel." />
      ) : (
        <PoliciesForm hotel={hotel} />
      )}
    </div>
  );
}
