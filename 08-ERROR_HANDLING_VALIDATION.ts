// src/common/filters/global-exception.filter.ts
/**
 * Global exception filter for consistent error responses
 * All exceptions are converted to standardized error format
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaClientValidationError, PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[];
  error: string;
  traceId?: string;
  details?: Record<string, any>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();
    const traceId = request.id || this.generateTraceId();

    let errorResponse: ErrorResponse;

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      errorResponse = {
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message:
          typeof exceptionResponse === 'object' &&
          (exceptionResponse as any).message
            ? (exceptionResponse as any).message
            : exception.message,
        error: HttpStatus[status],
        traceId,
        details:
          typeof exceptionResponse === 'object' &&
          (exceptionResponse as any).error
            ? { validation: (exceptionResponse as any).error }
            : undefined,
      };

      this.logger.warn(
        `HTTP Exception: ${status} - ${errorResponse.message} - ${traceId}`,
      );
    }

    // Handle Prisma validation errors
    else if (exception instanceof PrismaClientValidationError) {
      errorResponse = {
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'Invalid database query',
        error: 'VALIDATION_ERROR',
        traceId,
        details: {
          prismaError: exception.message,
        },
      };

      this.logger.error(
        `Prisma Validation Error: ${exception.message} - ${traceId}`,
        exception.stack,
      );
    }

    // Handle Prisma known request errors
    else if (exception instanceof PrismaClientKnownRequestError) {
      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      let message = 'Database operation failed';
      let error = 'DATABASE_ERROR';

      // Map common Prisma errors
      switch (exception.code) {
        case 'P2002': // Unique constraint violation
          statusCode = HttpStatus.CONFLICT;
          message = 'Record with this value already exists';
          error = 'UNIQUE_CONSTRAINT_VIOLATION';
          break;

        case 'P2025': // Record not found
          statusCode = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          error = 'NOT_FOUND';
          break;

        case 'P2003': // Foreign key constraint
          statusCode = HttpStatus.BAD_REQUEST;
          message = 'Invalid reference to related record';
          error = 'FOREIGN_KEY_CONSTRAINT';
          break;

        case 'P2014': // Required relation violation
          statusCode = HttpStatus.BAD_REQUEST;
          message = 'Operation failed due to dependent records';
          error = 'RELATION_VIOLATION';
          break;
      }

      errorResponse = {
        statusCode,
        timestamp: new Date().toISOString(),
        path: request.url,
        message,
        error,
        traceId,
        details: {
          code: exception.code,
          meta: exception.meta,
        },
      };

      this.logger.error(
        `Prisma Error ${exception.code}: ${message} - ${traceId}`,
        exception.meta,
      );
    }

    // Handle unhandled errors
    else {
      errorResponse = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
        message:
          exception instanceof Error
            ? exception.message
            : 'Internal server error',
        error: 'INTERNAL_SERVER_ERROR',
        traceId,
      };

      this.logger.error(
        `Unhandled Exception: ${errorResponse.message} - ${traceId}`,
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// src/common/pipes/validation.pipe.ts
/**
 * Global validation pipe
 * Validates and transforms incoming DTOs
 */
import { PipeTransform, Injectable, BadRequestException, ValidationError } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Injectable()
export class GlobalValidationPipe implements PipeTransform<any> {
  async transform(value: any, metadata: any) {
    if (!value) {
      throw new BadRequestException('Request body is required');
    }

    const object = plainToInstance(metadata.type, value);

    const errors = await validate(object, {
      skipMissingProperties: false,
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Reject unknown properties
      transform: true,
    });

    if (errors.length > 0) {
      const formattedErrors = this.formatValidationErrors(errors);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: formattedErrors,
      });
    }

    return object;
  }

  private formatValidationErrors(errors: ValidationError[]) {
    const formatted: Record<string, string[]> = {};

    errors.forEach((error) => {
      if (error.constraints) {
        formatted[error.property] = Object.values(error.constraints);
      }

      if (error.children && error.children.length > 0) {
        const childErrors = this.formatValidationErrors(error.children);
        formatted[error.property] = {
          ...formatted[error.property],
          ...childErrors,
        };
      }
    });

    return formatted;
  }
}

// src/common/exceptions/business.exception.ts
/**
 * Custom business exceptions for domain-specific errors
 */

export class BusinessException extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'BusinessException';
  }
}

export class ResourceNotFoundException extends BusinessException {
  constructor(resourceType: string, id?: string) {
    super(
      'RESOURCE_NOT_FOUND',
      `${resourceType}${id ? ` with id ${id}` : ''} not found`,
      404,
    );
  }
}

export class UnauthorizedException extends BusinessException {
  constructor(message = 'Unauthorized access') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenException extends BusinessException {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class ConflictException extends BusinessException {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class ValidationException extends BusinessException {
  constructor(message: string, details?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class StateTransitionException extends BusinessException {
  constructor(currentState: string, targetState: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Cannot transition from ${currentState} to ${targetState}`,
      400,
    );
  }
}

export class PaymentException extends BusinessException {
  constructor(message: string, details?: Record<string, any>) {
    super('PAYMENT_ERROR', message, 402, details);
  }
}

// src/common/exceptions/business-exception.filter.ts
/**
 * Filter for catching and formatting business exceptions
 */
import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessException } from './business.exception';

@Catch(BusinessException)
export class BusinessExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(BusinessExceptionFilter.name);

  catch(exception: BusinessException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    this.logger.warn(
      `Business Exception: ${exception.code} - ${exception.message}`,
    );

    response.status(exception.statusCode).json({
      statusCode: exception.statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: exception.message,
      error: exception.code,
      details: exception.details,
    });
  }
}

// src/common/interceptors/transform.interceptor.ts
/**
 * Transform response interceptor
 * Wraps all successful responses in consistent format
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  data?: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    return next.handle().pipe(
      map((data) => {
        const statusCode = response.statusCode || HttpStatus.OK;

        return {
          statusCode,
          timestamp: new Date().toISOString(),
          path: request.url,
          message: this.getStatusMessage(statusCode),
          data: data || null,
        };
      }),
    );
  }

  private getStatusMessage(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.OK:
        return 'OK';
      case HttpStatus.CREATED:
        return 'Created';
      case HttpStatus.ACCEPTED:
        return 'Accepted';
      case HttpStatus.NO_CONTENT:
        return 'No Content';
      default:
        return 'Success';
    }
  }
}

// src/common/interceptors/logging.interceptor.ts
/**
 * Logging interceptor
 * Logs all requests and responses for debugging
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user } = request;

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: (data) => {
          const elapsed = Date.now() - now;
          const status = context.switchToHttp().getResponse().statusCode;

          this.logger.debug(
            `[${method}] ${url} - ${status} - ${elapsed}ms` +
              (user ? ` - User: ${user.id}` : ''),
          );
        },
        error: (error) => {
          const elapsed = Date.now() - now;
          this.logger.error(
            `[${method}] ${url} - ERROR - ${elapsed}ms - ${error.message}` +
              (user ? ` - User: ${user.id}` : ''),
          );
        },
      }),
    );
  }
}

// Example app.module.ts setup with all filters and pipes:
/*

import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { BusinessExceptionFilter } from './common/exceptions/business-exception.filter';
import { GlobalValidationPipe } from './common/pipes/validation.pipe';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PermissionContextInterceptor } from './common/interceptors/permission-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  providers: [
    // Filters
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: BusinessExceptionFilter,
    },
    // Pipes
    {
      provide: APP_PIPE,
      useClass: GlobalValidationPipe,
    },
    // Interceptors (order matters - executed in reverse order)
    {
      provide: APP_INTERCEPTOR,
      useClass: PermissionContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}

*/
