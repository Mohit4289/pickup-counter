import request from 'supertest';
import { app } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
import { generateWebhookSignature } from '../src/services/paymentService';

describe('Concurrency and Core Invariants', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  test('Ten customers ordering the last two units at the same moment: exactly two units are held, and the other orders fail cleanly', async () => {
    const prodRes = await pool.query(
      `INSERT INTO products (name, price_paise, stock)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Limited Snack ${Date.now()}`, 2500, 2]
    );
    const productId = prodRes.rows[0].id;

    const orderRequests = Array.from({ length: 10 }).map(() =>
      request(app)
        .post('/orders')
        .send({ items: [{ productId, quantity: 1 }] })
    );

    const responses = await Promise.all(orderRequests);

    const successfulOrders = responses.filter((r) => r.status === 201);
    const failedOrders = responses.filter((r) => r.status === 400);

    expect(successfulOrders.length).toBe(2);
    expect(failedOrders.length).toBe(8);

    for (const failure of failedOrders) {
      expect(failure.body.error).toBe('INSUFFICIENT_STOCK');
    }

    const catalogRes = await request(app).get('/products');
    const catalogItem = catalogRes.body.find((p: any) => p.id === productId);
    expect(catalogItem.availableUnits).toBe(0);
    expect(catalogItem.stock).toBe(2);
  });

  test('The same webhook event sent twice: the order is processed once', async () => {
    const prodRes = await pool.query(
      `INSERT INTO products (name, price_paise, stock)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Webhook Test Snack ${Date.now()}`, 4500, 10]
    );
    const productId = prodRes.rows[0].id;

    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId, quantity: 1 }] });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id;

    const payload = {
      eventId: `evt_idempotent_${Date.now()}`,
      orderId,
      amountPaise: 4500,
      status: 'captured'
    };
    const rawBody = JSON.stringify(payload);
    const signature = generateWebhookSignature(rawBody);

    const firstCall = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(rawBody);

    expect(firstCall.status).toBe(200);
    expect(firstCall.body.status).toBe('paid');

    const secondCall = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(rawBody);

    expect(secondCall.status).toBe(200);
    expect(secondCall.body.status).toBe('already_processed');

    const eventRows = await pool.query(
      `SELECT * FROM processed_webhook_events WHERE event_id = $1`,
      [payload.eventId]
    );
    expect(eventRows.rowCount).toBe(1);

    const verifiedOrder = await request(app).get(`/orders/${orderId}`);
    expect(verifiedOrder.body.status).toBe('paid');
  });

  test('Two simultaneous pickup claims: exactly one succeeds and the other gets 409 Conflict', async () => {
    const prodRes = await pool.query(
      `INSERT INTO products (name, price_paise, stock)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Pickup Claim Snack ${Date.now()}`, 3000, 5]
    );
    const productId = prodRes.rows[0].id;

    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId, quantity: 1 }] });

    const orderId = orderRes.body.id;

    const payload = {
      eventId: `evt_claim_${Date.now()}`,
      orderId,
      amountPaise: 3000,
      status: 'captured'
    };
    const rawBody = JSON.stringify(payload);
    const signature = generateWebhookSignature(rawBody);

    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(rawBody);

    const [claimA, claimB] = await Promise.all([
      request(app).post(`/orders/${orderId}/pickup-claim`),
      request(app).post(`/orders/${orderId}/pickup-claim`)
    ]);

    const statuses = [claimA.status, claimB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const successfulClaim = claimA.status === 200 ? claimA : claimB;
    const conflictingClaim = claimA.status === 409 ? claimA : claimB;

    expect(successfulClaim.body.status).toBe('picked_up');
    expect(conflictingClaim.body.error).toBe('ORDER_ALREADY_CLAIMED');

    const updatedProduct = await pool.query(`SELECT stock FROM products WHERE id = $1`, [productId]);
    expect(Number(updatedProduct.rows[0].stock)).toBe(4);
  });

  test('Webhook rejects invalid signature with 401', async () => {
    const payload = {
      eventId: `evt_bad_sig_${Date.now()}`,
      orderId: '00000000-0000-0000-0000-000000000000',
      amountPaise: 1000,
      status: 'captured'
    };
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', 'invalid_hex_signature_deadbeef1234')
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_SIGNATURE');
  });

  test('Webhook marks order as needs_review if amount does not match', async () => {
    const prodRes = await pool.query(
      `INSERT INTO products (name, price_paise, stock)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`Mismatch Snack ${Date.now()}`, 5000, 5]
    );
    const productId = prodRes.rows[0].id;

    const orderRes = await request(app)
      .post('/orders')
      .send({ items: [{ productId, quantity: 1 }] });

    const orderId = orderRes.body.id;

    const payload = {
      eventId: `evt_mismatch_${Date.now()}`,
      orderId,
      amountPaise: 4000,
      status: 'captured'
    };
    const rawBody = JSON.stringify(payload);
    const signature = generateWebhookSignature(rawBody);

    const res = await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Signature', signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('needs_review');

    const orderAfter = await request(app).get(`/orders/${orderId}`);
    expect(orderAfter.body.status).toBe('needs_review');
  });

  test('Invalid UUID inputs return 404 cleanly without database crashes', async () => {
    const invalidIdRes = await request(app).get('/orders/non-uuid-identifier');
    expect(invalidIdRes.status).toBe(404);
    expect(invalidIdRes.body.error).toBe('ORDER_NOT_FOUND');

    const invalidClaimRes = await request(app).post('/orders/non-uuid-identifier/pickup-claim');
    expect(invalidClaimRes.status).toBe(404);
    expect(invalidClaimRes.body.error).toBe('ORDER_NOT_FOUND');
  });
});
