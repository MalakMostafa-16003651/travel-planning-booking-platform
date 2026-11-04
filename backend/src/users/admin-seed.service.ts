import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Model } from 'mongoose';
import { RegisterDto } from '../auth/dto/register.dto';
import { PasswordService } from '../auth/password.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from './schemas/user.schema';

// Setup-only provider: never register it in a public HTTP module.
@Injectable()
export class AdminSeedService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly passwords: PasswordService,
  ) {}

  async seed(input: unknown): Promise<void> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid seed input');
    const fields = plainToInstance(RegisterDto, input);
    const errors = await validate(fields, {
      whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false },
    });
    if (errors.length) throw new Error('Invalid seed input');
    await this.users.init();
    const existing = await this.users.findOne({ email: fields.email }).exec();
    if (existing) {
      if (existing.role !== UserRole.ADMIN) throw new Error('Account collision');
      return;
    }
    const passwordHash = await this.passwords.hash(fields.password);
    const now = new Date();
    // Email-only lookup plus setOnInsert never promotes or overwrites an account
    // created concurrently. The unique email index also protects racing seeds.
    const user = await this.users.findOneAndUpdate({ email: fields.email }, {
      $setOnInsert: {
        name: fields.name, email: fields.email, passwordHash,
        role: UserRole.ADMIN, status: AccountStatus.ACTIVE,
        termsAcceptedAt: now, createdAt: now, updatedAt: now,
      },
    }, { upsert: true, returnDocument: 'after', timestamps: false, runValidators: true }).exec();
    if (!user || user.role !== UserRole.ADMIN) throw new Error('Account collision');
  }
}
