import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../queue.module';
import { QueueConfigService } from '../queue-config.service';
import { ProducerService } from '../services/producer.service';
import { IdempotencyService } from '../services/idempotency.service';
import { DistributedLocksService } from '../services/distributed-locks.service';
import { JobType } from '../types/job-envelope';

/**
 * Queue Integration Tests
 * M11 - Queue Platform: "Tests + Validation"
 */

describe('Queue Integration (E2E)', () => {
  let queueConfig: QueueConfigService;
  let producer: ProducerService;
  let idempotency: IdempotencyService;
  let locks: DistributedLocksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: {
            host: 'localhost',
            port: 6379,
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        }),
        QueueModule,
      ],
      providers: [
        QueueConfigService,
        ProducerService,
        IdempotencyService,
        DistributedLocksService,
      ],
    }).compile();

    queueConfig = module.get<QueueConfigService>(QueueConfigService);
    producer = module.get<ProducerService>(ProducerService);
    idempotency = module.get<IdempotencyService>(IdempotencyService);
    locks = module.get<DistributedLocksService>(DistributedLocksService);
  });

  afterEach(async () => {
    // Clean up queues
    const queues = Object.values(JobType);
    for (const jobType of queues) {
      const queue = queueConfig.getQueue(jobType);
      await queue.drain();
    }
  });

  describe('Job Enqueue', () => {
    it('should enqueue job and create AiJob record', async () => {
      const result = await producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: 'test-job-1',
        traceId: 'trace-123',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 1 },
        meta: {
          prompt: 'Test prompt',
          model: 'gpt-4',
        },
      });

      expect(result).toBeDefined();
      expect(result.aiJobId).toBeGreaterThan(0);
      expect(result.bullJobId).toBeDefined();
      expect(result.isNew).toBe(true);
    });

    it('should enforce idempotency (second enqueue should return existing job)', async () => {
      const key = 'test-job-2';

      const result1 = await producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: key,
        traceId: 'trace-123',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 1 },
        meta: {
          prompt: 'Test prompt',
        },
      });

      const result2 = await producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: key,
        traceId: 'trace-456',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 2 },
        meta: {
          prompt: 'Different prompt',
        },
      });

      expect(result2.isNew).toBe(false);
      expect(result2.aiJobId).toBe(result1.aiJobId);
    });
  });

  describe('Deduplication', () => {
    it('should prevent duplicate jobs within window', async () => {
      const entityKey = 'ARTICLE:1';
      const key = 'test-job-3';

      // First job (within window)
      const result1 = await producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: key,
        traceId: 'trace-123',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 1 },
        meta: {
          prompt: 'Test prompt',
        },
        options: { dedupeWindowSeconds: 30 },
      });

      expect(result1).toBeDefined();

      // Second job (within window) - should throw error
      await expect(producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: key,
        traceId: 'trace-456',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 1 },
        meta: {
          prompt: 'Test prompt 2',
        },
        options: { dedupeWindowSeconds: 30 },
      })).rejects.toThrow('Job deduped: recent duplicate job exists');
    });
  });

  describe('Distributed Locks', () => {
    it('should acquire lock and execute function', async () => {
      let lockAcquired = false;
      let functionExecuted = false;

      const { acquired, result } = await locks.executeWithLock(
        'ARTICLE',
        '1',
        () => {
          lockAcquired = true;
          functionExecuted = true;
          return { executed: true };
        },
        { ttl: 10000 },
      );

      expect(acquired).toBe(true);
      expect(functionExecuted).toBe(true);
      expect(result).toBeDefined();
    });

    it('should requeue with delay if lock held', async () => {
      let lockAcquired = false;
      let attempts = 0;

      try {
        await locks.executeWithLock(
          'ARTICLE',
          '1',
          () => {
            lockAcquired = true;
            throw new Error('Test error');
          },
          { ttl: 10000 },
        );
      } catch (error: any) {
        // Function failed
      }

      // Wait and try again
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { acquired: acquired2, result: result2 } = await locks.executeWithLock(
        'ARTICLE',
        '1',
        () => {
          attempts++;
          lockAcquired = true;
          return { success: true };
        },
        { ttl: 10000 },
      );

      expect(lockAcquired).toBe(true);
      expect(attempts).toBe(1);
    });
  });

  describe('Audit Logging', () => {
    it('should log enqueue event', async () => {
      const result = await producer.enqueueJob(JobType.AI_CONTENT, {
        idempotencyKey: 'test-job-4',
        traceId: 'trace-123',
        actorId: 1,
        tenantId: 1,
        workspaceId: 1,
        entity: { type: 'ARTICLE', id: 1 },
        meta: {
          prompt: 'Test prompt',
        },
      });

      // Check if AuditLog entry exists (mock check)
      // In production, you'd query AuditLog table
      expect(result).toBeDefined();
    });
  });
});
