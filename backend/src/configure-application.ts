import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import { STATUS_CODES } from 'node:http';
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
    .setDescription('Milestone 1 backend for the Travel Planning and Booking Platform (GIU Software Project I, Winter 2026). Accounts and administration, airlines/flights and flight bookings, hotels/rooms and hotel bookings with reviews, Stripe test-mode payments and refunds, itineraries with budgets and exchange rates, the blog, reports/moderation, notifications and audit logs. Each operation names the requirement IDs it implements. Authentication uses httpOnly cookies set by POST /api/auth/login; Swagger UI sends them automatically. Prices and amounts are integer minor units of USD (PAY-04). Lists are paginated with 10 items per page (GEN-05).')
    .addCookieAuth(ACCESS_TOKEN_COOKIE, { type: 'apiKey', in: 'cookie' }, 'accessToken')
    .addCookieAuth(PASSWORD_CHANGE_TOKEN_COOKIE, { type: 'apiKey', in: 'cookie' }, 'passwordChangeToken')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => {
    const document = SwaggerModule.createDocument(app, config);
    // The shared error DTO describes every error status. Give each response a
    // matching example instead of showing its 400 example under 401/403/etc.
    for (const path of Object.values(document.paths)) {
      for (const method of ['get', 'post', 'patch', 'put', 'delete', 'head', 'options'] as const) {
        for (const [status, response] of Object.entries(path[method]?.responses ?? {})) {
          if (!response || !('content' in response)) continue;
          const media = response.content?.['application/json'];
          if (!media?.schema || !('$ref' in media.schema) || media.schema.$ref !== '#/components/schemas/ApiErrorDto') continue;
          const statusCode = Number(status);
          if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) continue;
          media.example = {
            statusCode,
            error: STATUS_CODES[statusCode],
            message: statusCode === 400 ? 'Validation failed' : statusCode === 500 ? 'An unexpected error occurred' : STATUS_CODES[statusCode],
          };
        }
      }
    }
    return document;
  }, {
    jsonDocumentUrl: 'api/docs-json',
  });
}
