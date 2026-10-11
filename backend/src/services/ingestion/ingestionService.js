import crypto from 'crypto';
import Document from '../../models/Document.js';
import DocumentVersion from '../../models/DocumentVersion.js';
import Chunk from '../../models/Chunk.js';
import IngestionJob from '../../models/IngestionJob.js';
import { parsePDF, getPDFPageCount } from '../documents/pdfParser.js';
import { cleanText } from '../documents/textCleaner.js';
import { chunkDocumentPages } from '../documents/chunker.js';
import { generateEmbeddings } from '../ai/embeddingService.js';
import {
  upsertPoints,
  deletePointsByVersionId,
  setPointsActiveByVersionId,
} from '../vector/qdrantService.js';
import { syncBM25Index } from '../retrieval/keywordRetriever.js';
import cacheInvalidation from '../cache/cacheInvalidation.js';
import { validatePhysicalFile } from './documentValidator.js';

/**
 * Update Ingestion Job and DocumentVersion status and progress
 */
const updateJobStatus = async (job, version, stage, progress, error = null) => {
  if (version) {
    version.processingStatus = error ? 'failed' : stage === 'indexed' ? 'indexed' : stage;
    version.currentStage = stage;
    version.processingProgress = progress;
    if (error) version.processingError = error;
    if (stage === 'validating' && !version.processingStartedAt) {
      version.processingStartedAt = new Date();
    }
    if (stage === 'indexed' || error) {
      version.processingCompletedAt = new Date();
    }
    await version.save();
  }

  if (job) {
    job.status = error ? 'failed' : stage === 'indexed' ? 'completed' : 'processing';
    job.currentStage = stage;
    job.progress = progress;
    if (error) job.error = error;
    if (stage === 'indexed' || error) job.completedAt = new Date();
    await job.save();
  }
};

/**
 * Core Ingestion Engine for Document Versions
 * Validates, Extracts, Chunks, Embeds, Indexes, and atomically activates versions
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {string} params.versionId
 * @param {string} [params.jobId]
 * @returns {Promise<object>} Result summary
 */
export const processDocumentVersion = async (arg1, arg2, arg3) => {
  let documentId;
  let versionId;
  let jobId = null;

  if (arg1 && typeof arg1 === 'object' && arg1.documentId) {
    documentId = arg1.documentId;
    versionId = arg1.versionId;
    jobId = arg1.jobId || null;
  } else {
    documentId = arg1;
    versionId = arg2;
    jobId = arg3 || null;
  }

  const doc = await Document.findById(documentId);
  if (!doc) throw new Error(`Document with ID ${documentId} not found`);

  const version = await DocumentVersion.findById(versionId);
  if (!version) throw new Error(`DocumentVersion with ID ${versionId} not found`);

  let job = null;
  if (jobId) {
    job = await IngestionJob.findById(jobId);
  }

  console.log(`[INGESTION] Starting processing for "${doc.title}" (Version ${version.versionNumber})`);

  try {
    // ----------------------------------------------------
    // STAGE 1: VALIDATING (10%)
    // ----------------------------------------------------
    await updateJobStatus(job, version, 'validating', 10);
    const fileVal = validatePhysicalFile(version.storagePath);
    if (!fileVal.isValid) {
      throw new Error(`File validation failed: ${fileVal.error}`);
    }

    // Inspect page count early before heavy text extraction to prevent memory spikes
    const maxPdfPages = parseInt(process.env.MAX_PDF_PAGES || '200', 10);
    const totalPages = await getPDFPageCount(version.storagePath);
    version.totalPages = totalPages;
    await version.save();

    if (maxPdfPages > 0 && totalPages > maxPdfPages) {
      throw new Error(
        `PDF exceeds configured maximum page limit of ${maxPdfPages}. (Pages: ${totalPages}, Maximum allowed: ${maxPdfPages})`
      );
    }

    // ----------------------------------------------------
    // STAGE 2: EXTRACTING (25%)
    // ----------------------------------------------------
    await updateJobStatus(job, version, 'extracting', 25);
    const parsed = await parsePDF(version.storagePath, { maxPages: maxPdfPages });
    console.log(`[INGESTION] Extracted ${parsed.totalPages} page(s) from "${version.fileName}"`);

    if (!parsed.fullText || parsed.fullText.trim().length === 0) {
      throw new Error('PDF contains no extractable text. Scanned documents without OCR cannot be indexed.');
    }

    // ----------------------------------------------------
    // STAGE 3: CHUNKING (50%)
    // ----------------------------------------------------
    await updateJobStatus(job, version, 'chunking', 50);
    const cleanedPages = parsed.pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: cleanText(p.text),
    }));

    const chunks = chunkDocumentPages(cleanedPages);
    console.log(`[INGESTION] Generated ${chunks.length} semantic chunk(s) for Version ${version.versionNumber}`);

    if (chunks.length === 0) {
      throw new Error('No valid chunks could be created from document content.');
    }

    // ----------------------------------------------------
    // STAGE 4: EMBEDDING (75%)
    // ----------------------------------------------------
    await updateJobStatus(job, version, 'embedding', 75);
    const chunkTexts = chunks.map((c) => c.text);
    console.log(`[INGESTION] Generating Gemini embeddings for ${chunks.length} chunks...`);
    const embeddings = await generateEmbeddings(chunkTexts);

    // ----------------------------------------------------
    // STAGE 5: INDEXING (90%)
    // ----------------------------------------------------
    await updateJobStatus(job, version, 'indexing', 90);

    // Clean up any existing points or chunks for THIS version ID (in case of re-index / retry)
    try {
      await deletePointsByVersionId(version._id.toString());
    } catch (e) {
      // Ignore initial delete
    }
    await Chunk.deleteMany({ documentVersionId: version._id });

    // Format Qdrant points with UUID and complete payload metadata
    const qdrantPoints = chunks.map((chunk, idx) => ({
      id: crypto.randomUUID(),
      vector: embeddings[idx],
      payload: {
        documentId: doc._id.toString(),
        documentVersionId: version._id.toString(),
        documentTitle: doc.title,
        category: doc.category,
        department: doc.department,
        documentType: doc.documentType,
        sourceType: doc.sourceType || 'official_nitkkr',
        sourceAuthority: doc.sourceAuthority || 'official',
        sourceTrust: doc.sourceTrust || 'official',
        courseCode: doc.courseCode || null,
        semester: doc.semester || null,
        branch: doc.department || null,
        year: doc.year || null,
        academicYear: doc.academicYear || null,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        sourceUrl: doc.sourceUrl || '',
        sourcePageUrl: doc.sourcePageUrl || '',
        knowledgeBaseScope: doc.knowledgeBaseScope || 'student',
        isActive: true, // Will be made active on atomic switch
      },
    }));

    // Upsert into Qdrant Cloud collection
    await upsertPoints(qdrantPoints);
    console.log(`[INGESTION] Upserted ${qdrantPoints.length} point(s) into Qdrant collection`);

    // Persist in MongoDB Chunk collection for lexical BM25 search
    const chunkDocs = chunks.map((chunk, idx) => ({
      documentId: doc._id,
      documentVersionId: version._id,
      versionNumber: version.versionNumber,
      documentTitle: doc.title,
      category: doc.category,
      department: doc.department,
      documentType: doc.documentType,
      sourceType: doc.sourceType || 'official_nitkkr',
      sourceAuthority: doc.sourceAuthority || 'official',
      sourceTrust: doc.sourceTrust || 'official',
      courseCode: doc.courseCode || null,
      semester: doc.semester || null,
      branch: doc.department || null,
      year: doc.year || null,
      academicYear: doc.academicYear || null,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      sourceUrl: doc.sourceUrl || '',
      sourcePageUrl: doc.sourcePageUrl || '',
      knowledgeBaseScope: doc.knowledgeBaseScope || 'student',
      isActive: true,
      qdrantPointId: qdrantPoints[idx].id,
    }));
    await Chunk.insertMany(chunkDocs);

    // ----------------------------------------------------
    // STAGE 6: ATOMIC VERSION ACTIVATION (100%)
    // ----------------------------------------------------
    // Mark new version indexed and active
    version.processingStatus = 'indexed';
    version.currentStage = 'indexed';
    version.processingProgress = 100;
    version.totalPages = parsed.totalPages;
    version.totalChunks = chunks.length;
    version.indexedAt = new Date();
    version.processingError = null;
    version.isActive = true;
    await version.save();

    // Deactivate previous active versions for this document
    const otherVersions = await DocumentVersion.find({
      documentId: doc._id,
      _id: { $ne: version._id },
      isActive: true,
    });

    for (const oldVer of otherVersions) {
      console.log(`[INGESTION] Deactivating previous active Version ${oldVer.versionNumber} (ID: ${oldVer._id})`);
      oldVer.isActive = false;
      await oldVer.save();

      // Deactivate chunks in MongoDB
      await Chunk.updateMany({ documentVersionId: oldVer._id }, { isActive: false });

      // Deactivate points in Qdrant
      try {
        await setPointsActiveByVersionId(oldVer._id.toString(), false);
      } catch (qErr) {
        console.warn(`[INGESTION WARNING] Failed to set old points inactive in Qdrant: ${qErr.message}`);
      }
    }

    // Update parent Document record to reference newly active version
    doc.currentVersionId = version._id;
    doc.currentVersionNumber = version.versionNumber;
    doc.totalPages = parsed.totalPages;
    doc.totalChunks = chunks.length;
    doc.storagePath = version.storagePath;
    doc.originalFileName = version.fileName;
    doc.status = 'indexed';
    doc.isActive = true;
    doc.errorMessage = null;
    await doc.save();

    if (job) {
      job.status = 'completed';
      job.currentStage = 'completed';
      job.progress = 100;
      job.completedAt = new Date();
      await job.save();
    }

    // Synchronize keyword BM25 index with new active chunks
    await syncBM25Index(true);

    // Invalidate Phase 4 Redis RAG cache so answers reflect new version
    try {
      await cacheInvalidation.incrementCacheVersion(
        `Version Activated: "${doc.title}" (v${version.versionNumber})`
      );
    } catch (cErr) {
      console.warn(`[CACHE WARNING] Could not bump cache version: ${cErr.message}`);
    }

    console.log(`[INGESTION] Document "${doc.title}" Version ${version.versionNumber} successfully ACTIVATED!`);
    return {
      success: true,
      document: doc,
      version,
      chunksCount: chunks.length,
    };
  } catch (error) {
    console.error(`[INGESTION ERROR] Version ${version.versionNumber} failed: ${error.message}`);

    // Update version status to failed
    await updateJobStatus(job, version, 'failed', 0, error.message);

    // Safety: Clean up any partial points or chunks for this failed version
    try {
      await deletePointsByVersionId(version._id.toString());
      await Chunk.deleteMany({ documentVersionId: version._id });
    } catch (cleanErr) {
      // Safe ignore
    }

    // Ensure parent document remains healthy if an older active version existed!
    const activeVersionExists = await DocumentVersion.findOne({
      documentId: doc._id,
      isActive: true,
      _id: { $ne: version._id },
    });

    if (!activeVersionExists) {
      // Only mark document as failed if NO previous active version exists
      doc.status = 'failed';
      doc.errorMessage = error.message;
      await doc.save();
    } else {
      console.log(`[INGESTION] Preserving previous active Version ${doc.currentVersionNumber} for queries.`);
    }

    throw error;
  }
};

/**
 * Re-index an existing active version without creating a new version
 * @param {string} documentId 
 * @param {string} userId 
 */
export const reindexDocument = async (documentId, userId) => {
  const doc = await Document.findById(documentId);
  if (!doc) throw new Error('Document not found');

  if (!doc.currentVersionId) {
    throw new Error('Document has no active version to re-index');
  }

  const job = await IngestionJob.create({
    documentId: doc._id,
    documentVersionId: doc.currentVersionId,
    status: 'processing',
    currentStage: 'validating',
    progress: 10,
    createdBy: userId,
    startedAt: new Date(),
  });

  return await processDocumentVersion({
    documentId: doc._id,
    versionId: doc.currentVersionId,
    jobId: job._id,
  });
};

/**
 * Retry ingestion for a failed version
 * @param {string} versionId 
 * @param {string} userId 
 */
export const retryVersionIngestion = async (versionId, userId) => {
  const version = await DocumentVersion.findById(versionId);
  if (!version) throw new Error('Document version not found');

  const job = await IngestionJob.create({
    documentId: version.documentId,
    documentVersionId: version._id,
    status: 'processing',
    currentStage: 'validating',
    progress: 10,
    createdBy: userId,
    startedAt: new Date(),
  });

  return await processDocumentVersion({
    documentId: version.documentId,
    versionId: version._id,
    jobId: job._id,
  });
};

export const retryFailedVersion = async (documentId, versionId, userId) => {
  return await retryVersionIngestion(versionId, userId);
};

export default {
  processDocumentVersion,
  reindexDocument,
  retryVersionIngestion,
  retryFailedVersion,
};
