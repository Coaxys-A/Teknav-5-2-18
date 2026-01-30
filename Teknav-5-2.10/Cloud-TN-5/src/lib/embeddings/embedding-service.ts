import { db } from '@/lib/db';
import { redis } from '@/lib/redis-client';
import { AuditLog } from '@prisma/client';

const EMBEDDING_LOCK_PREFIX = 'teknav:lock:emb';
const EMBEDDING_CACHE_PREFIX = 'teknav:cache:emb';

export interface ArticleEmbedding {
  articleId: string;
  locale: string;
  embedding: {
    dims: number;
    values: number[];
    algo: string;
    sourceHash: string;
    locale?: string;
    createdAt: string;
  };
  lastGeneratedAt: Date;
}

export interface TranslationEmbedding {
  articleId: string;
  localeCode: string;
  embedding: any;
  lastGeneratedAt: Date;
}

export class EmbeddingService {
  async generateArticleEmbedding(params: {
    articleId: string;
    title: string;
    excerpt?: string;
    content?: string;
    locale?: string;
    description?: string;
    workspaceId?: string;
    tenantId?: string;
    force?: boolean;
  }): Promise<ArticleEmbedding> {
    const lockKey = `${EMBEDDING_LOCK_PREFIX}:article:${params.articleId}`;

    const lockAcquired = await this.acquireLock(lockKey);
    if (!lockAcquired && !params.force) {
      throw new Error('Embedding generation already in progress');
    }

    try {
      if (!params.force) {
        const existing = await this.getArticleEmbedding(params.articleId);
        if (existing) {
          const currentHash = this.computeContentHash(params);
          const existingHash = existing.embedding.sourceHash;

          if (currentHash === existingHash) {
            return existing;
          }
        }
      }

      const embedding = {
        dims: 512,
        values: this.generateDeterministicVector(params),
        algo: 'local-v1',
        sourceHash: this.computeContentHash(params),
        locale: params.locale || 'default',
        createdAt: new Date().toISOString(),
      };

      const vectorData = {
        dims: embedding.dims,
        values: embedding.values,
        algo: embedding.algo,
        sourceHash: embedding.sourceHash,
        locale: params.locale || 'default',
        updatedAt: new Date().toISOString(),
      };

      await db.recommendationVector.upsert({
        where: { articleId: params.articleId },
        create: {
          articleId: params.articleId,
          vector: JSON.stringify({
            locales: {
              [params.locale || 'default']: vectorData,
            },
          }),
          dimension: embedding.dims,
          norm: this.computeNorm(embedding.values),
          localeCode: params.locale || 'default',
          workspaceId: params.workspaceId,
          tenantId: params.tenantId,
        },
        update: {
          vector: this.mergeLocaleVector(params.articleId, vectorData, params.locale),
          localeCode: params.locale || 'default',
          updatedAt: new Date(),
        },
      });

      await this.invalidateArticleCache(params.articleId);

      await this.logEmbeddingEvent({
        type: 'article',
        articleId: params.articleId,
        locale: params.locale,
        algo: embedding.algo,
        dims: embedding.dims,
        success: true,
      });

      return {
        articleId: params.articleId,
        locale: params.locale || 'default',
        embedding,
        lastGeneratedAt: new Date(),
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async generateTranslationEmbedding(params: {
    articleId: string;
    localeCode: string;
    title: string;
    excerpt?: string;
    content: string;
    description?: string;
    workspaceId?: string;
    tenantId?: string;
    force?: boolean;
  }): Promise<TranslationEmbedding> {
    const lockKey = `${EMBEDDING_LOCK_PREFIX}:translation:${params.articleId}:${params.localeCode}`;

    const lockAcquired = await this.acquireLock(lockKey);
    if (!lockAcquired && !params.force) {
      throw new Error('Embedding generation already in progress');
    }

    try {
      const embedding = {
        dims: 512,
        values: this.generateDeterministicVector(params),
        algo: 'local-v1',
        sourceHash: this.computeContentHash(params),
        locale: params.localeCode,
        createdAt: new Date().toISOString(),
      };

      const vectorData = {
        dims: embedding.dims,
        values: embedding.values,
        algo: embedding.algo,
        sourceHash: embedding.sourceHash,
        locale: params.localeCode,
        updatedAt: new Date().toISOString(),
      };

      await db.recommendationVector.upsert({
        where: { articleId: params.articleId },
        create: {
          articleId: params.articleId,
          vector: JSON.stringify({
            locales: {
              [params.localeCode]: vectorData,
            },
          }),
          dimension: embedding.dims,
          norm: this.computeNorm(embedding.values),
          localeCode: params.localeCode,
          workspaceId: params.workspaceId,
          tenantId: params.tenantId,
        },
        update: {
          vector: this.mergeLocaleVector(params.articleId, vectorData, params.localeCode),
          localeCode: params.localeCode,
          updatedAt: new Date(),
        },
      });

      await this.invalidateArticleCache(params.articleId);

      await this.logEmbeddingEvent({
        type: 'translation',
        articleId: params.articleId,
        locale: params.localeCode,
        algo: embedding.algo,
        dims: embedding.dims,
        success: true,
      });

      return {
        articleId: params.articleId,
        localeCode: params.localeCode,
        embedding,
        lastGeneratedAt: new Date(),
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async getArticleEmbedding(articleId: string, locale?: string): Promise<ArticleEmbedding | null> {
    const cacheKey = `${EMBEDDING_CACHE_PREFIX}:article:${articleId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      const targetLocale = locale || data.defaultLocale || 'default';
      const embeddingData = data.locales?.[targetLocale];

      if (embeddingData) {
        return {
          articleId,
          locale: targetLocale,
          embedding: embeddingData,
          lastGeneratedAt: new Date(data.lastGeneratedAt),
        };
      }
    }

    const vector = await db.recommendationVector.findUnique({
      where: { articleId },
    });

    if (!vector) {
      return null;
    }

    const vectorJson = JSON.parse(vector.vector);
    const targetLocale = locale || vector.localeCode || 'default';
    const embeddingData = vectorJson.locales?.[targetLocale];

    if (!embeddingData) {
      return null;
    }

    const result = {
      articleId,
      locale: targetLocale,
      embedding: embeddingData,
      lastGeneratedAt: vector.updatedAt,
    };

    await redis.set(cacheKey, JSON.stringify(result), 3600);

    return result;
  }

  async getArticleVector(articleId: string, locale?: string): Promise<number[] | null> {
    const embedding = await this.getArticleEmbedding(articleId, locale);
    return embedding?.embedding?.values || null;
  }

  async generateWorkspaceEmbeddings(params: {
    workspaceId: string;
    includeTranslations?: boolean;
    force?: boolean;
    onProgress?: (current: number, total: number) => void;
  }): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    const articles = await db.article.findMany({
      where: {
        workspaceId: params.workspaceId,
        status: 'published',
      },
      select: {
        id: true,
        slug: true,
        seoTitle: true,
        seoDescription: true,
        workspaceId: true,
        tenantId: true,
      },
    });

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];

      try {
        await this.generateArticleEmbedding({
          articleId: article.id,
          title: article.seoTitle || article.slug,
          excerpt: article.seoDescription,
          locale: 'default',
          workspaceId: article.workspaceId,
          tenantId: article.tenantId || undefined,
          force: params.force,
        });

        success++;
        params.onProgress?.(i + 1, articles.length);
      } catch (error: any) {
        failed++;
        errors.push(`${article.id} - ${error.message}`);
      }
    }

    return { success, failed, errors };
  }

  private async mergeLocaleVector(
    articleId: string,
    newVectorData: any,
    locale?: string
  ): Promise<string> {
    const existing = await db.recommendationVector.findUnique({
      where: { articleId },
    });

    if (!existing) {
      return JSON.stringify({
        locales: {
          [locale || 'default']: newVectorData,
        },
      });
    }

    const vectorJson = JSON.parse(existing.vector);
    vectorJson.locales = vectorJson.locales || {};
    vectorJson.locales[locale || 'default'] = newVectorData;

    return JSON.stringify(vectorJson);
  }

  private computeContentHash(params: {
    title: string;
    excerpt?: string;
    content?: string;
    description?: string;
  }): string {
    const content = JSON.stringify({
      title: params.title,
      excerpt: params.excerpt,
      content: params.content,
      description: params.description,
    });

    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private extractSourceHash(embedding: any): string {
    return embedding.sourceHash;
  }

  private computeNorm(values: number[]): number {
    return Math.sqrt(values.reduce((sum, val) => sum + val * val, 0));
  }

  private async acquireLock(key: string, ttl: number = 3600): Promise<boolean> {
    const acquired = await redis.setLock(key, ttl);
    return acquired;
  }

  private async releaseLock(key: string): Promise<void> {
    await redis.del(key);
  }

  private async invalidateArticleCache(articleId: string): Promise<void> {
    await redis.del(`${EMBEDDING_CACHE_PREFIX}:article:${articleId}`);
  }

  private async logEmbeddingEvent(params: {
    type: 'article' | 'translation';
    articleId: string;
    locale?: string;
    algo: string;
    dims: number;
    success: boolean;
    error?: string;
  }): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          action: `embeddings.${params.type}.${params.success ? 'success' : 'fail'}`,
          resource: 'Article',
          resourceId: params.articleId,
          payload: JSON.stringify({
            locale: params.locale,
            algo: params.algo,
            dims: params.dims,
            error: params.error,
          }),
          level: params.success ? 'info' : 'error',
        },
      });
    } catch (error) {
      console.error('Failed to log embedding event:', error);
    }
  }

  private generateDeterministicVector(params: any): number[] {
    const crypto = require('crypto');
    const VECTOR_DIMS = 512;

    const segments: Array<any> = [];
    if (params.title) {
      segments.push({ text: params.title, weight: 3.0 });
    }
    if (params.excerpt || params.description) {
      segments.push({ text: params.excerpt || params.description, weight: 2.0 });
    }
    if (params.content) {
      segments.push({ text: params.content, weight: 1.0 });
    }

    if (segments.length === 0) {
      return new Array(VECTOR_DIMS).fill(0);
    }

    const vector = new Array(VECTOR_DIMS).fill(0);

    for (const segment of segments) {
      const features = this.extractFeatures(segment.text);
      const normWeight = segment.weight / features.length;

      for (const feature of features) {
        const hash = this.hashFeature(feature);
        const index = hash % VECTOR_DIMS;
        const sign = hash < 0 ? -1 : 1;
        vector[index] += sign * normWeight;
      }
    }

    return this.normalizeVector(vector);
  }

  private extractFeatures(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return [];
    }

    const features: string[] = [];
    const ngrams = [1, 2, 3];

    for (const n of ngrams) {
      const words = this.tokenize(normalized);

      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(' ');
        features.push(ngram);
      }
    }

    return features;
  }

  private tokenize(text: string): string[] {
    return text.split(/[\s\p{P}\p{S}]+/u).filter(token => token.length >= 2);
  }

  private hashFeature(feature: string): number {
    const hash = crypto.createHash('sha256');
    hash.update(feature);
    const digest = hash.digest('hex');

    const num = BigInt('0x' + digest.substring(0, 16));
    const signedNum = num > 81985529216486895n ? -(~num + 1n) : num;

    return Number(signedNum);
  }

  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    if (norm === 0) {
      return vector;
    }

    return vector.map(val => val / norm);
  }
}

export const embeddingService = new EmbeddingService();
