import React, { useState, useEffect } from 'react';
import { documentAPI } from '../services/api';
import {
  FileText,
  Search,
  Filter,
  Bot,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const Documents = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await documentAPI.list();
        if (res?.data?.documents) {
          setDocuments(res.data.documents.filter((d) => d.status === 'indexed'));
        }
      } catch (err) {
        console.error('Failed to load documents:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDocs();
  }, []);

  const categories = [
    { id: 'all', name: 'All Documents' },
    { id: 'academics', name: 'Academics' },
    { id: 'examinations', name: 'Examinations' },
    { id: 'hostel', name: 'Hostel' },
    { id: 'courses', name: 'Courses' },
  ];

  const filteredDocs = documents.filter((doc) => {
    const matchesCategory = selectedCategory === 'all' || doc.category === selectedCategory;
    const searchLower = (searchQuery || '').trim().toLowerCase();
    const matchesSearch =
      !searchLower ||
      (doc.title && doc.title.toLowerCase().includes(searchLower)) ||
      (doc.department && doc.department.toLowerCase().includes(searchLower)) ||
      (doc.description && doc.description.toLowerCase().includes(searchLower));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="campus-card p-6 bg-campus-surface">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Verified Knowledge Base
            </span>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-400" />
              Official Campus Documents
            </h1>
            <p className="text-sm text-campus-muted">
              Official university regulations, circulars, handbooks, and course syllabi indexed into CampusGpt
            </p>
          </div>

          <Link to="/assistant" className="campus-btn-primary text-xs py-2">
            <Bot className="w-4 h-4" />
            Query in CampusGpt
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-campus-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search indexed university documents by title or department..."
            className="campus-input pl-10"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === c.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-campus-surface border border-campus-border text-campus-muted hover:text-white'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid */}
      {loading ? (
        <div className="campus-card p-12 text-center text-xs text-campus-muted">
          Loading indexed campus documents...
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="campus-card p-12 text-center border-dashed space-y-3">
          <FileText className="w-12 h-12 text-campus-muted mx-auto" />
          <h3 className="text-sm font-semibold text-white">No indexed documents found</h3>
          <p className="text-xs text-campus-muted max-w-sm mx-auto">
            {documents.length === 0
              ? 'No documents have been indexed yet. An administrator can upload university PDFs from the Admin Dashboard.'
              : 'No documents match your search filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocs.map((doc) => (
            <div
              key={doc._id}
              className="campus-card campus-card-hover p-5 flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="capitalize px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {doc.category}
                  </span>
                  <span className="text-[10px] font-mono text-campus-muted">
                    {doc.totalPages} page(s)
                  </span>
                </div>

                <div>
                  <h3 className="font-semibold text-white group-hover:text-emerald-400 transition-colors line-clamp-2">
                    {doc.title}
                  </h3>
                  <p className="text-xs text-campus-muted mt-1 leading-relaxed line-clamp-2">
                    {doc.description || `Official ${doc.documentType} for ${doc.department}`}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-campus-border/60 flex items-center justify-between text-xs text-campus-muted">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px]">{doc.department}</span>
                  {doc.sourceUrl && (
                    <a
                      href={doc.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5 text-[10px]"
                      title="View Official Source Document"
                    >
                      Official Source
                    </a>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {doc.totalChunks} chunks indexed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Documents;
