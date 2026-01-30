import { Module } from '@nestjs/common';
import { OwnerHealthSecurityController } from './security-health.controller';
import { RedisModule } from '../../redis/redis.module';
import { CsrfModule } from '../../security/csrf/csrf.module';
import { SecurityModule } from '../../security/security.module';

/**
 * Owner Health Module
 *
 * Provides health check endpoints for owner systems.
 */

@Module({
  imports: [RedisModule, CsrfModule, SecurityModule],
  controllers: [OwnerHealthSecurityController],
})
export class OwnerHealthModule {}
