import { Router, Request, Response } from 'express';
import { getProductsCatalog } from '../services/catalogService';

export const productsRouter = Router();

productsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const products = await getProductsCatalog();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (error as Error).message });
  }
});
