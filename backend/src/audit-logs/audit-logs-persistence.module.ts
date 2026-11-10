import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

/** Shared persistence only: Auth can record audits without importing guarded admin controllers. */
@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }])],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsPersistenceModule {}
