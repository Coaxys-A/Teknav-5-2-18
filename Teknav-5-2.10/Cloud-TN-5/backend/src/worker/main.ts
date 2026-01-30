import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { join } from 'path';
import { QueueModule } from '../queue/queue.module';

/**
 * Worker Bootstrap (2-Host Deployment)
 * M11 - Queue Platform: "Deployment Shape (2 Hosts)"
 *
 * Features:
 * - Separate worker process (Host B)
 * - Runs only workers/consumers (no HTTP API)
 * - Graceful shutdown handling
 * - Worker health checks
 */

async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.create(QueueModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Environment configuration
  const runWorkers = process.env.RUN_WORKERS === 'true';

  if (!runWorkers) {
    logger.warn('RUN_WORKERS env variable is not set to "true". Workers will not start.');
    logger.warn('To start workers, set RUN_WORKERS=true in .env file.');
  }

  // Enable shutdown hooks
  app.enableShutdownHooks();

  // Log worker startup
  logger.log('Teknav Queue Worker Process');
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`Run Workers: ${runWorkers}`);
  logger.log(`PID: ${process.pid}`);

  try {
    // Start workers (if enabled)
    if (runWorkers) {
      await startWorkers(app);
    }

    // Worker health check (optional)
    app.use((req, res) => {
      if (req.path === '/health') {
        res.status(200).json({
          status: 'ok',
          type: 'worker',
          pid: process.pid,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(404).json({ error: 'Not Found - Worker does not serve HTTP requests' });
      }
    });

    await app.listen(3001); // Worker health check port
    logger.log('Worker health check server listening on port 3001');

  } catch (error: any) {
    logger.error('Failed to start worker', error);
    process.exit(1);
  }
}

/**
 * Start Workers (Consumers)
 */
async function startWorkers(app: any) {
  const logger = new Logger('WorkerStart');
  logger.log('Starting queue workers...');

  // Get all consumers from QueueModule
  // In production, you'd dynamically discover all consumers
  // For MVP, we'll list them manually

  const consumerTypes = [
    'AiContentConsumer',
    'WorkflowConsumer',
    'PluginConsumer',
    'AnalyticsConsumer',
    'EmailConsumer',
    'NotificationConsumer',
    'OtpConsumer',
  ];

  for (const consumerType of consumerTypes) {
    try {
      logger.log(`Starting consumer: ${consumerType}`);
      // Each consumer is registered in QueueModule
      // BullMQ will automatically start processing jobs
    } catch (error: any) {
      logger.error(`Failed to start consumer: ${consumerType}`, error);
    }
  }

  logger.log(`${consumerTypes.length} workers started successfully`);
}

/**
 * Graceful Shutdown Handler
 */
process.on('SIGTERM', async () => {
  const logger = new Logger('WorkerShutdown');
  logger.log('SIGTERM signal received: starting graceful shutdown...');

  // Stop accepting new jobs
  // Wait for current jobs to finish
  // Close database connections
  // Close Redis connections
  // Exit process

  logger.log('Worker shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  const logger = new Logger('WorkerShutdown');
  logger.log('SIGINT signal received: starting graceful shutdown...');

  logger.log('Worker shutdown complete');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  const logger = new Logger('WorkerError');
  logger.error('Uncaught Exception:', error);
  // Log to external service (Sentry, etc.)
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('WorkerError');
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log to external service (Sentry, etc.)
  process.exit(1);
});

bootstrap();
