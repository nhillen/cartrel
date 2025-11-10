import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../config';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Error:', err);

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.errors,
    });
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A record with this unique field already exists',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Record not found',
      });
    }
  }

  // Custom app errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  // Default server error
  const statusCode = 'statusCode' in err ? (err as any).statusCode : 500;
  res.status(statusCode).json({
    error: config.isProduction ? 'Internal Server Error' : err.message,
    ...(config.isDevelopment && { stack: err.stack }),
  });
}
