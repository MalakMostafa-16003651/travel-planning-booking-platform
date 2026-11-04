import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ACCESS_TOKEN_COOKIE, PASSWORD_CHANGE_TOKEN_COOKIE } from './auth/auth.constants';

function validationException(errors: ValidationError[]): BadRequestException {
  const fields: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const unsafeSegments = new Set(['__proto__', 'prototype', 'constructor']);
  const collect = (nestedErrors: ValidationError[], parentPath = ''): void => {
    for (const error of nestedErrors) {
      if (
        typeof error.property !== 'string' || error.property.length === 0 ||
        error.property.split('.').some((segment) => unsafeSegments.has(segment))
      ) continue;

      const path = parentPath ? `${parentPath}.${error.property}` : error.property;
      const messages = Object.values(error.constraints ?? {})
        .filter((message) => typeof message === 'string' && message.trim().length > 0);
      if (messages.length > 0) {
        fields[path] = [...(fields[path] ?? []), ...messages];
      }
      // Array indices are child properties too; include only actual constraints,
      // not empty parent entries or ValidationError target/value information.
      collect(error.children ?? [], path);
    }
  };
  collect(errors);
  return new BadRequestException({ message: 'Validation failed', errors: fields });
}

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // Same-origin browser writes only; API tools without browser-origin headers still work.
  app.enableCsrfProtection();
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: validationException,
  }));
  app.useGlobalFilters(new ApiExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription('Milestone 1. Registration, login/lockout, logout/inactivity, ACC-07a temporary passwords, ACC-08 password changes, shared role guards and cookie/current-user controls. Flight booking integration depends on the provider/payment contracts.')
    .addCookieAuth(ACCESS_TOKEN_COOKIE, { type: 'apiKey', in: 'cookie' }, 'accessToken')
    .addCookieAuth(PASSWORD_CHANGE_TOKEN_COOKIE, { type: 'apiKey', in: 'cookie' }, 'passwordChangeToken')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
