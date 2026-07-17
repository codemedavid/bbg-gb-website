import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './lib/env.js';
import { ok } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { productsRouter } from './routes/products.js';
import { groupBuysRouter } from './routes/groupbuys.js';
import { ordersRouter } from './routes/orders.js';
import { coaRouter } from './routes/coa.js';
import { filesRouter } from './routes/files.js';
import { adminRouter } from './routes/admin.js';
import { notFound, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => ok(res, { status: 'ok', ts: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api', productsRouter);           // /api/products, /api/categories
  app.use('/api/groupbuys', groupBuysRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/coa', coaRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
