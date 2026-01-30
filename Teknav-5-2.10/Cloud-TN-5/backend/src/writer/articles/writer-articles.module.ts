import { Module } from '@nestjs/common';
import { WriterArticleService } from './articles/writer-articles.service';
import { WriterArticleController } from './articles/writer-articles.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PolicyModule } from '../../security/policy/policy.module';
import { AuditLogModule } from '../../logging/audit-log.module';

/**
 * Writer Article Module
 */

@Module({
  imports: [PrismaModule, PolicyModule, AuditLogModule],
  providers: [WriterArticleService, WriterArticleController],
  exports: [WriterArticleService, WriterArticleController],
})
export class WriterArticleModule {}
