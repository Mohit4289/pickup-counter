const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const DEFAULT_WEBHOOK_SECRET = 'secret_pickup_counter_2026';

export interface Product {
  id: string;
  name: string;
  pricePaise: number;
  stock: number;
  availableUnits: number;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  pricePaise: number;
}

export interface Order {
  id: string;
  totalPaise: number;
  status: 'pending' | 'paid' | 'expired' | 'needs_review' | 'picked_up';
  expiresAt: string;
  expiresInSeconds: number;
  items: OrderItem[];
  reviewReason?: string | null;
  createdAt: string;
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/products`);
  if (!res.ok) {
    throw new Error(`Failed to load catalog (${res.status})`);
  }
  return res.json();
}

export async function createOrder(items: Array<{ productId: string; quantity: number }>): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Failed to create order');
  }
  return data;
}

export async function fetchOrder(orderId: string): Promise<Order> {
  const res = await fetch(`${API_BASE}/orders/${orderId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch order (${res.status})`);
  }
  return res.json();
}

export async function claimPickup(orderId: string): Promise<{ success: boolean; status: string }> {
  const res = await fetch(`${API_BASE}/orders/${orderId}/pickup-claim`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Pickup claim failed');
  }
  return data;
}

async function computeHmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function simulatePaymentWebhook(
  orderId: string,
  amountPaise: number,
  status = 'captured',
  eventId = `evt_${Date.now()}`
): Promise<any> {
  const payload = {
    eventId,
    orderId,
    amountPaise,
    status
  };
  const rawBody = JSON.stringify(payload);
  const signature = await computeHmacSha256Hex(DEFAULT_WEBHOOK_SECRET, rawBody);

  const res = await fetch(`${API_BASE}/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': signature
    },
    body: rawBody
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Webhook failed');
  }
  return data;
}
