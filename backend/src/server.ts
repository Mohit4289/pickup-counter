import { app } from './app';
import { config } from './config';
import { runMigrations } from './migrate';
import { seedProducts } from './seed';

async function bootstrap() {
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await runMigrations();
      await seedProducts();
      app.listen(config.port, () => {
        console.log(`Server running on http://localhost:${config.port}`);
      });
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error('Failed to start server:', error);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

bootstrap();
