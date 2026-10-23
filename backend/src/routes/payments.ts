import { Router, Request, Response } from 'express';
import { verifyWebhookSignature, processPaymentWebhook } from '../services/paymentService';

export const paymentsRouter = Router();

paymentsRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.header('x-signature');
    const rawBody = (req as any).rawBody;

    if (!verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: 'INVALID_SIGNATURE', message: 'HMAC signature verification failed' });
      return;
    }

    const { eventId, orderId, amountPaise, status } = req.body;
    if (!eventId || typeof orderId !== 'string' || typeof amountPaise !== 'number' || !status) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Missing required webhook fields' });
      return;
    }

    const result = await processPaymentWebhook({ eventId, orderId, amountPaise, status });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});
