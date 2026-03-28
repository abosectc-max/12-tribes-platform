// ═══════════════════════════════════════════
//   12 TRIBES — INPUT VALIDATION
//   Express-validator based request validation
// ═══════════════════════════════════════════

import { body, param, validationResult } from 'express-validator';

// Middleware to check validation results
export function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ─── Auth Validators ───
export const registerRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('firstName').trim().isLength({ min: 1, max: 100 }).withMessage('First name required'),
  body('lastName').trim().isLength({ min: 1, max: 100 }).withMessage('Last name required'),
];

export const loginRules = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 1 }).withMessage('Password required'),
];

// ─── Trade Validators ───
export const orderRules = [
  body('symbol').trim().isLength({ min: 1, max: 20 }).toUpperCase().withMessage('Symbol required'),
  body('side').isIn(['LONG', 'SHORT', 'BUY', 'SELL']).withMessage('Side must be LONG, SHORT, BUY, or SELL'),
  body('quantity').isFloat({ min: 0.00000001 }).withMessage('Quantity must be positive'),
  body('orderType').optional().isIn(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']),
  body('limitPrice').optional().isFloat({ min: 0 }),
  body('stopPrice').optional().isFloat({ min: 0 }),
  body('stopLoss').optional().isFloat({ min: 0 }),
  body('takeProfit').optional().isFloat({ min: 0 }),
  body('agent').optional().isIn(['Viper', 'Oracle', 'Spectre', 'Sentinel', 'Phoenix', 'Titan']),
];

export const closePositionRules = [
  param('positionId').isUUID().withMessage('Valid position ID required'),
];

// ─── Broker Validators ───
export const brokerConnectRules = [
  body('broker').isIn(['alpaca', 'ibkr', 'coinbase']).withMessage('Supported brokers: alpaca, ibkr, coinbase'),
];
