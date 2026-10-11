import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../../services/api';
import {
  Globe,
  Plus,
  Play,
  Square,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  ExternalLink,
  Layers,
  Terminal,
} from 'lucide-react';

const CrawlerManagement = () => {
  const [sources, setSources] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [runningJobSourceId, setRunningJobSourceId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  // Modals
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [sourceFormError, setSourceFormError] = useState('');
  const [sourceForm, setSourceForm] = useState({
    name: 'NIT KKR Academic Notifications',
    baseUrl: 'https://nitkkr.ac.in/academic-notifications/',
    allowedDomains: 'nitkkr.ac.in',
    allowedPathPrefixes: '/academic-notifications/',
    priority: 'high',
    studentKnowledgeBaseOnly: true,
    sourceAuthority: 'official',
    academicYear: '2025-26',
    maxPagesPerRun: 25,
    requestDelayMs: 1000,
    defaultCategory: 'academics',
    defaultDepartment: 'General',
    enabled: true,
  });

  // Selected Job for Logs Modal
  const [selectedJob, setSelectedJob] = useState(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [loadingJobDetails, setLoadingJobDetails] = useState(false);

  // 1. Fetch Sources
  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await adminAPI.getCrawlerSources();
      if (res?.data?.sources) {
        setSources(res.data.sources);
      }
    } catch (err) {
      console.error('Failed to load crawler sources:', err);
      setFeedback({ type: 'error', message: err.message || 'Failed to load website sources' });
    } finally {
      setLoadingSources(false);
    }
  }, []);

  // 2. Fetch Crawl Jobs
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await adminAPI.getCrawlJobs({ limit: 10 });
      if (res?.data?.jobs) {
        setJobs(res.data.jobs);
      }
    } catch (err) {
      console.error('Failed to load crawl jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
    fetchJobs();
    // Auto-refresh jobs every 8 seconds if there's any active running job
    const interval = setInterval(() => {
      fetchJobs();
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchSources, fetchJobs]);

  // Handle Trigger Crawl
  const handleRunCrawl = async (source) => {
    if (runningJobSourceId) return;
    setRunningJobSourceId(source._id);
    setFeedback(null);

    try {
      const res = await adminAPI.runCrawlerSource(source._id);
      setFeedback({
        type: 'success',
        message: `Polite 2025-26 crawl initiated for "${source.name}". Running in background.`,
      });
      fetchSources();
      fetchJobs();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to start crawl job' });
    } finally {
      setRunningJobSourceId(null);
    }
  };

  // Handle Stop / Reset Crawl
  const handleStopCrawl = async (source) => {
    try {
      await adminAPI.stopCrawlerSource(source._id);
      setFeedback({
        type: 'success',
        message: `Crawl status for "${source.name}" reset successfully.`,
      });
      fetchSources();
      fetchJobs();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to stop crawl job' });
    }
  };

  // Toggle Source Enabled
  const handleToggleEnable = async (source) => {
    try {
      await adminAPI.updateCrawlerSource(source._id, { enabled: !source.enabled });
      setFeedback({
        type: 'success',
        message: `Source "${source.name}" ${!source.enabled ? 'Enabled' : 'Disabled'}.`,
      });
      fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update source' });
    }
  };

  // Delete Source
  const handleDeleteSource = async (source) => {
    if (!window.confirm(`Are you sure you want to delete website source "${source.name}"?`)) return;
    try {
      await adminAPI.deleteCrawlerSource(source._id);
      setFeedback({ type: 'success', message: `Source "${source.name}" deleted.` });
      fetchSources();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete source' });
    }
  };

  // Create Source
  const handleCreateSource = async (e) => {
    e.preventDefault();
    setCreatingSource(true);
    setSourceFormError('');

    try {
      const domains = sourceForm.allowedDomains.split(',').map((d) => d.trim()).filter(Boolean);
      const prefixes = sourceForm.allowedPathPrefixes.split(',').map((p) => p.trim()).filter(Boolean);

      await adminAPI.createCrawlerSource({
        name: sourceForm.name.trim(),
        baseUrl: sourceForm.baseUrl.trim(),
        allowedDomains: domains,
        allowedPathPrefixes: prefixes,
        priority: sourceForm.priority || 'high',
        studentKnowledgeBaseOnly: Boolean(sourceForm.studentKnowledgeBaseOnly),
        sourceAuthority: sourceForm.sourceAuthority,
        academicYear: sourceForm.academicYear.trim() || '2025-26',
        maxPagesPerRun: Number(sourceForm.maxPagesPerRun),
        requestDelayMs: Number(sourceForm.requestDelayMs),
        defaultCategory: sourceForm.defaultCategory,
        defaultDepartment: sourceForm.defaultDepartment,
        enabled: sourceForm.enabled,
      });

      setFeedback({ type: 'success', message: `Source "${sourceForm.name}" created!` });
      setShowAddSourceModal(false);
      fetchSources();
    } catch (err) {
      setSourceFormError(err.message || 'Failed to create website source');
    } finally {
      setCreatingSource(false);
    }
  };

  // View Job Logs
  const handleViewJobLogs = async (jobId) => {
    setShowLogsModal(true);
    setLoadingJobDetails(true);
    try {
      const res = await adminAPI.getCrawlJobById(jobId);
      if (res?.data?.job) {
        setSelectedJob(res.data.job);
      }
    } catch (err) {
      console.error('Failed to load job details:', err);
    } finally {
      setLoadingJobDetails(false);
    }
  };

  const formatDuration = (start, end) => {
    if (!start) return '—';
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const sec = Math.floor((e - s) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl bg-gradient-to-r from-blue-950/40 via-campus-surface to-campus-surface border border-blue-500/30">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Official NIT KKR Public Website Crawler (Academic Year: 2025–26)
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-400" />
            Official NIT KKR Document Crawler & Automated Ingestion
          </h2>
          <p className="text-xs text-campus-muted max-w-2xl leading-relaxed">
            Polite, controlled web crawler for official NIT Kurukshetra public portals. Ingests <strong>only</strong> documents belonging to the <strong>2025–26</strong> academic period. Historical documents and unknown-year notices are automatically skipped.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddSourceModal(true)}
            className="campus-btn-primary bg-blue-600 hover:bg-blue-500 shadow-blue-500/20 text-xs py-2 px-3"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Website Source
          </button>
          <button
            onClick={() => {
              fetchSources();
              fetchJobs();
            }}
            disabled={loadingSources || loadingJobs}
            className="campus-btn-secondary text-xs py-2 px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingSources || loadingJobs ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center justify-between gap-2 ${feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-campus-muted hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 1: CONFIGURED WEBSITE SOURCES */}
      {/* ---------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            Configured Public Website Sources ({sources.length})
          </h3>
        </div>

        <div className="campus-card overflow-hidden">
          {loadingSources && sources.length === 0 ? (
            <div className="p-8 text-center text-xs text-campus-muted">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
              Loading website sources...
            </div>
          ) : sources.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Globe className="w-10 h-10 text-campus-muted mx-auto" />
              <p className="text-xs text-campus-muted">No website sources configured.</p>
              <button
                onClick={() => setShowAddSourceModal(true)}
                className="campus-btn-primary text-xs mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Official Source
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-campus-surface/80 border-b border-campus-border text-campus-muted font-mono uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Source Name</th>
                    <th className="py-3 px-4">Base Portal URL</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Target AY</th>
                    <th className="py-3 px-4">Allowed Domains & Prefixes</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Last Crawl</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-campus-border/60">
                  {sources.map((src) => (
                    <tr key={src._id} className="hover:bg-campus-card/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white">{src.name}</div>
                        <div className="text-[10px] font-mono text-campus-muted">
                          Rate limit: {src.requestDelayMs || 1000}ms • Max: {src.maxPagesPerRun || 25} pgs
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <a
                          href={src.baseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline inline-flex items-center gap-1"
                        >
                          {src.baseUrl} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${src.priority === 'high'
                              ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                              : src.priority === 'medium'
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                            }`}
                        >
                          {src.priority || 'high'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {src.academicYear}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[10px] text-campus-muted max-w-xs truncate">
                        <div>Domains: {(src.allowedDomains || []).join(', ')}</div>
                        <div>Paths: {(src.allowedPathPrefixes || []).join(', ')}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => handleToggleEnable(src)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${src.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                              : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 hover:bg-zinc-500/20'
                            }`}
                        >
                          {src.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-campus-muted font-mono text-[11px]">
                        {src.lastCrawlAt ? (
                          <div>
                            <div>{new Date(src.lastCrawlAt).toLocaleDateString()}</div>
                            <span
                              className={`text-[9px] uppercase font-bold ${src.lastCrawlStatus === 'completed'
                                  ? 'text-emerald-400'
                                  : src.lastCrawlStatus === 'running'
                                    ? 'text-blue-400 animate-pulse'
                                    : 'text-zinc-400'
                                }`}
                            >
                              {src.lastCrawlStatus}
                            </span>
                          </div>
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {src.lastCrawlStatus === 'running' ? (
                            <button
                              onClick={() => handleStopCrawl(src)}
                              className="campus-btn-secondary border-red-500/40 text-red-400 hover:bg-red-500/10 text-xs py-1 px-2.5 inline-flex items-center gap-1"
                              title="Stop active crawl and reset status to idle/failed"
                            >
                              <Square className="w-3 h-3 text-red-400 fill-red-400" />
                              Stop / Reset
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRunCrawl(src)}
                              disabled={!src.enabled || runningJobSourceId === src._id}
                              className="campus-btn-primary bg-blue-600 hover:bg-blue-500 shadow-blue-500/20 text-xs py-1 px-2.5 disabled:opacity-50"
                              title={!src.enabled ? 'Source is disabled. Click the DISABLED badge to enable it first.' : 'Run polite crawl now'}
                            >
                              <Play className="w-3 h-3" />
                              Run Crawl
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteSource(src)}
                            className="p-1.5 rounded text-campus-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete source"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- */}
      {/* SECTION 2: CRAWL JOBS HISTORY & METRICS */}
      {/* ---------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            Crawl Jobs History & Real Ingestion Metrics
          </h3>
          <button
            onClick={fetchJobs}
            disabled={loadingJobs}
            className="campus-btn-secondary text-[11px] py-1 px-2.5"
          >
            <RefreshCw className={`w-3 h-3 ${loadingJobs ? 'animate-spin' : ''}`} />
            Refresh Jobs
          </button>
        </div>

        <div className="campus-card overflow-hidden">
          {loadingJobs && jobs.length === 0 ? (
            <div className="p-8 text-center text-xs text-campus-muted">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
              Loading crawl execution history...
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-10 text-center text-xs text-campus-muted">
              No crawl executions recorded yet. Run a crawl to ingest 2025-26 documents.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-campus-surface/80 border-b border-campus-border text-campus-muted font-mono uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Status & Source</th>
                    <th className="py-3 px-4">Target AY</th>
                    <th className="py-3 px-4">Timing & Duration</th>
                    <th className="py-3 px-4">PDFs Discovered</th>
                    <th className="py-3 px-4">2025-26 Accepted</th>
                    <th className="py-3 px-4">Skipped (Old / Unknown)</th>
                    <th className="py-3 px-4">Ingestion Results</th>
                    <th className="py-3 px-4 text-right">Logs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-campus-border/60">
                  {jobs.map((j) => (
                    <tr key={j._id} className="hover:bg-campus-card/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${j.status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : j.status === 'running'
                                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 animate-pulse'
                                  : j.status === 'queued'
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                              }`}
                          >
                            {j.status}
                          </span>
                          <span className="font-semibold text-white">
                            {j.websiteSourceId?.name || 'NIT KKR Source'}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-campus-muted mt-0.5">
                          Job #{j._id.slice(-6)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-blue-300">
                        {j.academicYear}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div>{new Date(j.createdAt).toLocaleTimeString()}</div>
                        <div className="text-[10px] text-campus-muted">
                          {formatDuration(j.startedAt, j.completedAt)}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-center">
                        <span className="font-bold text-white">{j.metrics?.pdfsDiscovered ?? 0}</span>
                        <div className="text-[10px] text-campus-muted">
                          {j.metrics?.pagesFetched ?? 0} pgs
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-center">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                          {j.metrics?.pdfsEligible ?? 0} eligible
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="text-amber-400 font-medium">
                          Old Year: {j.metrics?.pdfsSkippedOldYear ?? 0}
                        </div>
                        <div className="text-zinc-400 text-[10px]">
                          Unknown: {j.metrics?.pdfsYearUnknown ?? 0}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="text-emerald-300">
                          +{j.metrics?.documentsCreated ?? 0} new • ~{j.metrics?.documentsUpdated ?? 0} updated
                        </div>
                        <div className="text-[10px] text-campus-muted">
                          {j.metrics?.documentsUnchanged ?? 0} unchanged • {j.metrics?.documentsDeduplicated ?? 0} dedup
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleViewJobLogs(j._id)}
                          className="campus-btn-secondary text-[11px] py-1 px-2.5 inline-flex items-center gap-1"
                        >
                          <Terminal className="w-3 h-3 text-purple-400" />
                          View Logs
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- */}
      {/* MODAL 1: ADD WEBSITE SOURCE */}
      {/* ---------------------------------------------------- */}
      {showAddSourceModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in">
          <div className="campus-card max-w-lg w-full p-6 relative border-blue-500/30 my-8">
            <button
              onClick={() => setShowAddSourceModal(false)}
              className="absolute top-4 right-4 text-campus-muted hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Add NIT KKR Public Website Source</h3>
                <p className="text-xs text-campus-muted">Configure an approved public section for 2025-26</p>
              </div>
            </div>

            {sourceFormError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{sourceFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSource} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-campus-subtext mb-1">
                  Source Name *
                </label>
                <input
                  type="text"
                  value={sourceForm.name}
                  onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                  placeholder="e.g. NIT KKR Academic Notifications"
                  required
                  className="campus-input text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-campus-subtext mb-1">
                  Base URL *
                </label>
                <input
                  type="url"
                  value={sourceForm.baseUrl}
                  onChange={(e) => setSourceForm({ ...sourceForm, baseUrl: e.target.value })}
                  placeholder="https://nitkkr.ac.in/academic-notifications/"
                  required
                  className="campus-input text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-campus-subtext mb-1">
                    Allowed Domains (comma-separated) *
                  </label>
                  <input
                    type="text"
                    value={sourceForm.allowedDomains}
                    onChange={(e) => setSourceForm({ ...sourceForm, allowedDomains: e.target.value })}
                    required
                    className="campus-input text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-campus-subtext mb-1">
                    Target Academic Year *
                  </label>
                  <input
                    type="text"
                    value={sourceForm.academicYear}
                    onChange={(e) => setSourceForm({ ...sourceForm, academicYear: e.target.value })}
                    required
                    className="campus-input text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-campus-subtext mb-1">
                  Allowed Path Prefixes (comma-separated)
                </label>
                <input
                  type="text"
                  value={sourceForm.allowedPathPrefixes}
                  onChange={(e) => setSourceForm({ ...sourceForm, allowedPathPrefixes: e.target.value })}
                  placeholder="/academic-notifications/, /wp-content/uploads/"
                  className="campus-input text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-campus-subtext mb-1">
                    Crawl Priority
                  </label>
                  <select
                    value={sourceForm.priority}
                    onChange={(e) => setSourceForm({ ...sourceForm, priority: e.target.value })}
                    className="campus-input text-xs"
                  >
                    <option value="high">High Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-campus-subtext mb-1">
                    Max Pages per Run
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={sourceForm.maxPagesPerRun}
                    onChange={(e) => setSourceForm({ ...sourceForm, maxPagesPerRun: e.target.value })}
                    className="campus-input text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-campus-subtext mb-1">
                  Polite Request Delay (ms)
                </label>
                <input
                  type="number"
                  min="200"
                  max="10000"
                  step="100"
                  value={sourceForm.requestDelayMs}
                  onChange={(e) => setSourceForm({ ...sourceForm, requestDelayMs: e.target.value })}
                  className="campus-input text-xs font-mono"
                />
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="studentKnowledgeBaseOnly"
                    checked={sourceForm.studentKnowledgeBaseOnly}
                    onChange={(e) => setSourceForm({ ...sourceForm, studentKnowledgeBaseOnly: e.target.checked })}
                    className="rounded border-campus-border text-purple-600 focus:ring-purple-500 bg-campus-surface"
                  />
                  <label htmlFor="studentKnowledgeBaseOnly" className="text-xs text-purple-300">
                    Student Knowledge Base Only (Exclude purely administrative recruitment/tenders)
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="sourceEnabled"
                    checked={sourceForm.enabled}
                    onChange={(e) => setSourceForm({ ...sourceForm, enabled: e.target.checked })}
                    className="rounded border-campus-border text-blue-600 focus:ring-blue-500 bg-campus-surface"
                  />
                  <label htmlFor="sourceEnabled" className="text-xs text-campus-subtext">
                    Enable Source for Immediate Crawling
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-campus-border">
                <button
                  type="button"
                  onClick={() => setShowAddSourceModal(false)}
                  className="campus-btn-secondary text-xs py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingSource}
                  className="campus-btn-primary bg-blue-600 hover:bg-blue-500 text-xs py-2"
                >
                  {creatingSource ? 'Creating...' : 'Create Website Source'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* MODAL 2: VIEW CRAWL JOB LOGS & DECISION AUDIT */}
      {/* ---------------------------------------------------- */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in">
          <div className="campus-card max-w-3xl w-full p-6 relative border-purple-500/30 my-8">
            <button
              onClick={() => {
                setShowLogsModal(false);
                setSelectedJob(null);
              }}
              className="absolute top-4 right-4 text-campus-muted hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-white">
                  Crawl Audit Logs & Decision Trace {selectedJob && `(Job #${selectedJob._id.slice(-6)})`}
                </h3>
                <p className="text-xs text-campus-muted">
                  Audits URL discovery, year evaluation decisions, and deduplication
                </p>
              </div>
            </div>

            {loadingJobDetails ? (
              <div className="p-12 text-center text-xs text-campus-muted">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
                Loading crawl logs...
              </div>
            ) : selectedJob ? (
              <div className="space-y-4">
                {/* Metrics Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono text-xs">
                  <div className="p-2 rounded bg-campus-bg border border-campus-border">
                    <span className="text-[10px] text-campus-muted block">Discovered</span>
                    <strong className="text-white">{selectedJob.metrics?.pdfsDiscovered ?? 0} PDFs</strong>
                  </div>
                  <div className="p-2 rounded bg-campus-bg border border-campus-border">
                    <span className="text-[10px] text-campus-muted block">2025-26 Eligible</span>
                    <strong className="text-emerald-400">{selectedJob.metrics?.pdfsEligible ?? 0}</strong>
                  </div>
                  <div className="p-2 rounded bg-campus-bg border border-campus-border">
                    <span className="text-[10px] text-campus-muted block">Skipped Old Year</span>
                    <strong className="text-amber-400">{selectedJob.metrics?.pdfsSkippedOldYear ?? 0}</strong>
                  </div>
                  <div className="p-2 rounded bg-campus-bg border border-campus-border">
                    <span className="text-[10px] text-campus-muted block">Ingested New</span>
                    <strong className="text-blue-400">{selectedJob.metrics?.documentsCreated ?? 0}</strong>
                  </div>
                </div>

                {/* Log Terminal Window */}
                <div className="p-3 rounded-lg bg-black/60 border border-campus-border/60 max-h-96 overflow-y-auto font-mono text-[11px] space-y-2">
                  {selectedJob.logs && selectedJob.logs.length > 0 ? (
                    selectedJob.logs.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-campus-muted text-[10px] flex-shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`text-[9px] uppercase px-1 rounded flex-shrink-0 font-bold ${log.level === 'error'
                              ? 'bg-red-500/20 text-red-400'
                              : log.level === 'warn'
                                ? 'bg-amber-500/20 text-amber-400'
                                : log.level === 'info' && log.message.includes('ACCEPTED')
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : log.level === 'info' && log.message.includes('SKIP')
                                    ? 'bg-amber-500/10 text-amber-300'
                                    : 'bg-campus-surface text-campus-subtext'
                            }`}
                        >
                          {log.level}
                        </span>
                        <div className="flex-1 break-all">
                          <span
                            className={
                              log.message.includes('ACCEPTED')
                                ? 'text-emerald-300 font-semibold'
                                : log.message.includes('exceeds maximum page limit')
                                  ? 'text-rose-400 font-semibold'
                                  : log.message.includes('OUTSIDE_TARGET_ACADEMIC_YEAR')
                                    ? 'text-amber-300'
                                    : log.message.includes('YEAR_UNKNOWN')
                                      ? 'text-zinc-400 italic'
                                      : 'text-campus-text'
                            }
                          >
                            {log.message}
                          </span>
                          {log.url && (
                            <div className="text-[10px] text-blue-400/80 truncate">{log.url}</div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-campus-muted italic text-center p-4">No logs recorded for this job.</div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setShowLogsModal(false);
                      setSelectedJob(null);
                    }}
                    className="campus-btn-secondary text-xs py-1.5 px-4"
                  >
                    Close Log Viewer
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default CrawlerManagement;
