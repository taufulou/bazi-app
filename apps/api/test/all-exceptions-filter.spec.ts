/**
 * Tests for AllExceptionsFilter — global exception handler.
 * Verifies correct HTTP status codes and response bodies for HttpException,
 * Prisma errors, and generic/unknown exceptions.
 */
import {
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

// ============================================================
// Mock helpers
// ============================================================

const createMockHost = (request: Record<string, unknown>, response: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  }) as any;

const createMockResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const createMockRequest = (method = 'GET', url = '/test') => ({
  method,
  url,
});

// ============================================================
// Tests
// ============================================================

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockRequest: ReturnType<typeof createMockRequest>;
  let mockResponse: ReturnType<typeof createMockResponse>;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AllExceptionsFilter();
    mockRequest = createMockRequest();
    mockResponse = createMockResponse();
  });

  it('should handle HttpException with string response', () => {
    const exception = new HttpException('Forbidden resource', HttpStatus.FORBIDDEN);

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Forbidden resource',
        error: 'HttpException',
        path: '/test',
      }),
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(String) }),
    );
  });

  it('should handle HttpException with object response', () => {
    const exception = new HttpException(
      { message: 'Validation failed', error: 'Bad Request' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        error: 'Bad Request',
        path: '/test',
      }),
    );
  });

  it('should handle NotFoundException (HttpException subclass) as 404', () => {
    const exception = new NotFoundException('User not found');

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'User not found',
        error: 'Not Found',
        path: '/test',
      }),
    );
  });

  it('should handle PrismaClientKnownRequestError P2002 as 409 Conflict', () => {
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.0.0' },
    );

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with this value already exists',
        error: 'Conflict',
        path: '/test',
      }),
    );
  });

  it('should handle PrismaClientKnownRequestError P2025 as 404 Not Found', () => {
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Record to update not found',
      { code: 'P2025', clientVersion: '5.0.0' },
    );

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Record not found',
        error: 'Not Found',
        path: '/test',
      }),
    );
  });

  it('should handle PrismaClientKnownRequestError with unknown code as 400 Bad Request', () => {
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: '5.0.0' },
    );

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Database operation failed',
        error: 'Bad Request',
        path: '/test',
      }),
    );
  });

  it('should handle PrismaClientValidationError as 400 Bad Request', () => {
    const exception = new Prisma.PrismaClientValidationError(
      'Invalid field value',
      { clientVersion: '5.0.0' },
    );

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data provided',
        error: 'Bad Request',
        path: '/test',
      }),
    );
  });

  it('should handle generic Error as 500 with sanitized message (no stack leak)', () => {
    const exception = new Error('Something broke internally');

    filter.catch(exception, createMockHost(mockRequest, mockResponse));

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/test',
      }),
    );

    // Verify the original error message and stack are NOT leaked in the response
    const jsonBody = mockResponse.json.mock.calls[0][0];
    expect(jsonBody.message).not.toContain('Something broke internally');
    expect(jsonBody).not.toHaveProperty('stack');
  });
});
