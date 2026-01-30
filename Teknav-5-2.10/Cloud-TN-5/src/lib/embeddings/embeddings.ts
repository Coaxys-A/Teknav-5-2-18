import { db } from '@/lib/db';

/**
 * Simple Embeddings Service for Cloud-TN-5 Project
 *
 * Deterministic embeddings without external dependencies using feature hashing
 */

const VECTOR_DIMS = 512;

/**
 * Generate embedding from text using feature hashing
 */
export function generateEmbedding(text: string, options: {
  title?: string;
  description?: string;
} = {}): number[] {
  const segments: number[] = [];

  if (options.title) {
    segments.push(...encodeText(options.title, 3));
  }

  if (options.description) {
    segments.push(...encodeText(options.description, 2));
  }

  if (text) {
    segments.push(...encodeText(text, 1));
  }

  const vector = new Array(VECTOR_DIMS).fill(0);

  for (const segment of segments) {
    const hash = hashString(segment.text);
    const index = hash % VECTOR_DIMS;
    vector[index] += segment.weight;
  }

  return normalizeVector(vector);
}

/**
 * Encode text to numeric segments
 */
function encodeText(text: string, weight: number): Array<{ text: string; weight: number }> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(/[\s\p{P}\p{S}]+/u);

  return tokens.map(token => ({
    text: token,
    weight,
  }));
}

/**
 * Hash string to integer
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

/**
 * Normalize vector to unit length
 */
function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map(v => v / norm);
}

/**
 * Compute cosine similarity
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Generate embedding for article
 */
export async function generateArticleEmbedding(params: {
  articleId: string;
  title: string;
  content: string;
  workspaceId?: string;
}): Promise<void> {
  const embedding = generateEmbedding(params.content, { title: params.title });
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

  const vectorData = JSON.stringify(embedding);
  const normData = norm.toString();

  // In a real app, this would be stored in RecommendationVector model
  console.log('Generated embedding for article:', params.title, {
    dims: VECTOR_DIMS,
    norm: normData,
  vectorPreview: embedding.slice(0, 10).map(v => v.toFixed(4)),
  });
}

/**
 * Get embedding for article (simplified - would use JSON stored in Article.settings)
 */
export async function getArticleEmbedding(articleId: string): Promise<number[] | null> {
  const article = await db.article.findUnique({
    where: { id: articleId },
    select: { settings: true },
  });

  if (!article || !article.settings) {
    return null;
  }

  try {
    const metadata = JSON.parse(article.settings);
    const vector = metadata.embedding;

    if (!vector || !Array.isArray(vector)) {
      return null;
    }

    return vector as number[];
  } catch {
    return null;
  }
}

/**
 * Store embedding in article settings (since we don't have RecommendationVector model)
 */
export async function storeArticleEmbedding(params: {
  articleId: string;
  title: string;
  content: string;
  workspaceId?: string;
}): Promise<void> {
  const embedding = generateEmbedding(params.content, { title: params.title });
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

  const article = await db.article.findUnique({
    where: { id: articleId },
  });

  if (!article) {
    return;
  }

  const settings = {
    embedding,
    dims: VECTOR_DIMS,
    norm: norm.toString(),
  algorithm: 'local-v1',
    sourceHash: Date.now().toString(),
  };

  await db.article.update({
    where: { id: params.articleId },
    data: { settings: JSON.stringify(settings) },
  });
}
