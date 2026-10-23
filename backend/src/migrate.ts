import { pool } from './db';

export async function runMigrations() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(255) NOT NULL,
      price_paise INTEGER NOT NULL CHECK (price_paise > 0),
      stock INTEGER NOT NULL CHECK (stock >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
      status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'needs_review', 'picked_up')),
      expires_at TIMESTAMPTZ NOT NULL,
      review_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      price_paise INTEGER NOT NULL CHECK (price_paise > 0)
    );

    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      event_id VARCHAR(255) PRIMARY KEY,
      order_id UUID,
      amount_paise INTEGER NOT NULL,
      status VARCHAR(50) NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status_expires ON orders(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed successfully');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
