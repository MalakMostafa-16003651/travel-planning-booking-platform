import { AccountStatus } from '../../common/enums/account-status.enum';

export const ITINERARY_ACCOUNT_STATUSES = 'ITINERARY_ACCOUNT_STATUSES';
export const ITINERARY_AUTHOR_NAMES = 'ITINERARY_AUTHOR_NAMES';

/**
 * ACC-12: the shared interface agreed with Person 1, matching
 * `UsersService.getAccountStatuses(userIds)` exactly so the binding can become
 * `useExisting: UsersService` once it is implemented. Returns entries only for users that
 * exist; a missing entry means the author is hidden. Errors must propagate (fail closed).
 *
 * Every visibility decision (listing, search, viewing, cloning) uses only this port.
 */
export interface ItineraryAccountStatusesPort {
  getAccountStatuses(userIds: string[]): Promise<Map<string, AccountStatus>>;
}

/**
 * Display names for author pages and clone attribution (ITN-21). Never used to decide
 * visibility. A missing entry is shown as "Deleted user".
 */
export interface ItineraryAuthorNamesPort {
  getDisplayNames(userIds: string[]): Promise<Map<string, string>>;
}

/** Authors whose public itineraries may be listed, viewed or cloned: existing and not DEACTIVATED. */
export function isVisibleStatus(status: AccountStatus | undefined): status is AccountStatus {
  return status === AccountStatus.ACTIVE || status === AccountStatus.SUSPENDED;
}
