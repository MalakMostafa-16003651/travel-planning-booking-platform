import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

function validationException(errors: ValidationError[]): BadRequestException {
  const fields: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const error of errors) {
    fields[error.property] = Object.values(error.constraints ?? {});
  }
  return new BadRequestException({ message: 'Validation failed', errors: fields });
}

export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api');
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
    .setDescription('Milestone 1. ACC-01: user registration.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
  });
}
