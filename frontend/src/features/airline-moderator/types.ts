export interface Airline {
  _id: string;
  name: string;
  code: string;
  logo?: string | null;
  isActive: boolean;
  baggagePolicy: { pricePerExtraBag: number; maxExtraBagsPerPassenger: number };
  cancellationTiers: { daysBeforeDeparture: number; refundPercentage: number }[];
}
