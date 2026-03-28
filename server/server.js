// ═══════════════════════════════════════════
//   12 TRIBES — BACKEND SERVER v1.0
//   Node.js + Express + PostgreSQL + WebSocket
//   Broker-agnostic live trading architecture
// ═══════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';

import config from './config/index.js';
import { checkConnection, closePool } from './config/database.js';
import { logger } from './services/logger.js';
import { priceStream } from './websocket/priceStream.js';
import { apiLimiter } from './middleware/rateLimit.js';

// Routes
import authRoutes from './routes/auth.js';
import walletRoutes from './routes/wallet.js';
import tradingRoutes from './routes/trading.js';
import brokerRoutes from './routes/broker.js';
import marketRoutes from './routes/market.js';

// ═══════ EXPRESS APP ═══════
const app = express();
const httpServer = createServer(app);

// ─── Security ───
app.use(helmet({
  contentSecurityPolicy: false,    // Allow frontend to connect
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS ───
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ───
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Compression ───
app.use(compression());

// ─── Request logging ───
app.use(morgan(':method :url :status :response-time ms', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Rate limiting ───
app.use('/api/', apiLimiter);

// ═══════ API ROUTES ═══════
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/market', marketRoutes);

// ─── Health check ───
app.get('/api/health', async (req, res) => {
  const db = await checkConnection();
  const wsStatus = priceStream.getStatus();

  res.json({
    status: 'operational',
    version: '1.0.0',
    environment: config.env,
    uptime: Math.round(process.uptime()),
    database: db,
    priceStream: wsStatus,
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 ───
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ─── Error handler ───
app.use((err, req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: config.isDev ? err.message : 'Internal server error',
    ...(config.isDev && { stack: err.stack }),
  });
});

// ═══════ STARTUP SEQUENCE ═══════
async function startServer() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('   12 TRIBES — BACKEND SERVER');
  console.log('   AI-Powered Investment Platform');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // 1. Check database connection
  logger.info('Checking database connection...');
  const db = await checkConnection();
  if (db.connected) {
    logger.info(`✅ Database connected (${db.time})`);
  } else {
    logger.error(`❌ Database connection failed: ${db.error}`);
    logger.warn('Server will start but database operations will fail.');
    logger.warn('Run: node db/init.js to initialize the database');
  }

  // 2. Initialize WebSocket price stream
  logger.info('Initializing real-time price stream...');
  priceStream.init(httpServer);
  logger.info('✅ Price stream initialized');

  // 3. Start HTTP server
  httpServer.listen(config.port, () => {
    logger.info(`✅ Server listening on port ${config.port}`);
    logger.info(`   Environment: ${config.env}`);
    logger.info(`   Frontend URL: ${config.frontendUrl}`);
    logger.info(`   API: http://localhost:${config.port}/api`);
    logger.info(`   WebSocket: ws://localhost:${config.port}/ws/prices`);
    logger.info(`   Health: http://localhost:${config.port}/api/health`);

    // Broker status
    if (config.alpaca.paper.apiKey) {
      logger.info('   Alpaca: Paper trading keys configured');
    }
    if (config.alpaca.live.apiKey) {
      logger.info('   Alpaca: LIVE trading keys configured');
    }
    if (!config.alpaca.paper.apiKey && !config.alpaca.live.apiKey) {
      logger.warn('   Alpaca: No API keys — running in simulation mode');
    }

    console.log('');
    console.log('   Status: OPERATIONAL');
    console.log('   Awaiting connections.');
    console.log('');
    console.log('═══════════════════════════════════════════');
  });
}

// ═══════ GRACEFUL SHUTDOWN ═══════
async function shutdown(signal) {
  logger.info(`\n${signal} received. Initiating graceful shutdown...`);

  // 1. Stop accepting new connections
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });

  // 2. Shutdown price stream
  priceStream.shutdown();

  // 3. Close database pool
  await closePool();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

// Launch
startServer().catch(err => {
  logger.error('Server startup failed:', err);
  process.exit(1);
});
