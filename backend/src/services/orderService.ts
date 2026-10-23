import { query, withTransaction } from '../db';
import { config } from '../config';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface OrderResponse {
  id: string;
  totalPaise: number;
  status: string;
  expiresAt: string;
  expiresInSeconds: number;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    pricePaise: number;
  }>;
  reviewReason?: string | null;
  createdAt: string;
}

export class InsufficientStockError extends Error {
  constructor(public readonly productName: string, public readonly available: number, public readonly requested: number) {
    super(`Insufficient stock for product '${productName}'. Available: ${available}, requested: ${requested}`);
    this.name = 'InsufficientStockError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Order with id '${id}' not found`);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderConflictError';
  }
}

export class InvalidOrderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrderStateError';
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isValidUuid = (val: string): boolean => typeof val === 'string' && UUID_REGEX.test(val);

export async function createOrder(rawItems: OrderItemInput[]): Promise<OrderResponse> {
  if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Order items must be a non-empty array');
  }

  const itemMap = new Map<string, number>();
  for (const item of rawItems) {
    if (!item.productId || !isValidUuid(item.productId) || typeof item.quantity !== 'number' || item.quantity <= 0) {
      throw new Error('Each item must have a valid productId UUID and quantity greater than 0');
    }
    const current = itemMap.get(item.productId) || 0;
    itemMap.set(item.productId, current + item.quantity);
  }

  const items = Array.from(itemMap.entries()).map(([productId, quantity]) => ({ productId, quantity }));
  const sortedProductIds = items.map((i) => i.productId).sort();

  return await withTransaction(async (client) => {
    const productsRes = await client.query(
      `SELECT id, name, price_paise, stock FROM products WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
      [sortedProductIds]
    );

    if (productsRes.rowCount !== sortedProductIds.length) {
      throw new Error('One or more selected products do not exist');
    }

    const productsById = new Map<string, { id: string; name: string; price_paise: number; stock: number }>();
    for (const p of productsRes.rows) {
      productsById.set(p.id, {
        id: p.id,
        name: p.name,
        price_paise: Number(p.price_paise),
        stock: Number(p.stock)
      });
    }

    let totalPaise = 0;
    const resolvedItems: Array<{ productId: string; productName: string; quantity: number; pricePaise: number }> = [];

    for (const item of items) {
      const prod = productsById.get(item.productId)!;
      const heldRes = await client.query(
        `SELECT COALESCE(SUM(oi.quantity), 0)::INTEGER as held
         FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.product_id = $1
           AND (
             (o.status = 'pending' AND o.expires_at > NOW())
             OR o.status = 'paid'
           )`,
        [item.productId]
      );

      const held = Number(heldRes.rows[0].held);
      const available = Math.max(0, prod.stock - held);

      if (available < item.quantity) {
        throw new InsufficientStockError(prod.name, available, item.quantity);
      }

      totalPaise += prod.price_paise * item.quantity;
      resolvedItems.push({
        productId: prod.id,
        productName: prod.name,
        quantity: item.quantity,
        pricePaise: prod.price_paise
      });
    }

    const orderRes = await client.query(
      `INSERT INTO orders (total_paise, status, expires_at)
       VALUES ($1, 'pending', NOW() + make_interval(secs => $2))
       RETURNING id, total_paise, status, expires_at, created_at,
                 GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW()))))::INTEGER AS "expiresInSeconds"`,
      [totalPaise, config.orderHoldDurationSeconds]
    );

    const createdOrder = orderRes.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_paise)
         VALUES ($1, $2, $3, $4)`,
        [createdOrder.id, item.productId, item.quantity, item.pricePaise]
      );
    }

    return {
      id: createdOrder.id,
      totalPaise: Number(createdOrder.total_paise),
      status: createdOrder.status,
      expiresAt: new Date(createdOrder.expires_at).toISOString(),
      expiresInSeconds: Number(createdOrder.expiresInSeconds),
      items: resolvedItems,
      reviewReason: null,
      createdAt: new Date(createdOrder.created_at).toISOString()
    };
  });
}

export async function getOrderById(id: string): Promise<OrderResponse> {
  if (!isValidUuid(id)) {
    throw new OrderNotFoundError(id);
  }

  const orderRes = await query(
    `SELECT id, total_paise, status, expires_at, review_reason, created_at,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW()))))::INTEGER AS "expiresInSeconds",
            (expires_at <= NOW()) AS is_past_expiry
     FROM orders
     WHERE id = $1`,
    [id]
  );

  if (orderRes.rowCount === 0) {
    throw new OrderNotFoundError(id);
  }

  const row = orderRes.rows[0];
  let effectiveStatus = row.status;

  if (row.status === 'pending' && row.is_past_expiry) {
    await query(`UPDATE orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [id]);
    effectiveStatus = 'expired';
  }

  const itemsRes = await query(
    `SELECT oi.product_id, p.name AS product_name, oi.quantity, oi.price_paise
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = $1
     ORDER BY p.name ASC`,
    [id]
  );

  return {
    id: row.id,
    totalPaise: Number(row.total_paise),
    status: effectiveStatus,
    expiresAt: new Date(row.expires_at).toISOString(),
    expiresInSeconds: effectiveStatus === 'pending' ? Number(row.expiresInSeconds) : 0,
    items: itemsRes.rows.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: Number(i.quantity),
      pricePaise: Number(i.price_paise)
    })),
    reviewReason: row.review_reason,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export async function claimPickup(orderId: string): Promise<{ success: boolean; orderId: string; status: string }> {
  if (!isValidUuid(orderId)) {
    throw new OrderNotFoundError(orderId);
  }

  return await withTransaction(async (client) => {
    const orderRes = await client.query(
      `SELECT id, status, total_paise, expires_at
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      throw new OrderNotFoundError(orderId);
    }

    const order = orderRes.rows[0];

    if (order.status === 'picked_up') {
      throw new OrderConflictError('Order has already been collected from locker');
    }

    if (order.status !== 'paid') {
      throw new InvalidOrderStateError(`Cannot claim order with status '${order.status}'`);
    }

    const itemsRes = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE products SET stock = stock - $1 WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    await client.query(
      `UPDATE orders SET status = 'picked_up', claimed_at = NOW() WHERE id = $1`,
      [orderId]
    );

    return {
      success: true,
      orderId,
      status: 'picked_up'
    };
  });
}
