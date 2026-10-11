import React, { useState } from 'react';
import { chatAPI } from '../../services/api';
import {
  Bot,
  Search,
  RefreshCw,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

const EXAMPLE_QUERIES = [
  'Find machine learning courses',
  'What is the attendance requirement for B.Tech students?',
  'When is registration?',
  'Find DBMS previous year papers',
  'Is attendance below 75% allowed for B.Tech CSE students?',
  'What does regulation 4.2.3 say?',
  'Show upcoming academic deadlines',
];

const DiagnosticsTab = () => {
  const [query, setQuery] = useState('What does section 1.2 say about medical condonation?');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRunDiagnostics = async (queryToRun) => {
    const q = queryToRun || query;
    if (!q.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await chatAPI.debug(q.trim());
      setResults(res.data);
    } catch (err) {
      setError(err.message || 'Retrieval diagnostics failed.');
    } finally {
      setLoading(false);
    }
  };

  const getStrategyBadge = (strategy) => {
    switch (strategy) {
      case 'structured':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'document_search':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'clarification':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'hybrid':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      default:
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-bold text-white tracking-tight">
            Query Routing & Retrieval Diagnostics
          </h2>
        </div>
      </div>

      <div className="campus-card p-6 space-y-4 border-purple-500/20">
        <p className="text-xs text-campus-muted">
          Test student queries against the Phase 6 Intelligent Query Router, intent classifier, entity extraction, and multi-stage RAG fusion pipeline.
        </p>

        {/* Quick Example Pills */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <span className="text-[10px] uppercase font-mono text-campus-muted mr-1">Presets:</span>
          {EXAMPLE_QUERIES.map((ex, idx) => (
            <button
              key={idx}
              onClick={() => {
                setQuery(ex);
                handleRunDiagnostics(ex);
              }}
              className="text-[10px] px-2 py-1 rounded bg-campus-bg hover:bg-purple-600/20 hover:text-purple-300 border border-campus-border text-campus-subtext transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Query Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunDiagnostics();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-campus-muted absolute left-3 top-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter student query to analyze routing and retrieval..."
              className="campus-input pl-9 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="campus-btn-primary bg-purple-600 hover:bg-purple-500 shadow-purple-500/20 text-xs py-2 px-4 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Analyzing...' : 'Run Diagnostics'}
          </button>
        </form>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {results && (
          <div className="space-y-5 pt-3">
            {/* ------------------------------------------------ */}
            {/* PHASE 6: QUERY ROUTING DECISION */}
            {/* ------------------------------------------------ */}
            {results.routing && (
              <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Phase 6 Router Decision
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-campus-muted uppercase">Strategy:</span>
                    <span
                      className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase border ${getStrategyBadge(
                        results.routing.strategy
                      )}`}
                    >
                      {results.routing.strategy}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded bg-campus-bg/80 border border-campus-border">
                    <span className="text-[10px] font-mono text-campus-muted uppercase block mb-1">
                      Identified Intent
                    </span>
                    <span className="font-semibold text-purple-300 font-mono text-xs">
                      {results.routing.intent}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-campus-bg/80 border border-campus-border">
                    <span className="text-[10px] font-mono text-campus-muted uppercase block mb-1">
                      Query Execution Path
                    </span>
                    <span className="font-semibold text-white font-mono text-xs">
                      {results.routing.queryType}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-campus-bg/80 border border-campus-border">
                    <span className="text-[10px] font-mono text-campus-muted uppercase block mb-1">
                      Ambiguity / Clarification
                    </span>
                    <span
                      className={`font-semibold font-mono text-xs ${
                        results.routing.requiresClarification ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {results.routing.requiresClarification ? 'Requires Clarification' : 'Direct Execution'}
                    </span>
                  </div>
                </div>

                {/* Extracted Entities */}
                {results.routing.entities &&
                  Object.keys(results.routing.entities).length > 0 && (
                    <div className="pt-1">
                      <span className="text-[10px] font-mono text-campus-muted uppercase block mb-1.5">
                        Extracted Entities & Metadata:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(results.routing.entities).map(([key, val]) => (
                          <span
                            key={key}
                            className="px-2 py-0.5 rounded text-[11px] font-mono bg-campus-surface text-campus-text border border-campus-border flex items-center gap-1"
                          >
                            <span className="text-purple-400">{key}:</span> {String(val)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* ------------------------------------------------ */}
            {/* RETRIEVAL STATS BADGES */}
            {/* ------------------------------------------------ */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-campus-bg border border-campus-border text-center">
                <p className="text-[10px] text-campus-muted uppercase font-mono">Vector Candidates</p>
                <p className="text-lg font-bold text-blue-400">
                  {results.diagnostics?.vectorCount ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-campus-bg border border-campus-border text-center">
                <p className="text-[10px] text-campus-muted uppercase font-mono">BM25 Keyword</p>
                <p className="text-lg font-bold text-amber-400">
                  {results.diagnostics?.keywordCount ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-campus-bg border border-campus-border text-center">
                <p className="text-[10px] text-campus-muted uppercase font-mono">RRF Fused</p>
                <p className="text-lg font-bold text-purple-400">
                  {results.diagnostics?.fusedCandidateCount ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-campus-bg border border-campus-border text-center">
                <p className="text-[10px] text-campus-muted uppercase font-mono">Reranked Top K</p>
                <p className="text-lg font-bold text-emerald-400">
                  {results.diagnostics?.finalChunkCount ?? 0}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-campus-bg border border-campus-border text-center col-span-2 sm:col-span-1">
                <p className="text-[10px] text-campus-muted uppercase font-mono">Latency</p>
                <p className="text-lg font-bold text-white">
                  {results.diagnostics?.durationMs ?? 0}ms
                </p>
              </div>
            </div>

            {/* Inferred Filters */}
            {results.diagnostics?.appliedFilters &&
              Object.keys(results.diagnostics.appliedFilters).length > 0 && (
                <div className="p-2.5 rounded bg-campus-surface border border-campus-border flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-mono text-[10px] text-campus-muted uppercase">
                    Query Filters:
                  </span>
                  {Object.entries(results.diagnostics.appliedFilters).map(([k, v]) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    >
                      {k}: {String(v)}
                    </span>
                  ))}
                  {results.diagnostics?.regulationNumber && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Regulation: {results.diagnostics.regulationNumber}
                    </span>
                  )}
                </div>
              )}

            {/* Chunks */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-white">Top Grounded Chunks Delivered to LLM:</p>
              {results.chunks && results.chunks.length > 0 ? (
                <div className="space-y-2">
                  {results.chunks.map((chunk, cIdx) => (
                    <div
                      key={cIdx}
                      className="p-3 rounded-lg bg-campus-bg/80 border border-campus-border space-y-1.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[10px] flex items-center justify-center font-bold">
                            #{cIdx + 1}
                          </span>
                          <span className="font-semibold text-white">{chunk.documentTitle}</span>
                          {chunk.pageNumber && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-campus-surface text-campus-subtext border border-campus-border">
                              Page {chunk.pageNumber}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-campus-muted">
                            Score: <strong className="text-emerald-400">{chunk.score}</strong>
                          </span>
                          <div className="flex gap-1">
                            {chunk.sourcesFoundIn?.map((src) => (
                              <span
                                key={src}
                                className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                                  src === 'vector'
                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                              >
                                {src}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="text-campus-subtext text-[11px] leading-relaxed font-mono bg-black/20 p-2 rounded border border-campus-border/40">
                        {chunk.snippet}...
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-campus-muted italic">No chunks retrieved for this query.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiagnosticsTab;
