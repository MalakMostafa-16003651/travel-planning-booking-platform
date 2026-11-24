import "server-only";
import { redirect } from "next/navigation";
import { loginHref } from "@/config/routes";
import { getServerSession } from "@/lib/api/server-session";
import type { AuthenticatedUser } from "@/types/auth";

/**
 * Same session/role check as every other role-gated page (ProfilePage's getServerSession +
 * redirect pattern). Returns null for the wrong role so the page can show "Access denied"
 * instead of a blank redirect loop; an absent session redirects to login immediately.
 */
export async function requireHotelModerator(returnTo: string): Promise<AuthenticatedUser | null> {
  const user = await getServerSession();
  if (!user) redirect(loginHref(returnTo));
  if (user.role !== "HOTEL_MODERATOR") return null;
  return user;
}
