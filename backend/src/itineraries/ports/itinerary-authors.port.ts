import { AccountStatus } from '../../common/enums/account-status.enum';

export const ITINERARY_AUTHORS = 'ITINERARY_AUTHORS';

export interface ItineraryAuthor {
  name: string;
  status: AccountStatus;
}

/**
 * ACC-12: who wrote an itinerary and whether their content may be shown. Planned to be
 * served by UsersService (Person 1). Returns entries only for users that exist; a
 * missing entry means the author is hidden. Errors must propagate (fail closed).
 */
export interface ItineraryAuthorsPort {
  getAuthors(userIds: string[]): Promise<Map<string, ItineraryAuthor>>;
}

/** Authors whose public itineraries may be listed, viewed or cloned. */
export function isVisibleAuthor(author: ItineraryAuthor | undefined): author is ItineraryAuthor {
  return author !== undefined && author.status !== AccountStatus.DEACTIVATED;
}
