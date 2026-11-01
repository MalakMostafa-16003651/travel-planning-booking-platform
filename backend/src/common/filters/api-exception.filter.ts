import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (!(exception instanceof HttpException)) {
      // Never log request bodies, database messages, or credentials.
      this.logger.error('An unexpected request error occurred');
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
      return;
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const details = typeof payload === 'object' ? payload as Record<string, unknown> : {};
    response.status(statusCode).json({
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: typeof payload === 'string' ? payload : details.message ?? exception.message,
      ...(details.errors ? { errors: details.errors } : {}),
    });
  }
}
