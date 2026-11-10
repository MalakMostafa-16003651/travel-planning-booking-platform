import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { UsersModule } from '../users/users.module';
import { AdminReportsController } from './admin-reports.controller';
import { ContentModerationService } from './content-moderation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

/** Person 2: GEN-09 reports and GEN-10 content moderation. */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    AuditLogsModule,
    // Person 8's exported hide/delete/exists operations for posts and comments.
    BlogModule,
    // Person 6's exported hide/delete/exists operations for hotel reviews.
    ReviewsModule,
    // Person 7's exported hide/delete/exists operations for public itineraries (PR #81).
    ItinerariesModule,
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, ContentModerationService],
})
export class ReportsModule {}
