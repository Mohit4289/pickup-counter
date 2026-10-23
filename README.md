# Pickup Counter

Self-service snack counter application built with Node.js (TypeScript + Express), PostgreSQL, and React (Vite).

## Getting Started

### Start with Docker Compose (Single Command)

```bash
docker compose up --build
```

- Customer Screen: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:4000](http://localhost:4000)

### Running Automated Tests (Real PostgreSQL)

Ensure PostgreSQL is running (e.g., via `docker compose up postgres -d`), then run:

```bash
npm run test
```

Or from the backend folder:

```bash
cd backend
npm install
npm test
```

### Sending Signed Payment Webhook

Run the CLI script to sign and send an HMAC-SHA256 authenticated webhook:

```bash
npm run send-webhook -- <orderId> [amountPaise] [status]
```

Example:

```bash
npm run send-webhook -- 2043ca20-7561-4696-857c-c76dfc6fe5a0
```

---

## Architectural Decisions

### 1. Integer Money in Whole Paise
All monetary amounts (`price_paise`, `total_paise`, `amountPaise`) are stored and calculated as integers. Rupee values are derived on the frontend solely for display (`paise / 100`).

### 2. Concurrency and Stock Reservation
To prevent overselling and race conditions:
- Product rows are locked using `SELECT ... FOR UPDATE` sorted by product ID in ascending order to prevent deadlocks across concurrent transactions.
- Available stock is calculated dynamically:
  $$\text{availableUnits} = \text{stock} - \sum(\text{pending active holds}) - \sum(\text{paid uncollected orders})$$
- Holds last for 120 seconds. If unpaid after 120 seconds, the hold automatically expires without background batch jobs needed for catalog availability.

### 3. Late Payment Decision
**Question:** What happens when a valid payment arrives after the hold has expired and units may already be sold to someone else?

**Decision & Implementation:**
1. When a webhook arrives for an expired order, a transaction with row-level locks checks if the required stock is still available.
2. **If available:** Stock is re-reserved and the order is marked `paid` with note `LATE_PAYMENT_RECOVERED`. The customer collects their items seamlessly.
3. **If unavailable (sold or held by another customer):** The order is transitioned to `needs_review` with reason `LATE_PAYMENT_STOCK_EXHAUSTED`. This prevents overselling, alerts staff, and creates an audit record for automated refund.

### 4. Clock Skew Immunity on Customer Screen
The counter terminal clock may be several minutes out of sync with the server.
- The server computes `expiresInSeconds` relative to its own clock when serving the order.
- The React screen records `performance.now()` monotonically upon receiving the response.
- At each tick, remaining time is calculated as `expiresInSeconds - (performance.now() - syncTime) / 1000`. The client system time (`Date.now()`) is never used in the countdown.

### 5. Webhook Idempotency & Signature Verification
- Webhooks verify `X-Signature` via HMAC-SHA256 against raw request body using `crypto.timingSafeEqual`.
- Processed events are recorded in `processed_webhook_events(event_id)` inside the database transaction. Replayed events return HTTP 200 without duplicate execution.

### 6. Locker Pickup Claim
- Locker claims use `SELECT ... FOR UPDATE` on the order.
- The first claim transitions status to `picked_up` and decrements product inventory.
- Concurrent claim requests waiting on the lock receive `409 Conflict` (`ORDER_ALREADY_CLAIMED`).

---

## Assumptions
- Each product exists in a single self-service counter inventory.
- Locker operations use hardware controllers that invoke `POST /orders/:id/pickup-claim`.
- Payment provider re-delivery of webhooks uses the same `eventId`.

---

## What Would Be Done Next With More Time
1. Real-time push updates via Server-Sent Events (SSE) or WebSockets instead of polling.
2. Automated refund integration for orders marked `needs_review`.
3. Multi-counter / multi-locker location support with tenant partitioning.
4. Prometheus metrics for hold expiration rates and webhook latency.
