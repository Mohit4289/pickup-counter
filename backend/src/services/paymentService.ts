import crypto from 'crypto';
import { query, withTransaction } from '../db';
import { config } from '../config';

export interface WebhookPayload {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: string;
}

export function verifyWebhookSignature(rawBody?: Buffer | string, signatureHeader?: string): boolean {
  if (!signatureHeader || !rawBody) {
    return false;
  }

  const normalizedRaw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expectedSignature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(normalizedRaw)
    .digest('hex');

  const sigBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

export function generateWebhookSignature(rawBody: string | Buffer): string {
  const normalizedRaw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return crypto.createHmac('sha256', config.webhookSecret).update(normalizedRaw).digest('hex');
}

export async function processPaymentWebhook(payload: WebhookPayload): Promise<{
  status: string;
  orderId?: string;
  reason?: string;
}> {
  const { eventId, orderId, amountPaise, status } = payload;

  return await withTransaction(async (client) => {
    const existingEvent = await client.query(
      `SELECT event_id FROM processed_webhook_events WHERE event_id = $1`,
      [eventId]
    );

    if (existingEvent.rowCount && existingEvent.rowCount > 0) {
      return { status: 'already_processed', orderId };
    }

    const isValidUuid = typeof orderId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);

    if (!isValidUuid) {
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
         VALUES ($1, NULL, $2, $3)`,
        [eventId, amountPaise, status]
      );
      return { status: 'order_not_found', orderId };
    }

    const orderRes = await client.query(
      `SELECT id, total_paise, status, expires_at, (expires_at <= NOW()) AS is_past_expiry
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
         VALUES ($1, $2, $3, $4)`,
        [eventId, orderId || null, amountPaise, status]
      );
      return { status: 'order_not_found', orderId };
    }

    const order = orderRes.rows[0];

    if (status !== 'captured') {
      await client.query(
        `UPDATE orders SET status = 'needs_review', review_reason = $1 WHERE id = $2`,
        [`PAYMENT_NOT_CAPTURED_${status}`, orderId]
      );
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
         VALUES ($1, $2, $3, $4)`,
        [eventId, orderId, amountPaise, status]
      );
      return { status: 'needs_review', orderId, reason: 'PAYMENT_NOT_CAPTURED' };
    }

    if (Number(order.total_paise) !== Number(amountPaise)) {
      await client.query(
        `UPDATE orders SET status = 'needs_review', review_reason = $1 WHERE id = $2`,
        [`AMOUNT_MISMATCH_EXPECTED_${order.total_paise}_RECEIVED_${amountPaise}`, orderId]
      );
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
         VALUES ($1, $2, $3, $4)`,
        [eventId, orderId, amountPaise, status]
      );
      return { status: 'needs_review', orderId, reason: 'AMOUNT_MISMATCH' };
    }

    if (order.status === 'paid' || order.status === 'picked_up') {
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
         VALUES ($1, $2, $3, $4)`,
        [eventId, orderId, amountPaise, status]
      );
      return { status: order.status, orderId };
    }

    if (order.is_past_expiry || order.status === 'expired') {
      const orderItems = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId]
      );

      const productIds = orderItems.rows.map((r) => r.product_id).sort();
      await client.query(
        `SELECT id, stock FROM products WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
        [productIds]
      );

      let canFulfill = true;
      for (const item of orderItems.rows) {
        const checkRes = await client.query(
          `SELECT p.stock,
                  COALESCE((
                    SELECT SUM(oi.quantity)::INTEGER
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    WHERE oi.product_id = p.id
                      AND (
                        (o.status = 'pending' AND o.expires_at > NOW())
                        OR o.status = 'paid'
                      )
                  ), 0) AS held
           FROM products p
           WHERE p.id = $1`,
          [item.product_id]
        );

        const stock = Number(checkRes.rows[0].stock);
        const held = Number(checkRes.rows[0].held);
        const available = Math.max(0, stock - held);

        if (available < Number(item.quantity)) {
          canFulfill = false;
          break;
        }
      }

      if (canFulfill) {
        await client.query(
          `UPDATE orders SET status = 'paid', paid_at = NOW(), review_reason = 'LATE_PAYMENT_RECOVERED' WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
           VALUES ($1, $2, $3, $4)`,
          [eventId, orderId, amountPaise, status]
        );
        return { status: 'paid', orderId, reason: 'LATE_PAYMENT_RECOVERED' };
      } else {
        await client.query(
          `UPDATE orders SET status = 'needs_review', review_reason = 'LATE_PAYMENT_STOCK_EXHAUSTED' WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
           VALUES ($1, $2, $3, $4)`,
          [eventId, orderId, amountPaise, status]
        );
        return { status: 'needs_review', orderId, reason: 'LATE_PAYMENT_STOCK_EXHAUSTED' };
      }
    }

    await client.query(
      `UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = $1`,
      [orderId]
    );

    await client.query(
      `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, status)
       VALUES ($1, $2, $3, $4)`,
      [eventId, orderId, amountPaise, status]
    );

    return { status: 'paid', orderId };
  });
}
