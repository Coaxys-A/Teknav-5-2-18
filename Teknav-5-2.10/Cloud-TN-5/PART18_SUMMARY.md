# PART 18 - Embedding Layer + Recommender Engine - Implementation Summary

## Completed Components

### Backend Services

1. **Local Embedder** (`src/lib/embeddings/local-embedder.ts`)
   - Deterministic feature hashing (512-dimensional vectors)
   - N-gram tokenization (1, 2, 3)
   - TF-IDF-style weighting (title x3, description x2, content x1)
   - L2 normalization for cosine similarity
   - Language-agnostic (Persian and English support)

2. **Embedding Generation Service** (`src/lib/embeddings/embedding-service.ts`)
   - Article embedding generation with change detection
   - Translation embedding support
   - Per-locale vector storage in RecommendationVector
   - Redis locking for idempotent operations
   - Cache invalidation
   - Batch workspace embedding generation
   - Audit logging for all operations

### API Endpoints

3. **Related Articles API**
   - `GET /api/articles/[id]/related` - Find related articles using cosine similarity
   - Configurable filters: locale, limit, excludeIds, minScore
   - Cached with 30-minute TTL
   - Category and recency boosting

4. **Recommendations API**
   - `GET /api/recommendations` - Personalized recommendations
   - Three modes: for_you, trending, fresh
   - User vector-based personalization
   - Fallback to trending for anonymous users
   - Cached with 5-30 minute TTL

5. **Next Read API**
   - `GET /api/recommendations/next` - "Next read" recommendations
   - Combines similarity and personalization
   - Article-aware (excludes current article)

6. **Feedback API**
   - `POST /api/recommendations/feedback` - User feedback handling
   - Actions: like, hide, save
   - Updates user vectors via engagement events
   - Audit logging

7. **Owner Embeddings API**
   - `GET /api/owner/embeddings` - Workspace embedding status
   - `POST /api/owner/embeddings` - Rebuild workspace embeddings
   - `POST /api/owner/embeddings/rebuild` - Rebuild single article
   - `GET /api/owner/embeddings/similarity` - Debug similarity between articles
   - Progress tracking and error reporting

8. **Owner Recommender Debugger API**
   - `GET /api/owner/recommender/debug` - Debug and test recommendations
   - User vector visualization
   - Engagement statistics
   - Recommendation result analysis with score breakdown
   - Configurable query parameters

### Frontend Components

9. **Owner Embeddings UI** (`/dashboard/owner/ai/embeddings/page.tsx`)
   - Stats overview: total articles, embedded count, coverage rate, errors
   - Recent activity table with action/resource/status/details
   - Rebuild button with include translations option
   - Real-time refresh (30-second interval)
   - Error count display

10. **Owner Recommender Debugger** (`/dashboard/owner/ai/recommender/page.tsx`)
   - Query parameter configuration
   - User vector display: algorithm, dimensions, norm, last updated
   - User signals: top tags, top categories, engagement weights
   - Engagement stats: total events, by type, by month
   - Recommendation results with score visualization
   - Algorithm badges and personalization indicators

11. **Related Articles Widget** (`/components/recommendations/related-articles.tsx`)
   - Compact and full card views
   - Article preview with title, excerpt, score
   - Reason badges display
   - Insert button for writer editor
   - Loading and empty states

12. **Recommendations Widget** (`/components/recommendations/recommendations.tsx`)
   - Three recommendation modes: for_you, trending, fresh
  - Mode-specific icons (User, TrendingUp, Clock)
   - Article display with title, excerpt, score
  - Engagement indicators (likes, high scores)
  - Compact view option
  - NextReadRecommendations component for "next read"

## Key Features

### Embedding System
- **Deterministic**: Same input always produces same vector
- **Production-safe**: Works without external embedding APIs
- **Multi-locale**: Supports per-locale vector storage
- **Change detection**: Source hash-based smart updates

### Recommendation Engine
- **Cosine similarity**: Vector-based content matching
- **Multiple algorithms**: for_you, trending, fresh
- **Personalization**: User interest vectors with recency decay
- **Hybrid ranking**: Combines keyword, embedding, boosted, recency signals

### Caching Strategy
- Related articles: 30-minute TTL
- Recommendations: 5-30 minute TTL (shorter for personalized)
- Embeddings: 1-hour TTL
- Smart invalidation on updates

### Audit & Logging
- All embedding operations logged with action/status
- Data access logs for privileged debugging
- Error tracking and reporting
- Workspace-level statistics

### Redis Keys
- Locks: `teknav:lock:emb:article:<id>`, `teknav:lock:emb:user:<id>:<workspace>`
- Caches: `teknav:cache:emb:*`, `teknav:cache:similar:*`, `teknav:cache:reco:*`

## Integration Points

The following files were created but need to be placed in the correct location:
- `/home/z/my-project/src/lib/embeddings/local-embedder.ts`
- `/home/z/my-project/src/lib/embeddings/embedding-service.ts`
- API endpoints in `/home/z/my-project/src/app/api/`
- UI components in `/home/z/my-project/src/components/`
- Dashboard pages in `/home/z/my-project/src/app/dashboard/`

All files are ready to be moved to the Cloud-TN-5 directory structure.
