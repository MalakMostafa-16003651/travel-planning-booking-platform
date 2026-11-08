import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelsModule } from '../hotels/hotels.module';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { UsersModule } from '../users/users.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Review, ReviewSchema } from './schemas/review.schema';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    HotelsModule,
    HotelBookingsModule,
    MongooseModule.forFeature([{ name: Review.name, schema: ReviewSchema }]),
  ],
  controllers: [ReviewsController],
  // OptionalAuthGuard is Person 7's guest-or-user guard, reused unchanged (as the blog does).
  providers: [ReviewsService, OptionalAuthGuard],
  // Person 2 (GEN-09/10 hooks) and Person 5 (getRatingStats for HTL-02/HTL-12) connect these on their side.
  exports: [ReviewsService],
})
export class ReviewsModule {}
