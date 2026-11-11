import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Review, ReviewSchema } from './schemas/review.schema';
import { ReviewRatingsService } from './review-ratings.service';
@Module({imports:[MongooseModule.forFeature([{name:Review.name,schema:ReviewSchema}])],providers:[ReviewRatingsService],exports:[ReviewRatingsService]})
export class ReviewRatingsModule {}
