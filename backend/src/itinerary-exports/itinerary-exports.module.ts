import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { ItineraryExportsController } from './itinerary-exports.controller';
import { ItineraryPdfService } from './itinerary-pdf.service';
@Module({ imports: [AuthModule, ItinerariesModule], controllers: [ItineraryExportsController], providers: [ItineraryPdfService] })
export class ItineraryExportsModule {}
