import assert from 'node:assert/strict';
import { after,before,beforeEach,describe,it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelsModule } from '../src/hotels/hotels.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe,TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

describe('Hotels mandatory metadata, positive availability and public selection', {concurrency:false},()=>{
  const f=new PaymentsFixture();let admin:{cookie:string;userId:string},mod:{cookie:string;userId:string},user:{cookie:string;userId:string},hotelId:string,stripe:FakeStripe,sequence:number;
  const col=(name:string)=>f.connection.collection(name),oid=(id:string)=>new Types.ObjectId(id);
  const date=(offset:number)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
  const post=(path:string,body:object,cookie=mod.cookie)=>f.http().post('/api/'+path).set('Cookie',cookie).send(body);
  const ranges=(id:string,value:object[],cookie=mod.cookie,hid=hotelId)=>f.http().put('/api/hotels/'+hid+'/rooms/'+id+'/bookable-ranges').set('Cookie',cookie).send({ranges:value});
  const search=(extra:Record<string,unknown>={})=>f.http().get('/api/hotels/search').query({countryCode:'EG',checkIn:date(10),checkOut:date(13),guests:1,...extra});
  async function room(extra:object={}):Promise<any>{
    return (await post('hotels/'+hotelId+'/rooms',{name:'Room '+(++sequence),type:'Deluxe',beds:2,capacity:4,pricePerNight:10000,...extra}).expect(201)).body;
  }
  async function open(id:string){await ranges(id,[{startDate:date(0),endDate:date(90)}]).expect(200);}
  const hold=(id:string,extra:object={})=>post('hotel-bookings',{hotelId,checkIn:date(10),checkOut:date(13),rooms:[{roomId:id,adults:1,childrenAges:[]}],...extra},user.cookie);
  async function confirm(id:string){
    await post('bookings/hotel/'+id+'/accept-policies',{accepted:true},user.cookie).expect(200);
    const pay=(await post('payments',{bookingType:'hotel',bookingId:id},user.cookie).expect(201)).body.payment;
    const event=FakeStripe.signedEvent('payment_intent.succeeded',stripe.succeed(pay.stripePaymentIntentId));
    await f.http().post('/api/payments/webhook').set('stripe-signature',event.signature).set('Content-Type','application/json').send(event.payload).expect(200);
  }
  before(async()=>{await f.start('hotels-mandatory',undefined,TEST_STRIPE_CONFIG,[HotelsModule]);},{timeout:120000});
  after(()=>f.stop());
  beforeEach(async()=>{
    await f.reset();await f.app.get(ReferenceDataService).seedSupported();sequence=0;stripe=new FakeStripe();stripe.install(f.app.get(StripeService));
    admin=await f.login('hotel-completion-admin@example.com',UserRole.ADMIN);
    mod=await f.login('hotel-completion-mod@example.com',UserRole.HOTEL_MODERATOR);
    user=await f.login('hotel-completion-user@example.com');
    hotelId=(await post('hotels',{name:'Nile Hotel',city:'Cairo',address:'1 Nile Street',starClass:4,amenities:['Wi-Fi','Pool']},admin.cookie).expect(201)).body._id;
    await col('moderatorassignments').insertOne({moderatorId:oid(mod.userId),hotelId:oid(hotelId)});
  });
  it('validates and persists required new hotel/room metadata without inventing legacy values',async()=>{
    await post('hotels',{name:'Missing stars',city:'Cairo',address:'Street'},admin.cookie).expect(400);
    await post('hotels',{name:'Invalid stars',city:'Cairo',address:'Street',starClass:6,amenities:[]},admin.cookie).expect(400);
    await post('hotels/'+hotelId+'/rooms',{name:'Missing beds',type:'Single',capacity:1,pricePerNight:100}).expect(400);
    await room({name:'  Trimmed  ',type:'  Deluxe  '});
    const raw=(await col('rooms').findOne({name:'Trimmed'}))!;assert.equal(raw.type,'Deluxe');assert.equal(raw.beds,2);
    const profile=(await f.http().get('/api/hotels/'+hotelId).expect(200)).body;
    assert.equal(profile.starClass,4);assert.deepEqual(profile.amenities,['Wi-Fi','Pool']);assert.equal(profile.averageRating,null);assert.equal(profile.ratingCount,0);
    for(const body of [{name:'   '},{type:' '},{beds:0},{beds:1.5},{beds:null}])await f.http().patch('/api/hotels/'+hotelId+'/rooms/'+raw._id).set('Cookie',mod.cookie).send(body).expect(400);
  });
  it('enforces case-insensitive hotel-local names under concurrent creation',async()=>{
    const body={name:'Twin',type:'Twin',beds:2,capacity:2,pricePerNight:9000};
    const responses=await Promise.all([post('hotels/'+hotelId+'/rooms',body),post('hotels/'+hotelId+'/rooms',{...body,name:'tWiN'})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal(await col('rooms').countDocuments({hotelId:oid(hotelId)}),1);
  });
  it('keeps legacy duplicates intact while preventing new collisions and allowing explicit repair',async()=>{
    const legacy=[new Types.ObjectId(),new Types.ObjectId()];
    await col('rooms').insertMany(legacy.map(_id=>({_id,hotelId:oid(hotelId),name:'Legacy',capacity:1,pricePerNight:100,isActive:true})));
    await post('hotels/'+hotelId+'/rooms',{name:'legacy',type:'Single',beds:1,capacity:1,pricePerNight:100}).expect(409);
    await f.http().patch('/api/hotels/'+hotelId+'/rooms/'+legacy[0]).set('Cookie',mod.cookie).send({name:'Repaired',type:'Single',beds:1}).expect(200);
    assert.equal(await col('rooms').countDocuments({hotelId:oid(hotelId)}),2);
  });
  it('closes unconfigured rooms to both public search and new reservations',async()=>{
    const r=await room();
    assert.equal((await search().expect(200)).body.total,0);
    assert.equal((await f.http().get('/api/hotels/'+hotelId+'/rooms/available').query({checkIn:date(10),checkOut:date(13)}).expect(200)).body.total,0);
    await hold(r._id).expect(409);
    await open(r._id);assert.equal((await search().expect(200)).body.total,1);await hold(r._id).expect(201);
  });
  it('rejects overlapping/impossible ranges and merges adjacent half-open windows',async()=>{
    const r=await room();
    await ranges(r._id,[{startDate:date(1),endDate:date(12)},{startDate:date(11),endDate:date(20)}]).expect(400);
    await ranges(r._id,[{startDate:'2027-02-30',endDate:'2027-03-03'}]).expect(400);
    const response=(await ranges(r._id,[{startDate:date(10),endDate:date(11)},{startDate:date(11),endDate:date(13)}]).expect(200)).body;
    assert.deepEqual(response.bookableRanges,[{startDate:date(10),endDate:date(13)}]);
    await hold(r._id).expect(201);
  });
  it('requires the full stay to be covered, honoring checkout boundaries and real gaps',async()=>{
    const r=await room();await ranges(r._id,[{startDate:date(10),endDate:date(11)},{startDate:date(12),endDate:date(14)}]).expect(200);
    assert.equal((await search().expect(200)).body.total,0);await hold(r._id).expect(409);
    await ranges(r._id,[{startDate:date(10),endDate:date(13)}]).expect(200);assert.equal((await search().expect(200)).body.total,1);
    await hold(r._id,{checkOut:date(14)}).expect(409);
  });
  it('protects live pending stays and permits removing dates only after expiry',async()=>{
    const r=await room();await open(r._id);const held=(await hold(r._id).expect(201)).body.hotelBookingId;
    await ranges(r._id,[]).expect(409);
    await col('hotelbookings').updateOne({_id:oid(held)},{$set:{holdExpiresAt:new Date(Date.now()-1000)}});
    await col('roomavailabilities').updateOne({roomId:oid(r._id)},{$set:{'bookedRanges.0.holdExpiresAt':new Date(Date.now()-1000)}});
    await ranges(r._id,[]).expect(200);
  });
  it('protects confirmed stays, preserves booked prices and shows the real reference per day',async()=>{
    const r=await room();await open(r._id);const bid=(await hold(r._id).expect(201)).body.hotelBookingId;await confirm(bid);
    const booked=(await col('hotelbookings').findOne({_id:oid(bid)}))!;assert.ok(booked.bookingReference);
    await ranges(r._id,[]).expect(409);
    await f.http().patch('/api/hotels/'+hotelId+'/rooms/'+r._id).set('Cookie',mod.cookie).send({beds:3,pricePerNight:25000}).expect(200);
    assert.equal((await col('hotelbookings').findOne({_id:oid(bid)}))!.totalPrice,30000);
    const calendar=(await f.http().get('/api/hotels/'+hotelId+'/availability').set('Cookie',mod.cookie).query({from:date(9),to:date(14)}).expect(200)).body;
    const days=calendar.items[0].days;assert.equal(days[0].status,'AVAILABLE');assert.equal(days[1].status,'BOOKED');
    assert.equal(days[1].bookingReference,booked.bookingReference);assert.equal(days[1].bookingStatus,'CONFIRMED');assert.equal(days[4].status,'AVAILABLE');
  });
  it('serializes closing availability against a new hold',async()=>{
    const r=await room();await open(r._id);
    const [closed,held]=await Promise.all([ranges(r._id,[]),hold(r._id)]);
    assert.ok((closed.status===200&&held.status===409)||(closed.status===409&&held.status===201));
    const available=(await col('roomavailabilities').findOne({roomId:oid(r._id)}))!;
    if(held.status===201)assert.equal(available.bookableRanges.length,1);
    else assert.equal(await col('hotelbookings').countDocuments({status:'PENDING'}),0);
  });
  it('ignores expired holds immediately in search/calendar without waiting for a sweep',async()=>{
    const r=await room();await open(r._id);
    await col('roomavailabilities').updateOne({roomId:oid(r._id)},{$push:{bookedRanges:{startDate:date(10),endDate:date(13),status:'HELD',hotelBookingId:new Types.ObjectId(),holdExpiresAt:new Date(Date.now()-1000)}}} as any);
    assert.equal((await search().expect(200)).body.total,1);
    const calendar=(await f.http().get('/api/hotels/'+hotelId+'/availability').set('Cookie',mod.cookie).query({from:date(10),to:date(13)}).expect(200)).body;
    assert.ok(calendar.items[0].days.every((d:any)=>d.status==='AVAILABLE'));
    assert.equal((await col('roomavailabilities').findOne({roomId:oid(r._id)}))!.bookedRanges.length,1);
    await hold(r._id).expect(201);
  });
  it('lets the assigned moderator block dates after a hold expires',async()=>{
    const r=await room();await open(r._id);
    await col('roomavailabilities').updateOne({roomId:oid(r._id)},{$push:{bookedRanges:{startDate:date(10),endDate:date(13),status:'HELD',hotelBookingId:new Types.ObjectId(),holdExpiresAt:new Date(Date.now()-1000)}}} as any);
    await f.http().post('/api/hotels/'+hotelId+'/rooms/'+r._id+'/availability').set('Cookie',mod.cookie).send({startDate:date(10),endDate:date(13),reason:'Maintenance'}).expect(201);
    const stored=(await col('roomavailabilities').findOne({roomId:oid(r._id)}))!;
    assert.equal(stored.bookedRanges.length,0);assert.equal(stored.blockedRanges.length,1);
    await hold(r._id).expect(409);
  });
  it('supports country-only search and rating filters/sort through the shared visible-review reader',async()=>{
    const r=await room();await open(r._id);
    await col('reviews').insertMany([{hotelId:oid(hotelId),hotelBookingId:new Types.ObjectId(),userId:oid(user.userId),rating:4,isHidden:false},
      {hotelId:oid(hotelId),hotelBookingId:new Types.ObjectId(),userId:oid(user.userId),rating:5,isHidden:false},
      {hotelId:oid(hotelId),hotelBookingId:new Types.ObjectId(),userId:oid(user.userId),rating:1,isHidden:true}]);
    const result=(await search({minRating:4.5,sort:'RATING_DESC'}).expect(200)).body;assert.equal(result.total,1);assert.equal(result.items[0].averageRating,4.5);assert.equal(result.items[0].ratingCount,2);
    assert.equal((await search({minRating:4.6}).expect(200)).body.total,0);
    assert.equal((await f.http().get('/api/hotels/'+hotelId).expect(200)).body.averageRating,4.5);
    await search({countryCode:'ZZ'}).expect(400);await search({minRating:0}).expect(400);await search({minRating:6}).expect(400);
    await f.http().get('/api/hotels/search').query({checkIn:date(10),checkOut:date(13),guests:1}).expect(400);
  });
  it('excludes unrated hotels when a minimum rating is supplied',async()=>{
    const r=await room();await open(r._id);assert.equal((await search({minRating:1}).expect(200)).body.total,0);
    assert.equal((await search({sort:'RATING_DESC'}).expect(200)).body.items[0].averageRating,null);
  });
  it('returns ten rooms per page with type, beds and total stay price',async()=>{
    for(let i=0;i<12;i++){const r=await room({pricePerNight:10000+i});await open(r._id);}
    const query={checkIn:date(10),checkOut:date(13)};
    const first=(await f.http().get('/api/hotels/'+hotelId+'/rooms/available').query(query).expect(200)).body;
    assert.equal(first.items.length,10);assert.equal(first.total,12);assert.equal(first.pageSize,10);assert.equal(first.items[0].totalStayPrice,30000);assert.equal(first.items[0].type,'Deluxe');assert.equal(first.items[0].beds,2);assert.equal(first.items[0].currency,'USD');
    const second=(await f.http().get('/api/hotels/'+hotelId+'/rooms/available').query({...query,page:2}).expect(200)).body;assert.equal(second.items.length,2);
    const calendar=(await f.http().get('/api/hotels/'+hotelId+'/availability').set('Cookie',mod.cookie).query({from:date(10),to:date(13)}).expect(200)).body;assert.equal(calendar.items.length,10);assert.equal(calendar.total,12);
  });
  it('enforces assignment, role, origin and date-window validation for inventory configuration',async()=>{
    const r=await room(),other=await f.login('other-hotel-mod@example.com',UserRole.HOTEL_MODERATOR);
    await ranges(r._id,[],user.cookie).expect(403);await ranges(r._id,[],other.cookie).expect(403);
    await f.http().put('/api/hotels/'+hotelId+'/rooms/'+r._id+'/bookable-ranges').send({ranges:[]}).expect(401);
    await f.http().put('/api/hotels/'+hotelId+'/rooms/'+r._id+'/bookable-ranges').set('Cookie',mod.cookie).set('Origin','https://evil.example').send({ranges:[]}).expect(403);
    await f.http().get('/api/hotels/'+hotelId+'/availability').set('Cookie',mod.cookie).query({from:'2027-02-30',to:'2027-03-03'}).expect(400);
    await f.http().get('/api/hotels/'+hotelId+'/availability').set('Cookie',mod.cookie).query({from:'2027-01-01',to:'2029-01-01'}).expect(400);
  });
  it('documents metadata, bookable windows and paginated inventory responses in Swagger',async()=>{
    const doc=(await f.http().get('/api/docs-json').expect(200)).body;
    assert.ok(doc.paths['/api/hotels/{id}/rooms/{roomId}/bookable-ranges'].put);
    assert.ok(doc.components.schemas.CreateHotelDto.required.includes('starClass'));
    assert.ok(doc.components.schemas.CreateRoomDto.required.includes('beds'));
    assert.ok(doc.components.schemas.RoomAvailabilityPageDto.properties.items);
  });
});
