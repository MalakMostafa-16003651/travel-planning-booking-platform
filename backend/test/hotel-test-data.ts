import { Connection, Types } from 'mongoose';
/** Explicit test setup only: production rooms stay closed until a moderator configures dates. */
export async function configureTestBookableRoom(connection:Connection,roomId:Types.ObjectId|string,hotelId:Types.ObjectId|string):Promise<void> {
  await connection.collection('roomavailabilities').updateOne({roomId:new Types.ObjectId(roomId.toString())},
    {$set:{bookableRanges:[{startDate:'2020-01-01',endDate:'2100-01-01'}]},
      $setOnInsert:{roomId:new Types.ObjectId(roomId.toString()),hotelId:new Types.ObjectId(hotelId.toString()),blockedRanges:[],bookedRanges:[]}}, {upsert:true});
}
