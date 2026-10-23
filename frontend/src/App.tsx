import React, { useEffect, useState, useRef } from 'react';
import {
  fetchProducts,
  createOrder,
  fetchOrder,
  claimPickup,
  simulatePaymentWebhook,
  Product,
  Order
} from './api';

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{ [productId: string]: number }>({});
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const syncRef = useRef<{ baseRemaining: number; syncPerfTime: number }>({
    baseRemaining: 0,
    syncPerfTime: 0
  });

  const loadCatalog = async () => {
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadCatalog();
    const interval = setInterval(loadCatalog, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!currentOrder || currentOrder.status !== 'pending') {
      return;
    }

    const timer = setInterval(() => {
      const elapsed = (performance.now() - syncRef.current.syncPerfTime) / 1000;
      const left = Math.max(0, Math.ceil(syncRef.current.baseRemaining - elapsed));
      setCountdown(left);
      if (left === 0 && currentOrder.status === 'pending') {
        fetchOrder(currentOrder.id)
          .then((updated) => setCurrentOrder(updated))
          .catch(() => {});
      }
    }, 250);

    return () => clearInterval(timer);
  }, [currentOrder?.id, currentOrder?.status]);

  useEffect(() => {
    if (!currentOrder || ['picked_up', 'expired'].includes(currentOrder.status)) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const updated = await fetchOrder(currentOrder.id);
        setCurrentOrder(updated);
        if (updated.status === 'pending') {
          syncRef.current = {
            baseRemaining: updated.expiresInSeconds,
            syncPerfTime: performance.now()
          };
        }
      } catch (err) {
        console.error(err);
      }
    }, 1500);

    return () => clearInterval(pollInterval);
  }, [currentOrder?.id, currentOrder?.status]);

  const updateCart = (productId: string, delta: number) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const currentQty = cart[productId] || 0;
    const newQty = currentQty + delta;

    if (newQty <= 0) {
      const nextCart = { ...cart };
      delete nextCart[productId];
      setCart(nextCart);
      return;
    }

    if (newQty > prod.availableUnits) {
      setError(`Cannot add more than ${prod.availableUnits} available units for ${prod.name}`);
      return;
    }

    setError(null);
    setCart({ ...cart, [productId]: newQty });
  };

  const handleCheckout = async () => {
    const items = Object.entries(cart).map(([productId, quantity]) => ({
      productId,
      quantity
    }));

    if (items.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const order = await createOrder(items);
      setCurrentOrder(order);
      syncRef.current = {
        baseRemaining: order.expiresInSeconds,
        syncPerfTime: performance.now()
      };
      setCountdown(order.expiresInSeconds);
      setCart({});
      await loadCatalog();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulatePayment = async () => {
    if (!currentOrder) return;
    setLoading(true);
    setError(null);
    try {
      await simulatePaymentWebhook(currentOrder.id, currentOrder.totalPaise);
      const updated = await fetchOrder(currentOrder.id);
      setCurrentOrder(updated);
      setInfoMessage('Payment captured via webhook');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePickupClaim = async () => {
    if (!currentOrder) return;
    setLoading(true);
    setError(null);
    try {
      await claimPickup(currentOrder.id);
      const updated = await fetchOrder(currentOrder.id);
      setCurrentOrder(updated);
      await loadCatalog();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const resetView = async () => {
    setCurrentOrder(null);
    setError(null);
    setInfoMessage(null);
    await loadCatalog();
  };

  const totalPaiseInCart = Object.entries(cart).reduce((sum, [pId, qty]) => {
    const item = products.find((p) => p.id === pId);
    return sum + (item ? item.pricePaise * qty : 0);
  }, 0);

  const totalItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  return (
    <div className="container">
      <header className="header">
        <h1>Self-Service Snack Counter</h1>
        {currentOrder && (
          <button className="btn-secondary" onClick={resetView}>
            Back to Menu
          </button>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {infoMessage && <div className="error-banner" style={{ background: '#dcfce7', borderColor: '#22c55e', color: '#15803d' }}>{infoMessage}</div>}

      {!currentOrder ? (
        <main>
          <div className="grid">
            {products.map((product) => {
              const qtyInCart = cart[product.id] || 0;
              const isOutOfStock = product.availableUnits <= 0;
              return (
                <div key={product.id} className="card">
                  <div>
                    <h3>{product.name}</h3>
                    <div className="price">₹{(product.pricePaise / 100).toFixed(2)}</div>
                    <div className={`stock-tag ${isOutOfStock ? 'stock-out' : ''}`}>
                      {product.availableUnits} units available (Stock: {product.stock})
                    </div>
                  </div>

                  <div className="card-actions">
                    <div className="qty-control">
                      <button
                        className="btn-secondary"
                        onClick={() => updateCart(product.id, -1)}
                        disabled={qtyInCart === 0}
                      >
                        -
                      </button>
                      <span>{qtyInCart}</span>
                      <button
                        className="btn-secondary"
                        onClick={() => updateCart(product.id, 1)}
                        disabled={qtyInCart >= product.availableUnits || isOutOfStock}
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => updateCart(product.id, 1)}
                      disabled={qtyInCart >= product.availableUnits || isOutOfStock}
                    >
                      {isOutOfStock ? 'Sold Out' : 'Add'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {totalItemsCount > 0 && (
            <div className="cart-bar">
              <div>
                <strong>{totalItemsCount} items</strong> | Total: ₹{(totalPaiseInCart / 100).toFixed(2)} ({totalPaiseInCart} paise)
              </div>
              <button className="btn-success" onClick={handleCheckout} disabled={loading}>
                {loading ? 'Holding stock...' : 'Place Order'}
              </button>
            </div>
          )}
        </main>
      ) : (
        <div className="order-screen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Order Details</h2>
            <span className={`badge badge-${currentOrder.status}`}>{currentOrder.status.replace('_', ' ')}</span>
          </div>

          <p style={{ marginTop: '8px', color: '#64748b', fontSize: '13px' }}>
            ID: {currentOrder.id}
          </p>

          <div className="order-items-list">
            {currentOrder.items.map((item, index) => (
              <div key={index} className="order-item-row">
                <span>{item.productName} × {item.quantity}</span>
                <span>₹{((item.pricePaise * item.quantity) / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="order-item-row" style={{ fontWeight: 700, marginTop: '8px' }}>
              <span>Total Amount</span>
              <span>₹{(currentOrder.totalPaise / 100).toFixed(2)} ({currentOrder.totalPaise} paise)</span>
            </div>
          </div>

          {currentOrder.status === 'pending' && (
            <div>
              <div className="timer-box">
                <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '4px' }}>
                  Hold expires in
                </div>
                <div className={`timer-digits ${countdown <= 15 ? 'timer-alert' : ''}`}>
                  {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  Measured monotonically from server hold
                </div>
              </div>

              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                <p>Scan UPI QR to Pay ₹{(currentOrder.totalPaise / 100).toFixed(2)}</p>
                <div style={{ margin: '16px auto', width: '160px', height: '160px', background: '#f1f5f9', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#64748b' }}>
                  [ UPI QR CODE ]
                </div>
              </div>

              <div className="dev-actions">
                <strong>Simulate Payment Webhook</strong>
                <button className="btn-success" onClick={handleSimulatePayment} disabled={loading}>
                  {loading ? 'Processing...' : 'Simulate UPI Payment (Instant Webhook)'}
                </button>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Or run via terminal:</span>
                <code>npm run send-webhook -- {currentOrder.id}</code>
              </div>
            </div>
          )}

          {currentOrder.status === 'paid' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>🎉</div>
              <h3>Payment Captured!</h3>
              <p style={{ color: '#64748b', margin: '12px 0 24px' }}>
                Your order is ready at Locker 04. Collect your snacks below.
              </p>
              <button className="btn-primary" style={{ padding: '12px 24px', fontSize: '16px' }} onClick={handlePickupClaim} disabled={loading}>
                {loading ? 'Opening...' : 'Unlock Locker 04 (Claim Pickup)'}
              </button>
            </div>
          )}

          {currentOrder.status === 'picked_up' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>✅</div>
              <h3>Locker Claimed & Collected</h3>
              <p style={{ color: '#64748b', margin: '12px 0 24px' }}>
                Stock has been permanently decremented. Enjoy your snacks!
              </p>
              <button className="btn-primary" onClick={resetView}>
                Order More Snacks
              </button>
            </div>
          )}

          {currentOrder.status === 'expired' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>⏰</div>
              <h3 style={{ color: '#dc2626' }}>Order Expired</h3>
              <p style={{ color: '#64748b', margin: '12px 0 24px' }}>
                The 120-second stock hold expired without payment. Units have been released.
              </p>
              <button className="btn-primary" onClick={resetView}>
                Return to Counter Menu
              </button>
            </div>
          )}

          {currentOrder.status === 'needs_review' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>⚠️</div>
              <h3 style={{ color: '#7c3aed' }}>Needs Staff Review</h3>
              <p style={{ color: '#64748b', margin: '12px 0' }}>
                {currentOrder.reviewReason || 'Payment anomaly detected.'}
              </p>
              <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '13px' }}>
                Please show your Order ID to the counter attendant.
              </p>
              <button className="btn-secondary" onClick={resetView}>
                Back to Menu
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
