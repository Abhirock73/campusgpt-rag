import PyqDocument from '../models/PyqDocument.js';
import PyqSyncJob from '../models/PyqSyncJob.js';
import CrawlUrl from '../models/CrawlUrl.js';
import CrawlJob from '../models/CrawlJob.js';
import { startDriveSync, stopDriveSync, reconcileStaleSyncJobs, getLatestSyncJob } from '../services/drive/driveSyncService.js';
import driveClient from '../services/drive/driveClient.js';
import pyqProcessor from '../services/pyq/pyqProcessor.js';

/**
 * GET /api/admin/knowledge/stats
 * Aggregates high-level statistics for both Public PYQ Drive and Official NIT KKR Crawler
 */
export const getKnowledgeStats = async (req, res, next) => {
  try {
    // Automatically reconcile any stale running jobs (e.g. killed by server restart)
    try {
      await reconcileStaleSyncJobs();
    } catch (recErr) {
      console.warn('[RECONCILE WARNING]', recErr.message);
    }

    try {
      const crawlStaleThreshold = new Date(Date.now() - 20 * 60 * 1000);
      await CrawlJob.updateMany(
        { status: 'running', updatedAt: { $lt: crawlStaleThreshold } },
        { $set: { status: 'stopped', error: 'Crawl stopped due to server restart or inactivity.' } }
      );
    } catch (crawlRecErr) {
      console.warn('[CRAWL RECONCILE WARNING]', crawlRecErr.message);
    }
    // ----------------------------------------------------
    // 1. PYQ DRIVE METRICS
    // ----------------------------------------------------
    const [
      pyqFolderCount,
      pyqPdfDiscovered,
      pyqPdfApproved,
      pyqPdfPending,
      pyqPdfFailed,
      pyqPdfSkipped,
      pyqAggregates,
      lastFullSync,
      lastIncrSync,
      activePyqJob,
    ] = await Promise.all([
      CrawlUrl.countDocuments({ sourceType: 'student_drive', type: 'folder' }),
      CrawlUrl.countDocuments({ sourceType: 'student_drive', type: 'pdf' }),
      PyqDocument.countDocuments({ status: 'approved' }),
      PyqDocument.countDocuments({ status: 'pending' }),
      PyqDocument.countDocuments({ status: 'failed' }),
      CrawlUrl.countDocuments({ sourceType: 'student_drive', status: 'skipped' }),
      PyqDocument.aggregate([
        { $match: { status: 'approved' } },
        {
          $group: {
            _id: null,
            totalQuestions: { $sum: '$questionCount' },
            totalChunks: { $sum: '$chunkCount' },
          },
        },
      ]),
      PyqSyncJob.findOne({ syncType: 'FULL_SYNC', status: 'completed' }).sort({ completedAt: -1 }),
      PyqSyncJob.findOne({ syncType: 'INCREMENTAL_SYNC', status: 'completed' }).sort({ completedAt: -1 }),
      PyqSyncJob.findOne({ status: 'running' }).sort({ createdAt: -1 }),
    ]);

    const totalQuestions = pyqAggregates[0]?.totalQuestions || 0;
    const totalChunks = pyqAggregates[0]?.totalChunks || 0;

    // ----------------------------------------------------
    // 2. OFFICIAL NIT KKR CRAWLER METRICS
    // ----------------------------------------------------
    const [
      officialUrlsDiscovered,
      officialPagesCrawled,
      officialDocsProcessed,
      officialDocsFailed,
      officialCrawlJobs,
      lastOfficialJob,
      activeOfficialJob,
    ] = await Promise.all([
      CrawlUrl.countDocuments({ sourceType: 'official_nitkkr' }),
      CrawlUrl.countDocuments({ sourceType: 'official_nitkkr', status: 'processed' }),
      Document.countDocuments({ isDeleted: { $ne: true }, status: 'indexed' }),
      Document.countDocuments({ isDeleted: { $ne: true }, status: 'failed' }),
      CrawlJob.countDocuments(),
      CrawlJob.findOne({ status: 'completed' }).sort({ completedAt: -1 }),
      CrawlJob.findOne({ status: 'running' }).sort({ startedAt: -1 }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        pyqDrive: {
          configuredFolderUrl: process.env.PYQ_DRIVE_FOLDER_URL || 'Not Configured',
          totalFolders: pyqFolderCount,
          totalPdfsDiscovered: Math.max(pyqPdfDiscovered, pyqPdfApproved),
          totalPdfsProcessed: pyqPdfApproved,
          nativeTextPdfs: await PyqDocument.countDocuments({
            $or: [
              { extractionMethod: 'native_text' },
              { extractionMethod: { $exists: false }, isScannedPdf: false }
            ]
          }),
          scannedPdfs: await PyqDocument.countDocuments({
            $or: [
              { extractionMethod: 'vision' },
              { isScannedPdf: true }
            ]
          }),
          totalQuestionsExtracted: totalQuestions,
          totalChunks,
          totalQdrantVectors: totalChunks,
          duplicatePdfs: pyqPdfSkipped,
          failedPdfs: pyqPdfFailed,
          pendingPdfs: pyqPdfPending,
          lastFullSync: lastFullSync?.completedAt || null,
          lastIncrementalSync: lastIncrSync?.completedAt || null,
          activeJob: activePyqJob
            ? {
                id: activePyqJob._id,
                syncType: activePyqJob.syncType,
                metrics: activePyqJob.metrics,
                startedAt: activePyqJob.startedAt,
              }
            : null,
        },
        officialCrawler: {
          baseUrl: process.env.NIT_KKR_BASE_URL || 'https://nitkkr.ac.in/',
          urlsDiscovered: officialUrlsDiscovered,
          pagesCrawled: officialPagesCrawled,
          pdfsDiscovered: officialDocsProcessed + officialDocsFailed,
          documentsProcessed: officialDocsProcessed,
          documentsUpdated: lastOfficialJob?.metrics?.documentsUpdated || 0,
          documentsSkipped: lastOfficialJob?.metrics?.pagesSkipped || 0,
          failedUrls: officialDocsFailed,
          totalCrawlJobs: officialCrawlJobs,
          lastCrawl: lastOfficialJob?.completedAt || null,
          lastIncrementalCrawl: lastOfficialJob?.completedAt || null,
          activeJob: activeOfficialJob
            ? {
                id: activeOfficialJob._id,
                metrics: activeOfficialJob.metrics,
                startedAt: activeOfficialJob.startedAt,
              }
            : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pyq/sync
 * Trigger Full Public Google Drive Sync
 */
export const startFullPyqSync = async (req, res, next) => {
  try {
    const customUrl = req.body?.folderUrl || null;
    const job = await startDriveSync('FULL_SYNC', req.user?._id, customUrl);

    return res.status(202).json({
      success: true,
      message: 'Full Google Drive PYQ Sync initiated successfully.',
      data: {
        jobId: job._id,
        syncType: job.syncType,
        status: job.status,
        rootFolderUrl: job.rootFolderUrl,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pyq/sync/incremental
 * Trigger Incremental Public Google Drive Sync
 */
export const startIncrementalPyqSync = async (req, res, next) => {
  try {
    const customUrl = req.body?.folderUrl || null;
    const job = await startDriveSync('INCREMENTAL_SYNC', req.user?._id, customUrl);

    return res.status(202).json({
      success: true,
      message: 'Incremental Google Drive PYQ Sync initiated successfully.',
      data: {
        jobId: job._id,
        syncType: job.syncType,
        status: job.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pyq/sync/status
 * Get status and logs of latest/running PYQ Sync job
 */
export const getPyqSyncStatus = async (req, res, next) => {
  try {
    const jobId = req.query.jobId;
    let job;
    if (jobId) {
      job = await PyqSyncJob.findById(jobId);
    } else {
      job = await getLatestSyncJob();
    }

    if (!job) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No PYQ Sync jobs found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pyq/documents
 * List paginated PYQ documents with rich filters (branch, semester, year, status, search)
 */
export const getPyqDocuments = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const query = {};

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.branch && req.query.branch !== 'all') {
      query.$or = [
        { 'documentMetadata.branch': new RegExp(req.query.branch.trim(), 'i') },
        { 'folderMetadata.branch': new RegExp(req.query.branch.trim(), 'i') },
      ];
    }

    if (req.query.semester && req.query.semester !== 'all') {
      const sem = parseInt(req.query.semester, 10);
      if (!isNaN(sem)) {
        query.$or = [
          { 'documentMetadata.semester': sem },
          { 'folderMetadata.semester': sem },
        ];
      }
    }

    if (req.query.year && req.query.year !== 'all') {
      const yr = parseInt(req.query.year, 10);
      if (!isNaN(yr)) {
        query.$or = [
          { 'documentMetadata.examYear': yr },
          { 'folderMetadata.year': yr },
        ];
      }
    }

    if (req.query.search && req.query.search.trim()) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      const textFilters = [
        { name: searchRegex },
        { 'documentMetadata.courseName': searchRegex },
        { 'documentMetadata.courseCode': searchRegex },
        { driveFolderPath: searchRegex },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: textFilters }];
        delete query.$or;
      } else {
        query.$or = textFilters;
      }
    }

    const [documents, total] = await Promise.all([
      PyqDocument.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PyqDocument.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        documents,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/pyq/documents/:id
 * Retrieve full details of a single PYQ document including questions & Drive link
 */
export const getPyqDocumentById = async (req, res, next) => {
  try {
    const doc = await PyqDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'PYQ Document not found' });
    }
    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pyq/review/:id
 * Quality Control review: approve or reject a PYQ document
 */
export const reviewPyqDocument = async (req, res, next) => {
  try {
    const { status, reviewNotes, courseCode, courseName, semester, examYear } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const doc = await PyqDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'PYQ Document not found' });
    }

    doc.status = status;
    if (reviewNotes !== undefined) doc.reviewNotes = reviewNotes;
    if (courseCode) doc.documentMetadata.courseCode = courseCode.toUpperCase().trim();
    if (courseName) doc.documentMetadata.courseName = courseName.trim();
    if (semester) doc.documentMetadata.semester = parseInt(semester, 10);
    if (examYear) doc.documentMetadata.examYear = parseInt(examYear, 10);

    await doc.save();

    return res.status(200).json({
      success: true,
      message: `PYQ Document successfully updated to "${status}".`,
      data: doc,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pyq/reprocess/:id
 * Force reprocess a single PYQ document
 */
export const reprocessPyqDocument = async (req, res, next) => {
  try {
    const doc = await PyqDocument.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'PYQ Document not found' });
    }

    const download = await driveClient.downloadPublicDrivePdf(doc.fileId);
    const result = await pyqProcessor.processDrivePdf(
      {
        id: doc.fileId,
        name: doc.name,
        webViewLink: doc.webViewLink,
        webContentLink: doc.webContentLink,
        mimeType: doc.mimeType,
      },
      download.buffer,
      doc.driveFolderPath,
      doc.folderMetadata
    );

    return res.status(200).json({
      success: true,
      message: 'PYQ Document re-processed and re-indexed successfully.',
      data: result.doc,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/pyq/sync/stop
 * Stop Active Public Google Drive Sync
 */
export const stopPyqSync = async (req, res, next) => {
  try {
    const { jobId } = req.body || {};
    const stopped = await stopDriveSync(jobId);
    return res.status(200).json({
      success: true,
      message: 'Google Drive PYQ sync stopped successfully.',
      data: { stoppedCount: stopped.length },
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getKnowledgeStats,
  startFullPyqSync,
  startIncrementalPyqSync,
  stopPyqSync,
  getPyqSyncStatus,
  getPyqDocuments,
  getPyqDocumentById,
  reviewPyqDocument,
  reprocessPyqDocument,
};
