import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pickup_counter',
  webhookSecret: process.env.WEBHOOK_SECRET || 'secret_pickup_counter_2026',
  orderHoldDurationSeconds: parseInt(process.env.ORDER_HOLD_DURATION_SECONDS || '120', 10)
};
