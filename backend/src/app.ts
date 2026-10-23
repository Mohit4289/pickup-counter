import express from 'express';
import cors from 'cors';
import { productsRouter } from './routes/products';
import { ordersRouter } from './routes/orders';
import { paymentsRouter } from './routes/payments';

export const app = express();

app.use(cors());

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/products', productsRouter);
app.use('/orders', ordersRouter);
app.use('/payments', paymentsRouter);
