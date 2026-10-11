import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../../services/api';
import CrawlerManagement from './CrawlerManagement';
import {
  FolderArchive,
  Globe,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  Check,
  X,
  Eye,
  RotateCcw,
  Database,
  Square,
} from 'lucide-react';

const KnowledgeManagement = () => {
  const [activeSection, setActiveSection] = useState('pyq'); // 'pyq' | 'crawler'
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [syncingPyq, setSyncingPyq] = useState(false);
  const [customFolderUrl, setCustomFolderUrl] = useState('');
  const [feedback, setFeedback] = useState(null);

  // PYQ Documents table state
  const [pyqDocs, setPyqDocs] = useState([]);
  const [loadingPyqDocs, setLoadingPyqDocs] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [searchFilter, setSearchFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Preview / Review Modal state
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [showDocModal, setShowDocModal] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // 1. Fetch Knowledge Stats (Dual section stats)
  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await adminAPI.getKnowledgeStats();
      if (res?.data) {
        setStats(res.data);
      }
    } catch (err) {
      console.error('Failed to load knowledge stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  // 2. Fetch PYQ Documents
  const fetchPyqDocs = useCallback(async () => {
    setLoadingPyqDocs(true);
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        status: statusFilter,
        branch: branchFilter,
        semester: semesterFilter,
        year: yearFilter,
        search: searchFilter,
      };
      const res = await adminAPI.getPyqDocuments(params);
      if (res?.data) {
        setPyqDocs(res.data.documents || []);
        if (res.data.pagination) setPagination(res.data.pagination);
      }
    } catch (err) {
      console.error('Failed to load PYQ documents:', err);
    } finally {
      setLoadingPyqDocs(false);
    }
  }, [pagination.page, pagination.limit, statusFilter, branchFilter, semesterFilter, yearFilter, searchFilter]);

  const hasActiveJob = Boolean(
    stats?.pyqDrive?.activeJob?.id ||
    stats?.pyqDrive?.activeJob ||
    stats?.officialCrawler?.activeJob?.id ||
    stats?.officialCrawler?.activeJob
  );

  useEffect(() => {
    fetchStats();
    fetchPyqDocs();
  }, [fetchStats, fetchPyqDocs]);

  useEffect(() => {
    const intervalTime = hasActiveJob ? 3500 : 10000;
    const interval = setInterval(() => {
      fetchStats();
    }, intervalTime);
    return () => clearInterval(interval);
  }, [fetchStats, hasActiveJob]);

  // Sync Trigger Handlers
  const handleStartSync = async (isIncremental = false) => {
    setSyncingPyq(true);
    setFeedback(null);
    try {
      const fn = isIncremental ? adminAPI.startIncrementalPyqSync : adminAPI.startFullPyqSync;
      const res = await fn(customFolderUrl ? customFolderUrl.trim() : null);
      setFeedback({
        type: 'success',
        message: `${isIncremental ? 'Incremental' : 'Full'} PYQ Drive sync started! Job ID: ${res.data?.jobId}`,
      });
      fetchStats();
      setTimeout(fetchPyqDocs, 3000);
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to start PYQ sync.' });
    } finally {
      setSyncingPyq(false);
    }
  };

  // Stop Sync Handler
  const handleStopSync = async () => {
    if (!window.confirm('Are you sure you want to stop the current Google Drive PYQ sync?')) return;
    setSyncingPyq(true);
    try {
      await adminAPI.stopPyqSync(stats?.pyqDrive?.activeJob?.id);
      setFeedback({ type: 'success', message: 'Google Drive sync stopped successfully.' });
      await fetchStats();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to stop sync.' });
    } finally {
      setSyncingPyq(false);
    }
  };

  // Review status handler
  const handleReviewDoc = async (id, newStatus) => {
    setUpdatingStatus(true);
    try {
      await adminAPI.reviewPyqDocument(id, { status: newStatus });
      setFeedback({ type: 'success', message: `Document updated to ${newStatus}!` });
      fetchPyqDocs();
      if (selectedDoc && selectedDoc._id === id) {
        setSelectedDoc((prev) => ({ ...prev, status: newStatus }));
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update review status.' });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleReprocessDoc = async (id) => {
    if (!window.confirm('Reprocess and re-embed this question paper from Google Drive?')) return;
    try {
      await adminAPI.reprocessPyqDocument(id);
      setFeedback({ type: 'success', message: 'Document re-processed and re-indexed successfully!' });
      fetchPyqDocs();
      fetchStats();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to reprocess document.' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-campus-card border border-campus-border/70">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            Knowledge Ingestion & Synchronization Engine
          </h2>
          <p className="text-xs text-campus-muted mt-1">
            Dual ingestion pipeline: Public Google Drive PYQ repository and Official NIT Kurukshetra website crawler.
          </p>
        </div>

        <button
          onClick={() => {
            fetchStats();
            fetchPyqDocs();
          }}
          disabled={loadingStats}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-campus-surface hover:bg-campus-border border border-campus-border transition-colors self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-campus-muted ${loadingStats ? 'animate-spin' : ''}`} />
          Refresh Stats
        </button>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Sub-navigation Tabs: PYQ Drive vs NIT Web Crawler */}
      <div className="flex items-center gap-2 border-b border-campus-border/70 pb-3">
        <button
          onClick={() => setActiveSection('pyq')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            activeSection === 'pyq'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
              : 'text-campus-muted hover:text-white hover:bg-campus-surface'
          }`}
        >
          <FolderArchive className="w-4 h-4 text-blue-300" />
          <span>Google Drive PYQ Ingestion & Papers</span>
          {stats?.pyqDrive?.activeJob && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-400 text-black font-bold animate-pulse">
              SYNCING
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSection('crawler')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
            activeSection === 'crawler'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'text-campus-muted hover:text-white hover:bg-campus-surface'
          }`}
        >
          <Globe className="w-4 h-4 text-emerald-300" />
          <span>Official NIT KKR Web Crawler</span>
          {stats?.officialCrawler?.activeJob && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-400 text-black font-bold animate-pulse">
              CRAWLING
            </span>
          )}
        </button>
      </div>

      {activeSection === 'crawler' ? (
        <CrawlerManagement />
      ) : (
        <>
          {/* SECTION 1: PUBLIC PYQ DRIVE */}
          <div className="p-5 rounded-xl bg-campus-card border border-campus-border flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-campus-border/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
                    <FolderArchive className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Public PYQ Google Drive Ingestion</h3>
                    <span className="text-[10px] text-blue-400/90 font-mono">sourceType: student_drive (Community Question Papers)</span>
                  </div>
                </div>

                {stats?.pyqDrive?.activeJob && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Sync Running
                    </span>
                    <button
                      onClick={handleStopSync}
                      disabled={syncingPyq}
                      title="Stop running sync"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs transition-colors"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      Stop
                    </button>
                  </div>
                )}
              </div>

              {/* Live Progress Banner */}
              {stats?.pyqDrive?.activeJob?.metrics?.statusMessage && (
                <div className="mt-2.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs text-blue-300">
                  <span className="flex items-center gap-2 truncate">
                    <RefreshCw className="w-3 h-3 animate-spin text-blue-400 flex-shrink-0" />
                    <span className="truncate">{stats.pyqDrive.activeJob.metrics.statusMessage}</span>
                  </span>
                  {stats.pyqDrive.activeJob.metrics.currentPhase && (
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-200 ml-2 flex-shrink-0">
                      {stats.pyqDrive.activeJob.metrics.currentPhase}
                    </span>
                  )}
                </div>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 my-4">
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-campus-muted uppercase font-mono">Folders</p>
                  <p className="text-base font-bold text-white mt-0.5">{stats?.pyqDrive?.totalFolders || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-campus-muted uppercase font-mono">Discovered</p>
                  <p className="text-base font-bold text-white mt-0.5">{stats?.pyqDrive?.totalPdfsDiscovered || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-emerald-400 uppercase font-mono">Processed</p>
                  <p className="text-base font-bold text-emerald-300 mt-0.5">{stats?.pyqDrive?.totalPdfsProcessed || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-teal-400 uppercase font-mono">Native Text</p>
                  <p className="text-base font-bold text-teal-300 mt-0.5">{stats?.pyqDrive?.nativeTextPdfs || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-amber-400 uppercase font-mono">Scanned Vision</p>
                  <p className="text-base font-bold text-amber-300 mt-0.5">{stats?.pyqDrive?.scannedPdfs || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-purple-400 uppercase font-mono">Questions</p>
                  <p className="text-base font-bold text-purple-300 mt-0.5">{stats?.pyqDrive?.totalQuestionsExtracted || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-blue-400 uppercase font-mono">Qdrant Vectors</p>
                  <p className="text-base font-bold text-blue-300 mt-0.5">{stats?.pyqDrive?.totalQdrantVectors || 0}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-campus-surface/60 border border-campus-border/50 text-center">
                  <p className="text-[11px] text-campus-muted uppercase font-mono">Duplicates</p>
                  <p className="text-base font-bold text-zinc-300 mt-0.5">{stats?.pyqDrive?.duplicatePdfs || 0}</p>
                </div>
              </div>

              {/* Sync Dates & Config */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-campus-muted bg-campus-surface/40 p-3 rounded-lg border border-campus-border/40">
                <div className="flex justify-between">
                  <span>Last Full Sync:</span>
                  <span className="text-zinc-300 font-mono">
                    {stats?.pyqDrive?.lastFullSync
                      ? new Date(stats.pyqDrive.lastFullSync).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last Incremental Sync:</span>
                  <span className="text-zinc-300 font-mono">
                    {stats?.pyqDrive?.lastIncrementalSync
                      ? new Date(stats.pyqDrive.lastIncrementalSync).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between truncate">
                  <span>Configured URL:</span>
                  <span className="text-blue-400 truncate max-w-[200px]" title={stats?.pyqDrive?.configuredFolderUrl}>
                    {stats?.pyqDrive?.configuredFolderUrl || '.env PYQ_DRIVE_FOLDER_URL'}
                  </span>
                </div>
              </div>
            </div>

            {/* Sync Trigger Controls */}
            <div className="mt-4 pt-3 border-t border-campus-border/60 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customFolderUrl}
                  onChange={(e) => setCustomFolderUrl(e.target.value)}
                  placeholder="Optional override Drive folder URL..."
                  className="flex-1 bg-campus-surface border border-campus-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-campus-muted focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-2">
                {stats?.pyqDrive?.activeJob ? (
                  <button
                    onClick={handleStopSync}
                    disabled={syncingPyq}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white transition-colors shadow-sm"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop Running Sync
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleStartSync(false)}
                      disabled={syncingPyq}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors shadow-sm"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Start Full Sync
                    </button>
                    <button
                      onClick={() => handleStartSync(true)}
                      disabled={syncingPyq}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-campus-surface hover:bg-zinc-700 disabled:opacity-50 border border-campus-border text-zinc-200 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                      Incremental Sync
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

      {/* SECTION 3: PYQ REPOSITORY & QUALITY CONTROL REVIEW TABLE */}
      <div className="p-5 rounded-xl bg-campus-card border border-campus-border space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-campus-border/60 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <FolderArchive className="w-4 h-4 text-blue-400" />
              Ingested Question Papers (PYQ Archive)
            </h3>
            <p className="text-xs text-campus-muted mt-0.5">
              Review extracted courses, semesters, question breakdown, and original Google Drive verification links.
            </p>
          </div>

          <span className="text-xs font-mono text-campus-muted">
            Total Papers: <strong className="text-white">{pagination.total}</strong>
          </span>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-campus-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search PYQ or Code..."
              className="w-full bg-campus-surface border border-campus-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="bg-campus-surface border border-campus-border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="all">All Branches</option>
            <option value="Computer">Computer Engineering</option>
            <option value="Information Technology">Information Technology</option>
            <option value="Electronics">ECE</option>
            <option value="Electrical">Electrical</option>
            <option value="Mechanical">Mechanical</option>
            <option value="Civil">Civil</option>
          </select>

          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            className="bg-campus-surface border border-campus-border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="all">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>

          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="bg-campus-surface border border-campus-border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="all">All Years</option>
            {[2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-campus-surface border border-campus-border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="all">All Review Statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending Review</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Papers Table */}
        <div className="overflow-x-auto border border-campus-border/60 rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-campus-border/80 bg-campus-surface/60 text-campus-muted font-mono uppercase text-[11px]">
                <th className="p-3">Paper / Subject</th>
                <th className="p-3">Course Code</th>
                <th className="p-3">Branch & Sem</th>
                <th className="p-3">Exam Year</th>
                <th className="p-3 text-center">Questions</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-campus-border/40">
              {loadingPyqDocs ? (
                <tr>
                  <td colSpan="7" className="p-6 text-center text-campus-muted">
                    <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" />
                    Loading question papers...
                  </td>
                </tr>
              ) : pyqDocs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-6 text-center text-campus-muted">
                    No question papers found matching filters. Trigger a Public Drive Sync to ingest papers.
                  </td>
                </tr>
              ) : (
                pyqDocs.map((doc) => {
                  const courseTitle =
                    doc.documentMetadata?.courseName || doc.name.replace(/\.pdf$/i, '');
                  const courseCode = doc.documentMetadata?.courseCode || '—';
                  const branch =
                    doc.documentMetadata?.branch || doc.folderMetadata?.branch || 'General';
                  const semester =
                    doc.documentMetadata?.semester || doc.folderMetadata?.semester || '—';
                  const year =
                    doc.documentMetadata?.examYear || doc.folderMetadata?.year || '—';

                  return (
                    <tr key={doc._id} className="hover:bg-campus-surface/40 transition-colors">
                      <td className="p-3">
                        <div className="font-medium text-white max-w-xs truncate" title={doc.name}>
                          {courseTitle}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase ${
                              doc.extractionMethod === 'vision'
                                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                : 'bg-teal-500/10 text-teal-300 border border-teal-500/20'
                            }`}
                          >
                            {doc.extractionMethod === 'vision' ? 'Scanned (Vision)' : 'Native Text'}
                          </span>
                          <span className="text-[10px] text-campus-muted truncate max-w-[200px]" title={doc.driveFolderPath}>
                            {doc.driveFolderPath}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 font-mono text-[11px] border border-blue-500/20">
                          {courseCode}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="text-zinc-200">{branch}</div>
                        <div className="text-[10px] text-campus-muted">Semester {semester}</div>
                      </td>
                      <td className="p-3 font-mono text-zinc-300">{year}</td>
                      <td className="p-3 text-center">
                        <span className="font-semibold text-purple-400">{doc.questionCount || 0}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            doc.status === 'approved'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : doc.status === 'rejected'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                              : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {doc.status}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Original Google Drive Link */}
                          <a
                            href={doc.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View Original Google Drive PDF"
                            className="p-1.5 rounded-md hover:bg-campus-surface text-campus-muted hover:text-blue-400 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>

                          {/* Preview Details Modal Button */}
                          <button
                            onClick={() => {
                              setSelectedDoc(doc);
                              setShowDocModal(true);
                            }}
                            title="Inspect Questions & Metadata"
                            className="p-1.5 rounded-md hover:bg-campus-surface text-campus-muted hover:text-white transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Reprocess */}
                          <button
                            onClick={() => handleReprocessDoc(doc._id)}
                            title="Reprocess Paper"
                            className="p-1.5 rounded-md hover:bg-campus-surface text-campus-muted hover:text-purple-400 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-campus-muted">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                className="px-2.5 py-1 text-xs rounded border border-campus-border bg-campus-surface disabled:opacity-40"
              >
                Prev
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                className="px-2.5 py-1 text-xs rounded border border-campus-border bg-campus-surface disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* QUESTION PREVIEW & REVIEW MODAL */}
      {showDocModal && selectedDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-campus-card border border-campus-border rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-campus-border">
              <div>
                <h3 className="text-sm font-semibold text-white">{selectedDoc.name}</h3>
                <p className="text-xs text-campus-muted font-mono mt-0.5">
                  Drive ID: {selectedDoc.fileId}
                </p>
              </div>
              <button
                onClick={() => setShowDocModal(false)}
                className="p-1 text-campus-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* Metadata Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg bg-campus-surface/50 border border-campus-border/50">
                <div>
                  <span className="text-campus-muted block text-[10px]">COURSE CODE</span>
                  <span className="font-mono font-semibold text-blue-400">
                    {selectedDoc.documentMetadata?.courseCode || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-campus-muted block text-[10px]">SEMESTER</span>
                  <span className="font-semibold text-white">
                    {selectedDoc.documentMetadata?.semester || selectedDoc.folderMetadata?.semester || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-campus-muted block text-[10px]">EXAM YEAR</span>
                  <span className="font-semibold text-white">
                    {selectedDoc.documentMetadata?.examYear || selectedDoc.folderMetadata?.year || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-campus-muted block text-[10px]">SOURCE TRUST</span>
                  <span className="font-semibold text-blue-300">
                    {selectedDoc.sourceTrust || 'community'}
                  </span>
                </div>
              </div>

              {/* Direct Verification Link */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between">
                <span className="text-blue-300 font-medium">Verify on Public Google Drive</span>
                <a
                  href={selectedDoc.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Original PDF
                </a>
              </div>

              {/* Extracted Questions list */}
              <div>
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-2">
                  Segmented Questions ({selectedDoc.questions?.length || 0})
                </h4>
                {selectedDoc.questions && selectedDoc.questions.length > 0 ? (
                  <div className="space-y-2">
                    {selectedDoc.questions.map((q, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-campus-surface/60 border border-campus-border/40 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-purple-400">
                          <span>Question {q.questionNumber}</span>
                          {q.marks && <span>{q.marks} Marks</span>}
                        </div>
                        <p className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
                          {q.questionText}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-campus-muted italic">No segmented questions recorded.</p>
                )}
              </div>
            </div>

            {/* Modal Review Actions */}
            <div className="p-3 border-t border-campus-border flex items-center justify-between bg-campus-surface/30">
              <span className="text-xs text-campus-muted">
                Current Status: <strong className="text-white uppercase">{selectedDoc.status}</strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  disabled={updatingStatus || selectedDoc.status === 'approved'}
                  onClick={() => handleReviewDoc(selectedDoc._id, 'approved')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
                >
                  <Check className="w-3.5 h-3.5" />
                  Approve
                </button>
                <button
                  disabled={updatingStatus || selectedDoc.status === 'rejected'}
                  onClick={() => handleReviewDoc(selectedDoc._id, 'rejected')}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/80 hover:bg-red-500 disabled:opacity-50 text-white"
                >
                  <X className="w-3.5 h-3.5" />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default KnowledgeManagement;
