import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Review, ReviewDocument } from './schemas/review.schema';
export interface RatingStats { averageRating:number; ratingCount:number; }
/** Shared public rating reader; neither Hotel nor Review stores a duplicate aggregate. */
@Injectable()
export class ReviewRatingsService {
  constructor(@InjectModel(Review.name) private readonly reviews:Model<ReviewDocument>) {}
  async getRatingStats(hotelIds:string[]):Promise<Map<string,RatingStats>> {
    const ids=[...new Set(hotelIds.filter(isValidObjectId).map(id=>id.toLowerCase()))].map(id=>new Types.ObjectId(id));
    if(!ids.length)return new Map();
    const rows:{_id:Types.ObjectId;average:number;count:number}[]=await this.reviews.aggregate([
      {$match:{hotelId:{$in:ids},isHidden:false}},
      {$group:{_id:'$hotelId',average:{$avg:'$rating'},count:{$sum:1}}},
    ]).exec();
    return new Map(rows.map(row=>[row._id.toString(),{averageRating:Math.round(row.average*100)/100,ratingCount:row.count}]));
  }
}
