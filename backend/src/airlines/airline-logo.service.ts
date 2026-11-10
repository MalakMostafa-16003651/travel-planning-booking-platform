import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { detectImageExtension } from '../common/files/image-type';
import { AIRLINE_LOGO_MAX_BYTES, readAirlineLogo, writeAirlineLogo } from './airline-logo.storage';
import { AirlinesService } from './airlines.service';
import { Airline } from './schemas/airline.schema';

export interface UploadedLogo {
  buffer: Buffer;
  size: number;
}

/** FLT-01 / GEN-08: one JPG or PNG logo per airline, at most 5 MB, stored on the server and served by URL. */
@Injectable()
export class AirlineLogoService {
  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly airlinesService: AirlinesService,
  ) {}

  /** Public view: a deactivated airline is hidden (ACC-15). */
  async getPublic(id: string): Promise<Airline> {
    const airline = await this.airlinesService.getById(id);
    if (!airline.isActive) throw new NotFoundException('Airline not found');
    return airline;
  }

  async saveMine(moderatorId: string, file: UploadedLogo | undefined): Promise<Airline> {
    if (!file?.buffer?.length) throw new BadRequestException('Send the image in the "logo" form field');
    if (file.size > AIRLINE_LOGO_MAX_BYTES) throw new PayloadTooLargeException('The logo must be at most 5 MB');
    const extension = detectImageExtension(file.buffer);
    if (!extension) throw new BadRequestException('The logo must be a JPG or PNG image');
    const airlineId = await this.airlinesService.getAssignedAirlineId(moderatorId);
    await writeAirlineLogo(airlineId.toString(), extension, file.buffer);
    const updated = await this.airlines
      .findByIdAndUpdate(airlineId, { $set: { logo: `/api/airlines/${airlineId.toString()}/logo` } }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Assigned airline not found');
    return updated;
  }

  async read(id: string): Promise<{ data: Buffer; mimeType: string }> {
    const airline = await this.getPublic(id);
    const logo = await readAirlineLogo(airline._id.toString());
    if (!logo) throw new NotFoundException('This airline has no logo');
    return logo;
  }
}
