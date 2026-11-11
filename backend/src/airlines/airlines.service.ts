import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { UpdateAirlinePoliciesDto } from './dto/update-airline-policies.dto';
import { Airline } from './schemas/airline.schema';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { hasDefinedField } from '../common/validation/defined-fields';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(input: CreateAirlineDto, adminId: string): Promise<Airline> {
    return this.connection.transaction(async (session) => {
      let airline: Airline;
      try {
        [airline] = await this.airlines.create([{
          name: input.name.trim(), code: input.code, logo:null,
          isActive: true, baggagePolicy: { pricePerExtraBag: 1, maxExtraBagsPerPassenger: 0 }, cancellationTiers: [],
        }], { session });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new ConflictException('An airline with this code already exists');
        throw error;
      }
      await this.auditLogs.log({
        adminId,
        action: AuditAction.AIRLINE_CREATED,
        targetType: AuditTargetType.AIRLINE,
        targetId: airline._id.toString(),
      }, session);
      return airline;
    });
  }

  async getById(id: string): Promise<Airline> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Airline not found');
    const airline = await this.airlines.findById(id).exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return airline;
  }

  /** Contract adapter for Person 2: collection moderatorassignments, fields moderatorId/airlineId. */
  async getAssignedAirlineId(moderatorId: string): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(moderatorId)) throw new ForbiddenException('No airline assignment is configured');
    const assignments = await this.connection.collection('moderatorassignments').find({ moderatorId: new Types.ObjectId(moderatorId) }).limit(2).toArray();
    if (assignments.length !== 1 || !assignments[0].airlineId || !Types.ObjectId.isValid(String(assignments[0].airlineId))) {
      throw new ForbiddenException('Your account must have exactly one valid airline assignment');
    }
    return new Types.ObjectId(String(assignments[0].airlineId));
  }

  /**
   * The PDF's /api/airlines/:id moderator routes: :id must be the caller's own assigned airline. Another
   * airline is reported as not found, the same way flights hide another airline's flight.
   */
  async assertOwnAirline(moderatorId: string, airlineId: string): Promise<void> {
    const assigned = await this.getAssignedAirlineId(moderatorId);
    if (!Types.ObjectId.isValid(airlineId) || !assigned.equals(airlineId)) throw new NotFoundException('Airline not found for your assignment');
  }

  async getMine(moderatorId: string): Promise<Airline> {
    const id = await this.getAssignedAirlineId(moderatorId);
    const airline = await this.airlines.findById(id).exec();
    if (!airline) throw new NotFoundException('Assigned airline not found');
    return airline;
  }

  async updateMine(moderatorId: string, input: UpdateAirlineDto): Promise<Airline> {
    if (!hasDefinedField(input)) throw new BadRequestException('At least one airline profile field must be supplied');
    const id = await this.getAssignedAirlineId(moderatorId);
    try {
      const updated = await this.airlines.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).exec();
      if (!updated) throw new NotFoundException('Assigned airline not found');
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('An airline with this code already exists');
      throw error;
    }
  }

  async updatePoliciesMine(moderatorId: string, input: UpdateAirlinePoliciesDto): Promise<Airline> {
    if (!input.baggagePolicy && !input.cancellationTiers) throw new BadRequestException('Supply baggagePolicy, cancellationTiers, or both');
    if (input.cancellationTiers) {
      const thresholds = input.cancellationTiers.map((tier) => tier.daysBeforeDeparture);
      if (new Set(thresholds).size !== thresholds.length) throw new BadRequestException('Cancellation tier thresholds must be unique');
    }
    const id = await this.getAssignedAirlineId(moderatorId);
    const set: Record<string, unknown> = {};
    if (input.baggagePolicy) set.baggagePolicy = input.baggagePolicy;
    if (input.cancellationTiers) set.cancellationTiers = [...input.cancellationTiers].sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture);
    const updated = await this.airlines.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).exec();
    if (!updated) throw new NotFoundException('Assigned airline not found');
    return updated;
  }
}
