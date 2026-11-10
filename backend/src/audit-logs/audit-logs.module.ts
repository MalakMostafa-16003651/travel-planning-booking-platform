import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsPersistenceModule } from './audit-logs-persistence.module';

@Module({
  imports: [AuthModule, AuditLogsPersistenceModule],
  controllers: [AuditLogsController],
  // Keep existing consumers importing AuditLogsModule; the shared writer has one provider instance.
  exports: [AuditLogsPersistenceModule],
})
export class AuditLogsModule {}
