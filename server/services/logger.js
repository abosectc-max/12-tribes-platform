// ═══════════════════════════════════════════
//   12 TRIBES — LOGGING SERVICE
//   Structured logging with Winston
// ═══════════════════════════════════════════

import winston from 'winston';
import config from '../config/index.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure log directory exists
try {
  mkdirSync(dirname(config.logging.file), { recursive: true });
} catch {}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}${stackStr}`;
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// Audit logger for trade/financial operations
export const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: config.logging.file.replace('.log', '.audit.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

export default logger;
