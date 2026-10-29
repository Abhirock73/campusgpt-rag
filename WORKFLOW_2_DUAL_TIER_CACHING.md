# ⚡ Workflow 2: Dual-Tier Caching (Exact + Semantic) & Invalidation Engine

> **CampusGPT / AskCampusAi Architectural Deep Dive**  
> Comprehensive technical documentation of the Dual-Tier Caching Engine, containing exact source file references, mathematical algorithms, key schemas, privacy guardrails, and future optimizations.

---

## 📑 Table of Contents
1. [Executive Summary & Objectives](#1-executive-summary--objectives)
2. [End-to-End Architecture & Flowchart](#2-end-to-end-architecture--flowchart)
3. [Tier 1: Exact Query Cache (Redis SHA-256)](#3-tier-1-exact-query-cache-redis-sha-256)
4. [Tier 2: Semantic Vector Cache (Cosine Similarity)](#4-tier-2-semantic-vector-cache-cosine-similarity)
5. [Cache Invalidation & Atomic Versioned Namespaces](#5-cache-invalidation--atomic-versioned-namespaces)
6. [Pipeline Integration in `ragService.js`](#6-pipeline-integration-in-ragservicejs)
7. [Code Navigation & File Map](#7-code-navigation--file-map)
8. [Identified Bottlenecks & Future Improvements](#8-identified-bottlenecks--future-improvements)

---

## 1. Executive Summary & Objectives

### The Problem
In an academic assistant serving thousands of university students:
* **Over 60% of daily queries are repetitive or semantically equivalent** (e.g., *"What is the minimum attendance required?"*, *"Minimum attendance percentage"*, *"How much attendance do I need to sit in exams?"*).
* Sending every recurring query through dense vector search (Qdrant), sparse keyword search (MongoDB), Reciprocal Rank Fusion, Claim-Level Evidence Assessment, and Google Gemini LLM generation incurs:
  * High latency (**1,200ms – 2,800ms** per query).
  * Rapid consumption of Google Gemini API token budgets.
  * Unnecessary database I/O and server CPU overhead.

### The Solution: Dual-Tier Caching
CampusGPT implements a **two-phase hierarchical cache**:
1. **Tier 1 (Exact Query Cache):** Sub-10ms lookup in Redis using canonical query normalization and SHA-256 hashing.
2. **Tier 2 (Semantic Vector Cache):** Sub-50ms lookup using 768-dimensional Gemini embeddings and Cosine Similarity thresholding ($\ge 0.88 - 0.92$) to answer paraphrased questions.
3. **Atomic Invalidation:** $O(1)$ version-namespaced invalidation that flushes stale data immediately upon administrative document uploads, web crawler runs, or syllabus updates without blocking Redis.

---

## 2. End-to-End Architecture & Flowchart

```mermaid
flowchart TD
    UserQuery([Student Query Inbound]) --> Normalizer[Normalize Query: Trim, Lowercase, Strip Terminal Punctuation]
    Normalizer --> Hasher[Compute Deterministic SHA-256 Hash]
    
    subgraph "Tier 1: Exact Query Cache (Redis)"
        Hasher --> ExactLookup{Redis GET rag:v{ver}:public:{hash}}
        ExactLookup -->|HIT < 10ms| ExactReturn[Return Cached Answer + Verified Sources]
    end

    subgraph "Tier 2: Semantic Vector Cache"
        ExactLookup -->|MISS| PrivacyFilter{Privacy Firewall: isSemanticCacheEligible?}
        PrivacyFilter -->|Disqualified: Personal Keywords Detected| FullRAG[Proceed to Full RAG Retrieval Pipeline]
        PrivacyFilter -->|Eligible: Public Query| EmbedQuery[Generate 768d Vector via text-embedding-004]
        EmbedQuery --> CosineScan[Scan Embeddings in rag:v{ver}:semantic:index]
        CosineScan --> SimCheck{Highest Cosine Similarity >= Threshold?}
        SimCheck -->|Score >= 0.88 - 0.92| SemanticReturn[Return Semantic Cache Hit with Similarity Badge]
    end

    subgraph "Full RAG Execution & Dual-Write Back"
        SimCheck -->|Score < Threshold| FullRAG
        FullRAG --> DenseBM25[Qdrant Dense + BM25 Lexical + RRF Rerank]
        DenseBM25 --> LLMGen[Gemini LLM Generation + Evidence Validation]
        LLMGen --> DualStore[Asynchronously Store in Both Tier 1 & Tier 2]
        DualStore --> FinalStream[Stream Response to Student]
    end

    ExactReturn --> Response([Client Terminal / Browser])
    SemanticReturn --> Response
    FinalStream --> Response
```

---

## 3. Tier 1: Exact Query Cache (Redis SHA-256)

### Purpose
To intercept identical or near-identical student questions with zero LLM API invocation and **$< 10\text{ms}$** round-trip time.

### Source Files:
* [`backend/src/services/cache/cacheKey.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheKey.js) — Normalization and SHA-256 hashing functions.
* [`backend/src/services/cache/exactQueryCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/exactQueryCache.js) — Lookup, storage, and metrics accounting.
* [`backend/src/services/cache/cacheService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheService.js) — Redis client abstraction with fail-safe error handling.
* [`backend/src/config/redis.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/config/redis.js) — Redis client initialization and mock fallback.

### Detailed Workflow:

#### Step 1: Query Normalization (`normalizeQuery`)
Raw user queries often vary by whitespace, capitalization, or question marks. The normalizer standardizes them deterministically:
```javascript
export const normalizeQuery = (query) => {
  if (!query || typeof query !== 'string') return '';
  return query
    .trim()
    .replace(/\s+/g, ' ')      // Collapse multiple spaces into one
    .toLowerCase()             // Case insensitivity
    .replace(/[?!.]+$/, '')    // Strip trailing punctuation
    .trim();
};
```
* **Example:**
  $$\text{"   What is the minimum attendance requirement???  "} \longrightarrow \text{"what is the minimum attendance requirement"}$$

#### Step 2: SHA-256 Cryptographic Hashing (`hashQuery`)
Generates a collision-resistant 64-character hexadecimal digest:
```javascript
export const hashQuery = (normalizedQuery) => {
  return crypto.createHash('sha256').update(normalizedQuery).digest('hex');
};
```

#### Step 3: Key Namespace Construction (`getExactCacheKey`)
Every key is namespaced by the **active cache version** and **user scope**:
* **Public Queries:** `rag:v{version}:public:{hash}`
* **Private / User-Scoped Queries:** `rag:v{version}:user:{userId}:{hash}`

```javascript
export const getExactCacheKey = ({ query, version = 1, userId = null, isPublic = true }) => {
  const normalized = normalizeQuery(query);
  const hash = hashQuery(normalized);
  const scopePrefix = isPublic || !userId ? 'public' : `user:${userId}`;
  const key = `rag:v${version}:${scopePrefix}:${hash}`;
  return { key, normalizedQuery: normalized, hash };
};
```

#### Step 4: Storage & TTL Policy
* **Payload Structure:**
  ```json
  {
    "answer": "As per NIT Kurukshetra B.Tech Academic Regulations...",
    "sources": [
      {
        "documentTitle": "B.Tech Academic Regulations 2023",
        "pageNumber": 14,
        "pageDisplay": "Page 14",
        "sourceUrl": "https://nitkkr.ac.in/academic-regulations.pdf"
      }
    ],
    "cachedAt": "2026-10-11T12:00:00.000Z",
    "version": 1,
    "query": "what is the minimum attendance requirement"
  }
  ```
* **TTL:** Configurable via `RAG_CACHE_TTL_SECONDS` (defaults to **3600 seconds / 1 hour**).
* **Metrics:** Atomic increments in Redis on `metrics:rag:exact_hits` and `metrics:rag:exact_misses`.

---

## 4. Tier 2: Semantic Vector Cache (Cosine Similarity)

### Purpose
When students ask the **same conceptual question using different wording**, Tier 1 misses. Tier 2 identifies the semantic equivalence without running vector database document search or invoking the LLM.

* **Example:**
  * Cached Query: *"what is the minimum attendance requirement"*
  * Inbound Query: *"how much attendance is mandatory for exams"*
  * Result: **Semantic Cache Hit** (Similarity: $0.9341 \ge 0.88$).

### Source Files:
* [`backend/src/services/cache/semanticCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/semanticCache.js) — Cosine similarity, index management, FIFO bounded eviction.
* [`backend/src/services/ai/embeddingService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/ai/embeddingService.js) — Google Gemini `text-embedding-004` (768 dimensions).
* [`backend/src/services/cache/cacheKey.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheKey.js) — Privacy firewall guard (`isSemanticCacheEligible`).

### Detailed Workflow:

#### Step 1: Privacy Firewall (`isSemanticCacheEligible`)
To prevent private student records from leaking across users, the semantic cache rejects queries with personal identifiers:
```javascript
const personalKeywords = [
  'my attendance', 'my grade', 'my grades', 'my fee', 'my fees',
  'my balance', 'my cgpa', 'my gpa', 'my marks', 'my transcript',
  'my roll', 'my result', 'my profile', 'my account', 'my password'
];
```
If any keyword matches or if `context.isPrivate === true`, Tier 2 is bypassed completely.

#### Step 2: Query Vector Embedding
The incoming query is embedded into a 768-dimensional float array using Google's `text-embedding-004`:
```javascript
const targetEmbedding = queryEmbedding || (await generateEmbedding(query));
```

#### Step 3: Cosine Similarity Scanning
Calculates the cosine similarity against all query embeddings stored in the active version index `rag:v{version}:semantic:index`:
$$\text{Cosine Similarity}(\mathbf{A}, \mathbf{B}) = \frac{\mathbf{A} \cdot \mathbf{B}}{\|\mathbf{A}\|_2 \|\mathbf{B}\|_2} = \frac{\sum_{i=1}^{768} A_i B_i}{\sqrt{\sum_{i=1}^{768} A_i^2} \sqrt{\sum_{i=1}^{768} B_i^2}}$$

Implementation in [`semanticCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/semanticCache.js#L16-L31):
```javascript
export const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};
```

#### Step 4: Similarity Threshold & Response Formatting
* **Threshold:** Controlled by `SEMANTIC_CACHE_THRESHOLD` (defaults to **`0.88`**, configurable up to **`0.92`**).
* If $\text{highestSim} \ge \text{threshold}$, the system returns:
  ```json
  {
    "answer": "...",
    "sources": [...],
    "cache": {
      "hit": true,
      "type": "semantic",
      "similarity": 0.9324,
      "threshold": 0.88,
      "matchedQuery": "what is the minimum attendance requirement"
    }
  }
  ```
* Increments `metrics:rag:semantic_hits`. If below threshold, increments `metrics:rag:semantic_misses`.

#### Step 5: Bounded Memory & FIFO Eviction
* Index capacity is governed by `SEMANTIC_CACHE_MAX_ENTRIES` (default: 100 entries).
* When a new unique query is added and the list reaches capacity, the oldest entry is removed (`entries.shift()`).
* Expired entries (`now > entry.expiresAt`) are cleaned up lazily on write.

---

## 5. Cache Invalidation & Atomic Versioned Namespaces

### The Invalidation Challenge
In RAG systems, document updates occur frequently (e.g., notice uploads, circular updates, syllabus adjustments). Traditional cache flushing via Redis `KEYS rag:*` and `DEL` creates severe problems:
* `KEYS` is an $O(N)$ operation that blocks the single-threaded Redis event loop.
* Race conditions can occur if queries arrive during key deletion.

### The Solution: Atomic Versioned Namespaces
Instead of deleting keys, CampusGPT maintains an atomic version integer stored at:
$$\texttt{rag:config:cache\_version}$$

1. **Version Resolution:** Every lookup reads `rag:config:cache_version` (e.g., version `1`).
2. **Atomic Increment:** When documents change or an admin clicks "Invalidate", the system calls `INCR rag:config:cache_version` ($v_1 \rightarrow v_2$).
3. **Instantaneous Invalidation:** All subsequent requests immediately query `rag:v2:...`.
4. **Natural Key Eviction:** Stale $v_1$ keys expire automatically via their built-in TTLs (`EX 3600`) without blocking memory or operations.

### Source Files:
* [`backend/src/services/cache/cacheInvalidation.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheInvalidation.js) — Version management service.
* [`backend/src/routes/adminRoutes.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/routes/adminRoutes.js) — Admin API endpoints.
* [`frontend/src/pages/AdminDashboard.jsx`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/frontend/src/pages/AdminDashboard.jsx) — Admin UI with cache metrics and manual invalidation.

### Automated Trigger Matrix:

| Event / Action | Source File | Exact Method Trigger |
|---|---|---|
| **Admin PDF Upload / Re-index** | [`backend/src/services/ingestion/ingestionService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/ingestion/ingestionService.js#L278) | `cacheInvalidation.incrementCacheVersion("Document Ingested: ...")` |
| **Document Deletion / Approval** | [`backend/src/controllers/documentController.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/controllers/documentController.js#L194) | `cacheInvalidation.incrementCacheVersion("Document Deleted: ...")` |
| **Admin Document Update** | [`backend/src/controllers/adminDocumentController.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/controllers/adminDocumentController.js#L512) | `cacheInvalidation.incrementCacheVersion("Document Updated: ...")` |
| **Web Crawler Ingestion** | [`backend/src/services/crawler/crawlerEngine.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/crawler/crawlerEngine.js#L267) | `cacheInvalidation.incrementCacheVersion("HTML Page Indexed: ...")` |
| **Academic Notice / Calendar Edit** | [`backend/src/services/events/academicEventService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/events/academicEventService.js#L149) | `cacheInvalidation.incrementCacheVersion("Academic Event: ...")` |
| **Course Catalog / Syllabus Edit** | [`backend/src/services/courses/courseService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/courses/courseService.js#L159) | `cacheInvalidation.incrementCacheVersion("Course Created/Updated: ...")` |
| **Manual Admin Dashboard Flush** | [`backend/src/routes/adminRoutes.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/routes/adminRoutes.js#L101) | `POST /api/admin/cache/invalidate` $\rightarrow$ `cacheInvalidation.invalidateRagCache()` |

---

## 6. Pipeline Integration in `ragService.js`

The central query coordinator is [`backend/src/services/rag/ragService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/rag/ragService.js).

### Step-by-Step Execution Sequence:

1. **Version Resolution (Line 197):**
   ```javascript
   const version = await cacheInvalidation.getCacheVersion();
   ```
2. **Tier 1 Lookup (Lines 202–233):**
   ```javascript
   const exactResult = await exactQueryCache.get({ query, user: options.user, version, isPublic });
   if (exactResult) {
     callbacks.onStatus?.('Found verified answer in campus records');
     callbacks.onSources?.(exactResult.sources || []);
     callbacks.onToken?.(exactResult.answer);
     return { answer: exactResult.answer, sources: exactResult.sources, cache: { hit: true, type: 'exact' } };
   }
   ```
3. **Tier 2 Lookup (Lines 238–265):**
   ```javascript
   if (!options.bypassCache && isSemanticCacheEligible(query, { isPrivate: !isPublic })) {
     const semanticResult = await semanticCache.findSimilar({ query, version, threshold: options.semanticThreshold });
     if (semanticResult) {
       callbacks.onStatus?.('Found verified answer in campus records');
       callbacks.onSources?.(semanticResult.sources || []);
       callbacks.onToken?.(semanticResult.answer);
       return { answer: semanticResult.answer, sources: semanticResult.sources, cache: { hit: true, type: 'semantic' } };
     }
   }
   ```
4. **Full RAG Pipeline (Lines 267–444):**
   * If both caches miss: Dense Vector Search (Qdrant) + BM25 Lexical Search (MongoDB) + Reciprocal Rank Fusion (RRF) + Claim-Level Evidence Assessor + Gemini LLM Generation.
5. **Dual-Write Storage (Lines 446–463):**
   ```javascript
   // Store in Tier 1 Exact Cache
   await exactQueryCache.set({ query, user: options.user, version, isPublic, response: cachePayload });

   // Store in Tier 2 Semantic Cache (if eligible)
   if (isSemanticCacheEligible(query, { isPrivate: !isPublic })) {
     await semanticCache.store({ query, response: cachePayload, version });
   }
   ```

---

## 7. Code Navigation & File Map

| Component | File Path | Key Functions / Classes |
|---|---|---|
| **Query Normalization & Hash** | [`backend/src/services/cache/cacheKey.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheKey.js) | `normalizeQuery()`, `hashQuery()`, `getExactCacheKey()`, `isSemanticCacheEligible()` |
| **Exact Query Cache** | [`backend/src/services/cache/exactQueryCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/exactQueryCache.js) | `ExactQueryCache.get()`, `ExactQueryCache.set()` |
| **Semantic Vector Cache** | [`backend/src/services/cache/semanticCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/semanticCache.js) | `cosineSimilarity()`, `SemanticCache.findSimilar()`, `SemanticCache.store()` |
| **Cache Invalidation** | [`backend/src/services/cache/cacheInvalidation.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheInvalidation.js) | `getCacheVersion()`, `incrementCacheVersion()`, `invalidateRagCache()` |
| **Redis Command Wrapper** | [`backend/src/services/cache/cacheService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/cacheService.js) | `get()`, `set()`, `delete()`, `increment()`, `getMetrics()` |
| **RAG Orchestrator** | [`backend/src/services/rag/ragService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/rag/ragService.js) | `query()` (Step 1 exact lookup, Step 2 semantic lookup, Step 4 dual store) |
| **Admin Cache API** | [`backend/src/routes/adminRoutes.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/routes/adminRoutes.js) | `GET /api/admin/cache/stats`, `POST /api/admin/cache/invalidate` |
| **Admin UI Monitor** | [`frontend/src/pages/AdminDashboard.jsx`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/frontend/src/pages/AdminDashboard.jsx) | `fetchCacheStats()`, `handleInvalidateCache()` |

---

## 8. Identified Bottlenecks & Future Improvements

Based on code analysis of the caching implementation, the following architectural improvements can be made:

### 1. Dedicated Qdrant Collection for Semantic Query Cache
* **Current Bottleneck:**  
  In [`semanticCache.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/cache/semanticCache.js#L89-L101), cached query embeddings are stored in a serialized JSON array in Redis (`rag:v{version}:semantic:index`) and scanned via a **linear JavaScript loop ($O(N)$)**. To prevent high CPU time, the index is artificially capped at only 100 entries (`MAX_ENTRIES = 100`).
* **Proposed Improvement:**  
  Create a dedicated Qdrant collection named `semantic_query_cache` indexed with HNSW (Hierarchical Navigable Small World).
  * **Benefits:** Scales from 100 entries to **100,000+ cached questions** with sub-5ms indexed vector search instead of serial array scanning.

### 2. Domain-Scoped / Category-Scoped Invalidation
* **Current Bottleneck:**  
  Currently, `cacheInvalidation.incrementCacheVersion()` bumps a **single global version number**. If an administrator uploads an updated syllabus for *Civil Engineering*, it flushes the cache for *Hostel Curfew Rules*, *Computer Science Courses*, and *Fee Guidelines*.
* **Proposed Improvement:**  
  Introduce scoped versioning:
  $$\texttt{rag:v\{globalVer\}:domain:\{category\}:public:\{hash\}}$$
  Updating a Course syllabus would only bump `rag:version:domain:courses`, preserving academic regulations and notice caches.

### 3. Dynamic TTL Based on Document Volatility
* **Current Bottleneck:**  
  All exact and semantic entries share a flat TTL of 1 hour (`DEFAULT_TTL_SECONDS = 3600`).
* **Proposed Improvement:**  
  Implement tiered TTLs based on content volatility:
  * **Static University Ordinances & Attendance Rules:** 7 to 30 days TTL.
  * **Curriculum & Credit Structures:** 14 days TTL.
  * **Circulars, Datesheets & Notices:** 2 to 6 hours TTL.

### 4. Automated Cache Warming on Document Ingestion
* **Current Bottleneck:**  
  The cache is entirely **passive** (reactive). The very first student asking a question always experiences cold-start latency (1.5s+).
* **Proposed Improvement:**  
  During the document ingestion pipeline in [`ingestionService.js`](file:///d:/CODING/WEB%20DEV/Projects/AskCampusAi/backend/src/services/ingestion/ingestionService.js), generate 5–10 synthetic high-frequency FAQs for each indexed section using Gemini Flash and pre-warm both Tier 1 and Tier 2 caches automatically.

### 5. Adaptive Similarity Thresholding
* **Current Bottleneck:**  
  A single static threshold (`SEMANTIC_CACHE_THRESHOLD = 0.88`) applies to all queries regardless of query length or intent.
  * Very short queries (*"hostel fees"*) can match unrelated fee structures at 0.88 similarity.
* **Proposed Improvement:**  
  * For queries with $\le 4$ words: Enforce strict threshold $\ge 0.94$.
  * For long descriptive queries ($\ge 10$ words): Allow threshold $\ge 0.88$.

### 6. Negative Caching for Out-of-Scope Queries
* **Current Bottleneck:**  
  Queries that result in `INSUFFICIENT` coverage or out-of-scope campus refusals are not cached. Repeated spam or out-of-scope inquiries repeatedly trigger full retrieval cycles.
* **Proposed Improvement:**  
  Cache confirmed refusal responses with a short TTL (10 minutes) so repeated unanswerable questions exit in $< 10\text{ms}$.
