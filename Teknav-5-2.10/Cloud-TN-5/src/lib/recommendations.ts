import { db } from '@/lib/db';

/**
 * Recommendations Service for Cloud-TN-5 Project *
 * Personalized recommendations using simple cosine similarity
 */

const RECO_PREFIX = 'teknav:reco';
const CACHE_TTL = 1800; // 30 minutes

export interface RecommendationItem {
  articleId: string;
  slug: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface RecommendationsResponse {
  articles: RecommendationItem[];
  algorithm: 'cosine_similarity';
  personalized: boolean;
  cacheHit: boolean;
  totalCandidates: number;
  computedAt: Date;
}

/**
 * Get related articles for an article
 */
export async function getRelatedArticles(
  articleId: string,
  options: {
    workspaceId?: string;
    locale?: string;
    limit?: number;
    excludeIds?: string[];
    minScore?: number;
  } = {}
): Promise<RecommendationsResponse> {
  const cacheKey = `${RECO_PREFIX}:related:${articleId}:${JSON.stringify(options)}`;

  const limit = options.limit || 5;
  const minScore = options.minScore || 0.3;

  // Get article
  const article = await db.article.findUnique({
    where: { id: articleId },
  });
  if (!article) {
    return {
      articles: [],
      algorithm: 'cosine_similarity',
      personalized: false,
      cacheHit: false,
      totalCandidates: 0,
      computedAt: new Date(),
    };
  }

  // Get embedding
  const articleSettings = JSON.parse(article.settings);
  const embeddingData = articleSettings?.embedding as number[] | null;
  if (!embeddingData) {
    return {
      articles: [],
      algorithm: 'cosine_similarity',
      personalized: false,
      cacheHit: false,
      totalCandidates: 0,
      computedAt: new Date(),
    };
  }

  // Find candidates
  const candidates = await db.article.findMany({
    where: {
      status: 'published',
      id: {
        not: articleId,
        in: options.excludeIds || [],
      },
    },
    select: {
      id: true,
      slug: true,
      seoTitle: true,
      seoDescription: true,
      settings: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 100,
  });

  if (candidates.length === 0) {
    return {
      articles: [],
      algorithm: 'cosine_similarity',
      personalized: false,
      cacheHit: false,
      totalCandidates: 0,
      computedAt: new Date(),
    };
  }

  const vectorA = embeddingData;
  const ranked = candidates
    .map(candidate => {
      const candidateSettings = JSON.parse(candidate.settings || '{}');
      const vectorB = candidateSettings?.embedding as number[] | null;

      let score = 0;
      if (vectorB && vectorB.length === vectorA.length) {
        // Cosine similarity
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vectorA.length; i++) {
          dotProduct += vectorA[i] * vectorB[i];
          normA += vectorA[i] * vectorA[i];
          normB += vectorB[i] * vectorB[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        score = denominator === 0 ? 0 : dotProduct / denominator;
      }

      // Boost for recent articles
      if (score >= minScore) {
        // Recency boost
        const daysSincePublish = (Date.now() - new Date(candidate.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.max(0.1, 1 - daysSincePublish / 90);
        score *= 0.9 + 0.1 * recencyFactor;
      }

      return {
        articleId: candidate.id,
        slug: candidate.slug,
        title: candidate.seoTitle || candidate.slug,
        score: Math.round(score * 100) / 100,
        reasons: score >= 0.7
          ? ['Highly similar']
          : score >= 0.5
          ? ['Similar']
          : ['Content match'],
      };
    })
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ id, slug, title, score, reasons }) => ({
      articleId: id,
      slug,
      title,
      score,
      reasons,
    }));

  return {
    articles: ranked,
    algorithm: 'cosine_similarity',
    personalized: false,
    cacheHit: false,
    totalCandidates: candidates.length,
    computedAt: new Date(),
  };
}

/**
 * Get personalized recommendations for user
 */
export async function getRecommendations(
  options: {
    workspaceId: string;
    userId?: string;
  mode: 'for_you' | 'trending' | 'fresh';
  locale?: string;
    limit?: number;
  } = {
  const limit = options.limit || 10;
  const cacheKey = `${RECO_PREFIX}:user:${options.userId || 'anonymous'}:${options.mode}:${options.workspaceId}`;

  const mode = options.mode || 'for_you';

  if (mode === 'trending') {
    // Trending - most viewed in last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const candidates = await db.article.findMany({
      where: {
        status: 'published',
        createdAt: { gte: weekAgo },
        settings: {
          contains: 'embedding',
        },
      },
      select: {
        id: true,
        slug: true,
        seoTitle: true,
        settings: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    const ranked = candidates.map(article => ({
      articleId: article.id,
      slug: article.slug,
      title: article.seoTitle || article.slug,
      score: 100,
      reasons: ['Trending'],
    }));

    return {
      articles: ranked,
      algorithm: 'trending',
      personalized: false,
      cacheHit: false,
      totalCandidates: candidates.length,
      computedAt: new Date(),
    };
  }

  if (mode === 'fresh') {
    // Fresh - published in last 7 days
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const candidates = await db.article.findMany({
      where: {
        status: 'published',
        createdAt: { gte: weekAgo },
      },
      select: {
        id: true,
        slug: true,
        seoTitle: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    const ranked = candidates.map(article => ({
      articleId: article.id,
      slug: article.slug,
      title: article.seoTitle || article.slug,
      score: 100,
      reasons: ['Recently published'],
    }));

    return {
      articles: ranked,
      algorithm: 'fresh',
      personalized: false,
      cacheHit: false,
      totalCandidates: candidates.length,
      computedAt: new Date(),
    };
  }

  // For you - use similar articles
  const related = await getRelatedArticles(options.userId || 'default', options);
  return {
    ...related,
    algorithm: related.algorithm,
    personalized: !!options.userId,
    totalCandidates: related.totalCandidates,
  computedAt: new Date(),
  };
}

/**
 * Get next read recommendations after an article
 */
export async function getNextReadRecommendations(
  currentArticleId: string,
  options: {
    workspaceId: string;
    locale?: string;
    userId?: string;
    limit?: number;
  } = {}
): Promise<RecommendationsResponse> {
  const limit = options.limit || 5;

  // Get related articles
  const related = await getRelatedArticles(currentArticleId, {
    ...options,
    excludeIds: [currentArticleId],
    limit,
  });

  return related;
}
