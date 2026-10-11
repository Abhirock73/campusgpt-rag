import { retrieveHybridContext } from '../retrieval/hybridRetriever.js';
import { retrieveVectorCandidates } from '../retrieval/vectorRetriever.js';
import { generateAnswerStream } from '../ai/llmService.js';
import { assessEvidenceLLM } from './evidenceAssessmentService.js';
import { analyzeQuery } from '../query/queryAnalyzer.js';
import exactQueryCache from '../cache/exactQueryCache.js';
import semanticCache from '../cache/semanticCache.js';
import cacheInvalidation from '../cache/cacheInvalidation.js';
import { isSemanticCacheEligible } from '../cache/cacheKey.js';

/**
 * Format and deduplicate sources by grouping chunks belonging to the same document
 * @param {Array<object>} chunks
 * @returns {Array<object>} Clean, grouped source citations
 */
export const groupSources = (chunks = []) => {
  const docMap = new Map();

  for (const chunk of chunks) {
    const docId = chunk.documentId || 'doc-unknown';
    if (!docMap.has(docId)) {
      docMap.set(docId, {
        documentId: docId,
        title: chunk.documentTitle || 'Official University Document',
        documentTitle: chunk.documentTitle || 'Official University Document',
        category: chunk.category || 'academics',
        department: chunk.department || 'General',
        documentType: chunk.documentType || 'regulation',
        sourceAuthority: chunk.sourceAuthority || 'official',
        sourceType: chunk.sourceType || (chunk.sourceUrl?.includes('drive.google.com') ? 'student_drive' : 'official_nitkkr'),
        sourceTrust: chunk.sourceTrust || (chunk.sourceType === 'student_drive' || chunk.sourceUrl?.includes('drive.google.com') ? 'community' : 'official'),
        sourceName: chunk.sourceName || (chunk.sourceType === 'student_drive' || chunk.sourceUrl?.includes('drive.google.com') ? 'NIT KKR PYQ Drive' : 'NIT Kurukshetra Official Website'),
        year: chunk.year || null,
        academicYear: chunk.academicYear || null,
        pages: new Set(),
        chunkIndices: [],
        sourceUrl: chunk.sourceUrl || null,
        sourcePageUrl: chunk.sourcePageUrl || null,
        knowledgeBaseScope: chunk.knowledgeBaseScope || 'student',
        topScore: chunk.rerankScore || chunk.rrfScore || chunk.score || 0,
      });
    }

    const docEntry = docMap.get(docId);
    if (chunk.pageNumber) docEntry.pages.add(chunk.pageNumber);
    if (chunk.chunkIndex !== undefined) docEntry.chunkIndices.push(chunk.chunkIndex);
    if (!docEntry.sourcePageUrl && chunk.sourcePageUrl) docEntry.sourcePageUrl = chunk.sourcePageUrl;
    if (!docEntry.sourceUrl && chunk.sourceUrl) docEntry.sourceUrl = chunk.sourceUrl;
    const score = chunk.rerankScore || chunk.rrfScore || chunk.score || 0;
    if (score > docEntry.topScore) docEntry.topScore = score;
  }

  const sources = [];
  for (const entry of docMap.values()) {
    const sortedPages = Array.from(entry.pages).sort((a, b) => a - b);
    let pageDisplay = null;
    if (sortedPages.length === 1) {
      pageDisplay = `Page ${sortedPages[0]}`;
    } else if (sortedPages.length > 1) {
      // Check if continuous range
      const isRange =
        sortedPages.length === sortedPages[sortedPages.length - 1] - sortedPages[0] + 1;
      pageDisplay = isRange
        ? `Pages ${sortedPages[0]}–${sortedPages[sortedPages.length - 1]}`
        : `Pages ${sortedPages.join(', ')}`;
    }

    // Resolve direct URL
    const resolvedUrl =
      entry.sourceUrl ||
      entry.sourcePageUrl ||
      (entry.documentId && entry.documentId !== 'doc-unknown'
        ? `/api/documents/${entry.documentId}/file`
        : null);

    sources.push({
      documentId: entry.documentId,
      documentTitle: entry.title,
      title: entry.title,
      category: entry.category,
      department: entry.department,
      documentType: entry.documentType,
      sourceType: entry.sourceType,
      sourceTrust: entry.sourceTrust,
      sourceName: entry.sourceName,
      sourceAuthority: entry.sourceAuthority || 'official',
      year: entry.year,
      academicYear: entry.academicYear,
      pageNumber: sortedPages[0] || 1,
      pages: sortedPages,
      pageDisplay,
      sourceUrl: resolvedUrl,
      sourcePageUrl: entry.sourcePageUrl,
      knowledgeBaseScope: entry.knowledgeBaseScope,
      relevanceScore: Math.round(entry.topScore * 100) / 100,
    });
  }

  // Sort sources by relevanceScore descending
  return sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
};

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'all', 'and', 'any', 'are', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could', 'did', 'does', 'doing',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'into', 'is', 'it',
  'its', 'itself', 'just', 'more', 'most', 'myself', 'nor', 'not', 'now', 'off', 'once', 'only',
  'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she',
  'should', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'too', 'under', 'until', 'up',
  'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with',
  'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * Check if a retrieved chunk contributed to the LLM answer
 */
export const isChunkUsedInAnswer = (chunk, answer) => {
  if (!chunk || !chunk.text || !answer) return false;
  const ansLower = answer.toLowerCase();

  // 1. Direct regulation or clause numbers (e.g. "Regulation 4.2", "clause 3")
  const regNumbers = chunk.text.match(/\b(?:regulation|rule|clause|section|ordinance)\s+[0-9]+(?:\.[0-9]+)*\b/gi) || [];
  for (const reg of regNumbers) {
    if (ansLower.includes(reg.toLowerCase())) return true;
  }

  // 2. Specific numerical/policy details (e.g. "75%", "Rs 5000", "CGPA 6.5")
  const specificMetrics = chunk.text.match(/\b[0-9]{1,3}%\b|\b(?:rs\.?|inr)\s*[0-9]+(?:,[0-9]+)?\b|\bcgpa\s+[0-9]+(?:\.[0-9]+)?\b/gi) || [];
  for (const metric of specificMetrics) {
    if (ansLower.includes(metric.toLowerCase())) return true;
  }

  // 3. Document title mention
  if (chunk.documentTitle && chunk.documentTitle.length > 6) {
    const titleClean = chunk.documentTitle.toLowerCase().replace(/\.pdf$/i, '').trim();
    if (titleClean.length > 8 && ansLower.includes(titleClean)) return true;
  }

  // 4. Substantive keyword overlap (words of length >= 5)
  const chunkWords = chunk.text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP_WORDS.has(w));

  let matchedWords = 0;
  for (const word of new Set(chunkWords)) {
    if (ansLower.includes(word)) {
      matchedWords++;
      if (matchedWords >= 3) return true;
    }
  }

  return false;
};

/**
 * End-to-end RAG orchestrator with Multi-Query Retrieval, Evidence Coverage & Partial Answers:
 * Question -> Exact Cache -> Semantic Cache -> Multi-Query Hybrid Retrieval -> RRF -> Reranking -> Evidence Assessment -> Grounded LLM -> Cache Store
 * 
 * @param {string} question - Student inquiry
 * @param {object} options - Options (user, mode, topK, filters, bypassCache, semanticThreshold)
 * @returns {Promise<{
 *   answer: string,
 *   sources: Array<object>,
 *   retrievedCount: number,
 *   coverage: 'FULL'|'PARTIAL'|'INSUFFICIENT'|'CLARIFICATION',
 *   requestedFields: string[],
 *   supportedFields: string[],
 *   missingFields: string[],
 *   clarification?: object|null,
 *   diagnostics: object,
 *   cache: object
 * }>}
 */
export const answerQuestion = async (question, options = {}) => {
  const callbacks = options.callbacks || {};

  if (!question || !question.trim()) {
    return {
      answer: 'Please provide a valid campus question.',
      sources: [],
      retrievedCount: 0,
      coverage: 'INSUFFICIENT',
      requestedFields: [],
      supportedFields: [],
      missingFields: [],
      diagnostics: {},
      cache: { hit: false, type: 'none' },
    };
  }

  const query = question.trim();
  const isPublic = options.isPublic !== false && !options.user?.isPrivateQuery;
  const version = await cacheInvalidation.getCacheVersion();

  // ----------------------------------------------------
  // STEP 1: Exact Query Cache Lookup
  // ----------------------------------------------------
  if (!options.bypassCache) {
    const exactResult = await exactQueryCache.get({
      query,
      user: options.user,
      version,
      isPublic,
    });

    if (exactResult) {
      callbacks.onStatus?.('Found verified answer in campus records');
      callbacks.onSources?.(exactResult.sources || []);
      callbacks.onToken?.(exactResult.answer);

      return {
        answer: exactResult.answer,
        sources: exactResult.sources || [],
        suggestions: exactResult.suggestions || [],
        retrievedCount: (exactResult.sources || []).length,
        coverage: exactResult.coverage || 'FULL',
        requestedFields: exactResult.requestedFields || [],
        supportedFields: exactResult.supportedFields || [],
        missingFields: exactResult.missingFields || [],
        diagnostics: { cache: 'exact', version, cachedAt: exactResult.cachedAt },
        cache: {
          hit: true,
          type: 'exact',
          cachedAt: exactResult.cachedAt,
          version,
        },
      };
    }
  }

  // ----------------------------------------------------
  // STEP 2: Semantic Query Cache Lookup
  // ----------------------------------------------------
  if (!options.bypassCache && isSemanticCacheEligible(query, { isPrivate: !isPublic })) {
    const semanticResult = await semanticCache.findSimilar({
      query,
      version,
      threshold: options.semanticThreshold,
    });

    if (semanticResult) {
      callbacks.onStatus?.('Found verified answer in campus records');
      callbacks.onSources?.(semanticResult.sources || []);
      callbacks.onToken?.(semanticResult.answer);

      return {
        answer: semanticResult.answer,
        sources: semanticResult.sources || [],
        suggestions: semanticResult.suggestions || [],
        retrievedCount: (semanticResult.sources || []).length,
        coverage: semanticResult.coverage || 'FULL',
        requestedFields: semanticResult.requestedFields || [],
        supportedFields: semanticResult.supportedFields || [],
        missingFields: semanticResult.missingFields || [],
        diagnostics: {
          cache: 'semantic',
          version,
          similarity: semanticResult.cache?.similarity,
          matchedQuery: semanticResult.cache?.matchedQuery,
        },
        cache: {
          hit: true,
          type: 'semantic',
          similarity: semanticResult.cache?.similarity,
          threshold: semanticResult.cache?.threshold,
          matchedQuery: semanticResult.cache?.matchedQuery,
          cachedAt: semanticResult.cachedAt,
          version,
        },
      };
    }
  }

  // ----------------------------------------------------
  // STEP 3: Multi-Query Hybrid Retrieval & Evidence Assessment
  // ----------------------------------------------------
  let retrievedChunks = [];
  let diagnostics = {};
  let analysis = {};

  const queryToSearch = options.rewrittenQuery || query;

  callbacks.onStatus?.('Searching official documents...');

  if (options.mode === 'vector_only') {
    const topK = options.topK || parseInt(process.env.RAG_TOP_K, 10) || 5;
    analysis = analyzeQuery(queryToSearch);
    retrievedChunks = await retrieveVectorCandidates(queryToSearch, {
      limit: topK,
      filters: options.filters,
    });
    diagnostics = { mode: 'vector_only', chunkCount: retrievedChunks.length };
  } else {
    const hybridResult = await retrieveHybridContext(queryToSearch, options);
    retrievedChunks = hybridResult.chunks;
    diagnostics = hybridResult.diagnostics;
    analysis = hybridResult.analysis || analyzeQuery(queryToSearch);
  }

  // Assess evidence coverage dynamically using Gemini LLM (Claim-level validation)
  callbacks.onStatus?.('Assessing document evidence...');
  let coverageReport = await assessEvidenceLLM(query, retrievedChunks);
  diagnostics.coverage = coverageReport.coverage;
  diagnostics.confidence = coverageReport.confidence;
  diagnostics.supportedClaims = coverageReport.supportedClaims;
  diagnostics.unsupportedClaims = coverageReport.unsupportedClaims;

  // RETRIEVAL RETRY: If first retrieval was insufficient and we haven't retried yet,
  // attempt a second retrieval using expanded terms or combined queries
  if (!coverageReport.sufficient && !options._isRetry) {
    const expandedTerms = options.expandedTerms || [];
    const retryQuery = expandedTerms.length > 0
      ? `${query} ${expandedTerms.slice(0, 4).join(' ')}`
      : options.rewrittenQuery && options.rewrittenQuery !== query
        ? options.rewrittenQuery
        : null;

    if (retryQuery && retryQuery !== queryToSearch) {
      callbacks.onStatus?.('Refining search with related campus terms...');
      console.log(`[RAG RETRY] Evidence insufficient on first retrieval. Retrying with expanded query: "${retryQuery}"...`);
      const retryResult = await retrieveHybridContext(retryQuery, { ...options, _isRetry: true });
      if (retryResult.chunks && retryResult.chunks.length > 0) {
        // Merge chunks without duplicates
        const existingIds = new Set(retrievedChunks.map(c => c.chunkId || `${c.documentId}_${c.chunkIndex}`));
        const newChunks = retryResult.chunks.filter(c => !existingIds.has(c.chunkId || `${c.documentId}_${c.chunkIndex}`));
        const mergedChunks = [...retrievedChunks, ...newChunks];

        if (mergedChunks.length > 0) {
          const retryAssessment = await assessEvidenceLLM(query, mergedChunks);
          if (retryAssessment.sufficient || retryAssessment.confidence > coverageReport.confidence) {
            console.log(`[RAG RETRY] Successful! New coverage: ${retryAssessment.coverage} (Confidence: ${retryAssessment.confidence})`);
            retrievedChunks = mergedChunks;
            coverageReport = retryAssessment;
            diagnostics.coverage = coverageReport.coverage;
            diagnostics.retried = true;
          }
        }
      }
    }
  }

  // Send early sources as soon as retrieved chunks are ready
  if (retrievedChunks && retrievedChunks.length > 0) {
    const earlySources = groupSources(retrievedChunks);
    if (earlySources.length > 0) {
      callbacks.onSources?.(earlySources);
    }
  }

  // Anti-hallucination check: if genuinely no relevant context found
  if (!retrievedChunks || retrievedChunks.length === 0 || !coverageReport.sufficient) {
    const unverifiedAnswer = "I couldn't find this information in the available university documents.";
    callbacks.onToken?.(unverifiedAnswer);

    return {
      answer: unverifiedAnswer,
      sources: [],
      retrievedCount: 0,
      coverage: 'INSUFFICIENT',
      requestedFields: coverageReport.unsupportedClaims || [],
      supportedFields: coverageReport.supportedClaims || [],
      missingFields: coverageReport.unsupportedClaims || [],
      diagnostics,
      cache: { hit: false, type: 'miss' },
    };
  }

  // Grounded LLM generation with coverage guidance (Full or Partial)
  callbacks.onStatus?.('Generating answer...');
  console.log(
    `[RAG] Generating answer with ${retrievedChunks.length} context chunk(s) [Coverage: ${coverageReport.coverage}]...`
  );
  const genResult = await generateAnswerStream(query, retrievedChunks, {
    coverageReport,
    onToken: callbacks.onToken,
  });
  const answer = (genResult && genResult.answer) ? genResult.answer : String(genResult);
  const usedIndices = (genResult && genResult.usedSourceIndices) ? genResult.usedSourceIndices : [];
  const suggestions = (genResult && genResult.suggestions && Array.isArray(genResult.suggestions)) ? genResult.suggestions : [];
  console.log(`[RAG] Grounded answer generated successfully. Used source indices: [${usedIndices.join(', ')}], Suggestions: [${suggestions.join(', ')}]`);

  // Determine if the answer is negative, unverified, or failed to retrieve information from documents
  const lowerAnswer = answer.toLowerCase();
  const isAnswerNotFound =
    lowerAnswer.includes("couldn't find this information") ||
    lowerAnswer.includes("could not find this information") ||
    lowerAnswer.includes("cannot find this information") ||
    lowerAnswer.includes("can't find this information") ||
    lowerAnswer.includes("not found in the available") ||
    lowerAnswer.includes("not found in the official") ||
    lowerAnswer.includes("not found in the currently indexed") ||
    lowerAnswer.includes("no relevant documents") ||
    lowerAnswer.includes("no information is available") ||
    lowerAnswer.includes("no information was found") ||
    lowerAnswer.includes("do not contain information") ||
    lowerAnswer.includes("does not contain information") ||
    coverageReport.coverage === 'INSUFFICIENT';

  // Mention sources ONLY if the response was actually generated from those sources
  let sources = [];
  if (!isAnswerNotFound) {
    let contributingChunks = [];

    // Prioritize explicit source attribution from the LLM
    if (usedIndices && usedIndices.length > 0) {
      contributingChunks = usedIndices
        .map((idx) => retrievedChunks[idx - 1])
        .filter(Boolean);
    }

    // Fallback: If LLM didn't output explicit index tag, check content overlap
    if (contributingChunks.length === 0) {
      contributingChunks = retrievedChunks.filter((chunk) => isChunkUsedInAnswer(chunk, answer));
    }

    // If still empty but coverage was FULL and answer is a rich verified response, use top retrieved chunks
    if (contributingChunks.length === 0 && coverageReport.coverage === 'FULL' && answer.length > 80) {
      contributingChunks = retrievedChunks.slice(0, 2);
    }

    // Group only the verified contributing chunks into sources
    if (contributingChunks.length > 0) {
      sources = groupSources(contributingChunks);
      callbacks.onSources?.(sources);
    }
  }

  // ----------------------------------------------------
  // STEP 4: Store Grounded Answer in Exact & Semantic Caches
  // ----------------------------------------------------
  if (!isAnswerNotFound && answer && answer.trim().length > 10) {
    const cachePayload = {
      answer,
      sources,
      suggestions,
      coverage: coverageReport.coverage,
      requestedFields: coverageReport.requestedFields,
      supportedFields: coverageReport.supportedFields,
      missingFields: coverageReport.missingFields,
    };

    // 4a. Store in Exact Cache
    await exactQueryCache.set({
      query,
      user: options.user,
      version,
      isPublic,
      response: cachePayload,
    });

    // 4b. Store in Semantic Cache (only if query is eligible)
    if (isSemanticCacheEligible(query, { isPrivate: !isPublic })) {
      await semanticCache.store({
        query,
        response: cachePayload,
        version,
      });
    }
  }

  return {
    answer,
    sources,
    suggestions,
    retrievedCount: retrievedChunks.length,
    coverage: coverageReport.coverage,
    requestedFields: coverageReport.requestedFields,
    supportedFields: coverageReport.supportedFields,
    missingFields: coverageReport.missingFields,
    diagnostics,
    cache: {
      hit: false,
      type: 'miss',
    },
  };
};

export default {
  answerQuestion,
  groupSources,
};
