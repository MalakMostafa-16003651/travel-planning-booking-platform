
import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../airports/schemas/airport.schema';
import { FlightStatus } from '../common/enums/flight-status.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import {CabinInventory,} from './schemas/cabin-inventory.schema';
import { Flight } from './schemas/flight.schema';
import { localDateTimeToUtc } from './flight-time.util';

@Injectable()
export class FlightsService {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,

    @InjectModel(Flight.name)
    private readonly flights: Model<Flight>,

    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,

    @InjectModel(Airport.name)
    private readonly airports: Model<Airport>,

    @InjectModel(Airline.name)
    private readonly airlinesModel: Model<Airline>,

    private readonly airlines: AirlinesService,
  ) {}

  private objectId(
    id: string,
    label: string,
  ): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} not found`);
    }

    return new Types.ObjectId(id);
  }

  // FLT-03: Create a flight

  async createFlight(
    moderatorId: string,
    input: CreateFlightDto,
  ): Promise<unknown> {
    const airlineId =
      await this.airlines.getAssignedAirlineId(moderatorId);

    const airline =
      await this.airlinesModel.findById(airlineId).exec();

    if (!airline || !airline.isActive) {
      throw new ForbiddenException(
        'Your assigned airline is not active',
      );
    }

    if (
      input.departureAirportCode ===
      input.arrivalAirportCode
    ) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const [departureAirport, arrivalAirport] =
      await Promise.all([
        this.airports
          .findOne({ code: input.departureAirportCode })
          .exec(),

        this.airports
          .findOne({ code: input.arrivalAirportCode })
          .exec(),
      ]);

    if (!departureAirport || !arrivalAirport) {
      throw new BadRequestException(
        'Both airports must exist in the predefined airport catalog',
      );
    }

    const departureAt = localDateTimeToUtc(
      input.departureLocalDateTime,
      departureAirport.timeZone,
    );

    const arrivalAt = localDateTimeToUtc(
      input.arrivalLocalDateTime,
      arrivalAirport.timeZone,
    );

    if (arrivalAt <= departureAt) {
      throw new BadRequestException(
        'Arrival must be after departure when compared in UTC',
      );
    }

    if (departureAt <= new Date()) {
      throw new BadRequestException(
        'Departure must be in the future',
      );
    }

    const departureLocalDate =
      input.departureLocalDateTime.slice(0, 10);

    try {
      return await this.flights.create({
        airlineId,
        flightNumber: input.flightNumber,
        status: FlightStatus.SCHEDULED,
        departureAt,
        arrivalAt,
        departureAirportId: departureAirport._id,
        arrivalAirportId: arrivalAirport._id,
        departureLocalDate,
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'This airline already has this flight number on that departure date',
        );
      }

      throw error;
    }
  }

  // FLT-04: Create cabin inventory

 async createCabins(
  moderatorId: string,
  flightId: string,
  input: CreateCabinsDto,
): Promise<CabinInventory[]> {
  const flight = await this.getOwnedScheduledFlight(
    moderatorId,
    flightId,
  );

  const classes = input.cabins.map(
    (item) => item.cabinClass,
  );

  if (new Set(classes).size !== classes.length) {
    throw new BadRequestException(
      'Each cabin class may be defined only once per flight',
    );
  }

  const session = await this.connection.startSession();

  try {
    let createdCabins: CabinInventory[] = [];

    await session.withTransaction(async () => {
      createdCabins = await this.cabins.insertMany(
        input.cabins.map((item) => ({
          ...item,
          flightId: flight._id,
          bookedSeats: 0,
          heldSeats: 0,
        })),
        {
          session,
          ordered: true,
        },
      );
    });

    return createdCabins;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new ConflictException(
        'A cabin class already exists for this flight',
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
}
  // Helper: Verify flight ownership and status

  private async getOwnedScheduledFlight(
    moderatorId: string,
    flightId: string,
  ): Promise<Flight> {
    const airlineId =
      await this.airlines.getAssignedAirlineId(moderatorId);

    const flight = await this.flights
      .findOne({
        _id: this.objectId(flightId, 'Flight'),
        airlineId,
      })
      .exec();

    if (!flight) {
      throw new NotFoundException(
        'Flight not found for your airline',
      );
    }

    if (
      flight.status === FlightStatus.SCHEDULED &&
      flight.departureAt <= new Date()
    ) {
      await this.flights
        .updateOne(
          { _id: flight._id },
          { $set: { status: FlightStatus.DEPARTED } },
        )
        .exec();

      throw new ConflictException(
        'Only Scheduled flights can be edited or cancelled',
      );
    }

    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new ConflictException(
        'Only Scheduled flights can be edited or cancelled',
      );
    }

    return flight;
  }
}