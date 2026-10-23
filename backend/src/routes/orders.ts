import { Router, Request, Response } from 'express';
import {
  createOrder,
  getOrderById,
  claimPickup,
  InsufficientStockError,
  OrderNotFoundError,
  OrderConflictError,
  InvalidOrderStateError
} from '../services/orderService';

export const ordersRouter = Router();

ordersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const items = req.body ? (Array.isArray(req.body) ? req.body : req.body.items) : undefined;
    if (!items || !Array.isArray(items)) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Items array is required' });
      return;
    }

    const order = await createOrder(items);
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      res.status(400).json({
        error: 'INSUFFICIENT_STOCK',
        message: error.message,
        productName: error.productName,
        available: error.available,
        requested: error.requested
      });
      return;
    }
    res.status(400).json({ error: 'ORDER_CREATION_FAILED', message: (error as Error).message });
  }
});

ordersRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const order = await getOrderById(req.params.id);
    res.json(order);
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND', message: error.message });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});

ordersRouter.post('/:id/pickup-claim', async (req: Request, res: Response) => {
  try {
    const result = await claimPickup(req.params.id);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      res.status(404).json({ error: 'ORDER_NOT_FOUND', message: error.message });
      return;
    }
    if (error instanceof OrderConflictError) {
      res.status(409).json({ error: 'ORDER_ALREADY_CLAIMED', message: error.message });
      return;
    }
    if (error instanceof InvalidOrderStateError) {
      res.status(400).json({ error: 'INVALID_ORDER_STATE', message: error.message });
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});
