

import {BadRequestException,ConflictException,ForbiddenException, Injectable,Logger,NotFoundException,OnModuleInit,ServiceUnavailableException,} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../airports/schemas/airport.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { FlightStatus } from '../common/enums/flight-status.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { Flight } from './schemas/flight.schema';
import { localDateTimeToUtc } from './flight-time.util';

@Injectable()
export class FlightsService implements OnModuleInit {
  private readonly logger = new Logger(FlightsService.name);
  constructor(
    @InjectModel(Flight.name)
    private readonly flights: Model<Flight>,

    @InjectModel(CabinInventory.name)
    private readonly cabins: Model<CabinInventory>,

    @InjectModel(Airport.name)
    private readonly airports: Model<Airport>,

    @InjectModel(Airline.name)
    private readonly airlinesModel: Model<Airline>,

    private readonly airlines: AirlinesService,

    private readonly bookings: FlightBookingsService,
  ) {}

async onModuleInit(): Promise<void> {
  // Both uniqueness constraints must exist before accepting writes.
  // In particular, create the cabin collection/index outside the transaction's first request.
  await Promise.all([this.flights.init(), this.cabins.init()]);
}

// Helper: Validate MongoDB ObjectId

  private objectId(
    id: string,
    label: string,
  ): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`${label} not found`);
    }

    return new Types.ObjectId(id);
  }

  // FLT-30: Update flights that have departed

  async markDeparted(): Promise<void> {
    await this.flights
      .updateMany(
        {
          status: FlightStatus.SCHEDULED,
          departureAt: { $lte: new Date() },
        },
        {
          $set: { status: FlightStatus.DEPARTED },
        },
      )
      .exec();
  }

  // FLT-03: Create flight

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

    try {
      // An ordered batch can still insert earlier rows before a duplicate fails.
      // The existing unique index resolves races; the transaction rolls the entire
      // request back, including those earlier rows, before reporting a conflict.
      return await this.cabins.db.transaction((session) => this.cabins.insertMany(
        input.cabins.map((item) => ({
          ...item,
          flightId: flight._id,
          bookedSeats: 0,
          heldSeats: 0,
        })),
        { ordered: true, session },
      ));
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'A cabin class already exists for this flight',
        );
      }

      throw error;
    }
  }

  // Helper: Get a flight owned by the moderator

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


  // FLT-05: Update flight schedule

  async updateFlight(
    moderatorId: string,
    flightId: string,
    input: UpdateFlightDto,
  ): Promise<Flight> {
    if (!Object.keys(input).length) {
      throw new BadRequestException(
        'Supply at least one time field',
      );
    }

    const flight = await this.getOwnedScheduledFlight(
      moderatorId,
      flightId,
    );

    const [departureAirport, arrivalAirport] =
      await Promise.all([
        this.airports
          .findById(flight.departureAirportId)
          .exec(),

        this.airports
          .findById(flight.arrivalAirportId)
          .exec(),
      ]);

    if (!departureAirport || !arrivalAirport) {
      throw new NotFoundException(
        'Flight airport reference is missing',
      );
    }

    const departureAt = input.departureLocalDateTime
      ? localDateTimeToUtc(
          input.departureLocalDateTime,
          departureAirport.timeZone,
        )
      : flight.departureAt;

    const arrivalAt = input.arrivalLocalDateTime
      ? localDateTimeToUtc(
          input.arrivalLocalDateTime,
          arrivalAirport.timeZone,
        )
      : flight.arrivalAt;

    if (arrivalAt <= departureAt) {
      throw new BadRequestException(
        'Arrival must be after departure when compared in UTC',
      );
    }

    if (departureAt <= new Date()) {
      throw new BadRequestException(
        'Departure must remain in the future',
      );
    }

    const changed =
      departureAt.getTime() !== flight.departureAt.getTime() ||
      arrivalAt.getTime() !== flight.arrivalAt.getTime();

    if (!changed) {
      return flight;
    }

    const updateFields: Partial<Flight> = {
      departureAt,
      arrivalAt,
    };

    if (input.departureLocalDateTime) {
      updateFields.departureLocalDate =
        input.departureLocalDateTime.slice(0, 10);
    }

    let updatedFlight: Flight | null;

    try {
      updatedFlight = await this.flights
        .findOneAndUpdate(
          {
            _id: flight._id,
            status: FlightStatus.SCHEDULED,
          },
          { $set: updateFields },
          { new: true, runValidators: true },
        )
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException(
          'This airline already has this flight number on that departure date',
        );
      }

      throw error;
    }

    if (!updatedFlight) {
      throw new ConflictException(
        'Flight is no longer available for editing',
      );
    }

    await this.bookings.syncFlightSchedule(
      flight._id.toString(),
      departureAt,
      arrivalAt,
    );

    const confirmedUserIds =
      await this.bookings.findConfirmedUserIdsForFlight(
        flight._id.toString(),
      );

    if (confirmedUserIds.length) {
      this.logger.warn(
        `Schedule-change notifications pending Person 2 GEN-01 integration for ${confirmedUserIds.length} users on flight ${flight._id.toString()}`,
      );
    }

    return updatedFlight;
  }

  // FLT-05: Update cabin inventory

  async updateCabin(
    moderatorId: string,
    flightId: string,
    cabinId: string,
    input: UpdateCabinDto,
  ): Promise<CabinInventory> {
    if (!Object.keys(input).length) {
      throw new BadRequestException(
        'Supply at least one cabin field',
      );
    }

    const flight = await this.getOwnedScheduledFlight(
      moderatorId,
      flightId,
    );

    const cabinObjectId = this.objectId(
      cabinId,
      'Cabin',
    );

    const cabin = await this.cabins
      .findOne({
        _id: cabinObjectId,
        flightId: flight._id,
      })
      .exec();

    if (!cabin) {
      throw new NotFoundException(
        'Cabin not found for this flight',
      );
    }

    if (input.totalSeats !== undefined) {
      const updated = await this.cabins
        .findOneAndUpdate(
          {
            _id: cabinObjectId,
            flightId: flight._id,
            $expr: {
              $gte: [
                input.totalSeats,
                {
                  $add: ['$bookedSeats', '$heldSeats'],
                },
              ],
            },
          },
          { $set: { ...input } },
          { new: true, runValidators: true },
        )
        .exec();

      if (!updated) {
        throw new ConflictException(
          'Seat count cannot be reduced below booked plus held seats',
        );
      }

      return updated;
    }

    const updated = await this.cabins
      .findOneAndUpdate(
        {
          _id: cabinObjectId,
          flightId: flight._id,
        },
        { $set: input },
        { new: true, runValidators: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Cabin not found');
    }

    return updated;
  }

  // FLT-06: Cancel flight

  async cancelFlight(
    moderatorId: string,
    flightId: string,
  ): Promise<{
    message: string;
    flightId: string;
    status: FlightStatus;
  }> {
    const airlineId =
      await this.airlines.getAssignedAirlineId(moderatorId);

    const id = this.objectId(flightId, 'Flight');

    const flight = await this.flights
      .findOne({
        _id: id,
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
        'Departed flights cannot be cancelled',
      );
    }

    if (flight.status === FlightStatus.DEPARTED) {
      throw new ConflictException(
        'Departed flights cannot be cancelled',
      );
    }

    if (flight.status !== FlightStatus.CANCELLED) {
      await this.flights
        .updateOne(
          {
            _id: flight._id,
            status: FlightStatus.SCHEDULED,
          },
          {
            $set: { status: FlightStatus.CANCELLED },
          },
        )
        .exec();
    }

    try {
      await this.bookings.cancelBookingsForFlight(
        flightId,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Flight is cancelled, but booking cleanup did not finish; retry this cancellation after the booking service is available',
      );
    }

    this.logger.warn(
      'Passenger cancellation notifications depend on Person 2 GEN-01 integration.',
    );

    return {
      message:
        'Flight cancelled. Booking cleanup was requested; payment refunds and notifications depend on their shared module integrations.',
      flightId,
      status: FlightStatus.CANCELLED,
    };
  }
}

