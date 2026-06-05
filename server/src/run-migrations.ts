import 'dotenv/config';

import { Logger } from '@nestjs/common';

import { DatabaseService } from './database.service';

async function main() {
  const logger = new Logger('MigrationCLI');
  const databaseService = new DatabaseService();

  try {
    await databaseService.runMigrations();
    logger.log('Database migrations completed successfully');
  } finally {
    await databaseService.onApplicationShutdown();
  }
}

main().catch((error: unknown) => {
  const logger = new Logger('MigrationCLI');
  logger.error('Database migrations failed', error);
  process.exitCode = 1;
});
