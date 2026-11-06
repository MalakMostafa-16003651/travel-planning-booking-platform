import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-application';

async function bootstrap(): Promise<void> {
  // rawBody: the Stripe webhook (PAY-01) verifies its signature against the exact request bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  try {
    configureApplication(app);
    app.enableShutdownHooks();
    const port = app.get(ConfigService).getOrThrow<number>('PORT');
    await app.listen(port);
    Logger.log(`API ready at http://localhost:${port}/api/docs`, 'Bootstrap');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  Logger.error('Backend startup failed. Check environment configuration and database connectivity.', 'Bootstrap');
  process.exitCode = 1;
});
