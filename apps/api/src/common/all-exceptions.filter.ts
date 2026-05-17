import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let error: string;
    // Phase Fortune (A5 bug fix): preserve `code` field when a controller
    // throws `new ForbiddenException({code, message})` or similar — the
    // frontend uses this to dispatch between specific error UIs
    // (SUBSCRIBER_ONLY paywall vs OUT_OF_WINDOW vs NO_PRIMARY_PROFILE).
    //
    // Side-effect (PR #46 review #6): this passthrough also fixes a
    // pre-existing bug in chat where `HttpException({code, message})`
    // patterns (`CONTEXT_VERSION_DRIFTED`, `SESSION_EXPIRED`,
    // `NEEDS_EXTENSION` thrown from `chat.service.ts`) were silently
    // dropped by this filter pre-PR-46. Frontend chat error-dispatch
    // logic (`useChatSession.ts:520`, `ChatDrawer.tsx:44`) now fires
    // correctly. Any new `HttpException` with a `.code` literal in any
    // controller will round-trip through this filter to the client.
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = exception.name;
      } else {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string) || exception.message;
        error = (resObj.error as string) || exception.name;
        if (typeof resObj.code === 'string') code = resObj.code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma known errors (unique constraint, not found, etc.)
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'A record with this value already exists';
          error = 'Conflict';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          error = 'Not Found';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = 'Database operation failed';
          error = 'Bad Request';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      error = 'Bad Request';
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';
    }

    // Log 500 errors with full stack trace
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      ...(code ? { code } : {}),
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
