import { query } from '../db';

export interface ProductCatalogItem {
  id: string;
  name: string;
  pricePaise: number;
  stock: number;
  availableUnits: number;
}

export async function getProductsCatalog(): Promise<ProductCatalogItem[]> {
  const sql = `
    SELECT
      p.id,
      p.name,
      p.price_paise AS "pricePaise",
      p.stock,
      GREATEST(0, p.stock - COALESCE(
        (
          SELECT SUM(oi.quantity)::INTEGER
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE oi.product_id = p.id
            AND (
              (o.status = 'pending' AND o.expires_at > NOW())
              OR o.status = 'paid'
            )
        ), 0
      )) AS "availableUnits"
    FROM products p
    ORDER BY p.name ASC
  `;
  const result = await query<ProductCatalogItem>(sql);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    pricePaise: Number(row.pricePaise),
    stock: Number(row.stock),
    availableUnits: Number(row.availableUnits)
  }));
}
