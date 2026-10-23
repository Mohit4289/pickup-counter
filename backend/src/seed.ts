import { pool } from './db';

export async function seedProducts() {
  const products = [
    { name: 'Masala Potato Chips', price_paise: 4000, stock: 20 },
    { name: 'Cold Brew Coffee', price_paise: 7500, stock: 15 },
    { name: 'Dark Chocolate Bar', price_paise: 5000, stock: 10 },
    { name: 'Roasted Salted Peanuts', price_paise: 3000, stock: 25 },
    { name: 'Lemon Sparkling Water', price_paise: 6000, stock: 12 }
  ];

  for (const p of products) {
    await pool.query(
      `INSERT INTO products (name, price_paise, stock)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = $1)`,
      [p.name, p.price_paise, p.stock]
    );
  }
}

if (require.main === module) {
  seedProducts()
    .then(() => {
      console.log('Seeding completed successfully');
      return pool.end();
    })
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
