/**
 * API Service for AskCampusAi Platform (Phase 1 & Phase 2)
 * Wraps native fetch with auth headers and standard response parsing
 */

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').trim().replace(/\/+$/, '');
const API_BASE_URL = rawBaseUrl.endsWith('/api') ? rawBaseUrl : `${rawBaseUrl}/api`;

/**
 * Generic request helper
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('askcampus_token');

  const headers = {
    // Only set Content-Type to JSON if not uploading multipart FormData
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${cleanEndpoint}`;


  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      data = { message: `Server returned HTTP ${response.status}` };
    }

    if (!response.ok) {
      // If unauthorized, clean up stale token
      if (response.status === 401 && !endpoint.includes('/login') && !endpoint.includes('/register')) {
        localStorage.removeItem('askcampus_token');
        localStorage.removeItem('askcampus_user');
      }

      const error = new Error(data.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    // Re-throw formatted error
    if (error.message === 'Failed to fetch') {
      console.error(`[AskCampusAi API Error] Failed to fetch from: ${url}`, error);
      throw new Error('CampusGPT is currently connecting to campus records. Please try again in a moment.');
    }
    throw error;
  }
}

export const authAPI = {
  register: (userData) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    }),

  login: (credentials) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  getMe: () =>
    request('/auth/me', {
      method: 'GET',
    }),

  logout: () =>
    request('/auth/logout', {
      method: 'POST',
    }),

  checkAdmin: () =>
    request('/auth/admin-check', {
      method: 'GET',
    }),
};

export const documentAPI = {
  /**
   * Upload and ingest a university PDF document
   * @param {FormData} formData
   */
  upload: (formData) =>
    request('/documents/upload', {
      method: 'POST',
      body: formData,
    }),

  /**
   * List all uploaded and indexed documents
   */
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/documents${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  },

  /**
   * Get single document details
   */
  getById: (id) =>
    request(`/documents/${id}`, {
      method: 'GET',
    }),

  /**
   * Delete document and all Qdrant vectors
   */
  delete: (id) =>
    request(`/documents/${id}`, {
      method: 'DELETE',
    }),
};

export const conversationAPI = {
  /**
   * List all conversation threads for current user
   */
  list: () =>
    request('/conversations', {
      method: 'GET',
    }),

  /**
   * Create a new conversation thread
   * @param {{ title?: string, pinned?: boolean, summary?: string, tags?: string[] }} data
   */
  create: (data = {}) =>
    request('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * Get conversation details and associated messages
   * @param {string} id
   */
  get: (id) =>
    request(`/conversations/${id}`, {
      method: 'GET',
    }),

  /**
   * Update conversation (rename, toggle pin, update summary)
   * @param {string} id
   * @param {{ title?: string, pinned?: boolean, summary?: string, tags?: string[] }} data
   */
  update: (id, data = {}) =>
    request(`/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /**
   * Delete conversation and all its messages
   * @param {string} id
   */
  delete: (id) =>
    request(`/conversations/${id}`, {
      method: 'DELETE',
    }),
};

export const chatAPI = {
  /**
   * Submit student query to RAG assistant
   * @param {string} message
   * @param {object} options
   * @param {string} [conversationId]
   */
  sendMessage: (message, options = {}, conversationId = null) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        options,
        conversationId: conversationId || options?.conversationId || null,
      }),
    }),

  /**
   * Submit student query to RAG assistant using Server-Sent Events (SSE) streaming
   * @param {string} message
   * @param {object} options
   * @param {object} callbacks - { onConnected, onStatus, onMetadata, onSources, onToken, onDone, onError }
   * @param {AbortSignal} [signal]
   */
  streamMessage: async (message, options = {}, callbacks = {}, signal = null) => {
    const token = localStorage.getItem('askcampus_token');
    const cleanEndpoint = '/chat/stream';
    const url = `${API_BASE_URL}${cleanEndpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const conversationId = options?.conversationId || null;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message,
          options,
          conversationId,
        }),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[AskCampusAi Stream Network Error]', err);
      throw new Error('CampusGPT is currently connecting to campus records. Please try again in a moment.');
    }

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('askcampus_token');
        localStorage.removeItem('askcampus_user');
      }
      let errData = {};
      try {
        errData = await response.json();
      } catch {}
      throw new Error(errData.message || `Request failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported by this browser environment');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last partial line

        let currentEvent = 'message';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              switch (currentEvent) {
                case 'connected':
                  callbacks.onConnected?.(data);
                  break;
                case 'status':
                  callbacks.onStatus?.(data.message || data);
                  break;
                case 'metadata':
                  callbacks.onMetadata?.(data);
                  break;
                case 'sources':
                  callbacks.onSources?.(data.sources || []);
                  break;
                case 'token':
                  callbacks.onToken?.(data.token || '');
                  break;
                case 'done':
                  callbacks.onDone?.(data);
                  break;
                case 'error':
                  callbacks.onError?.(data);
                  break;
                default:
                  break;
              }
            } catch (jsonErr) {
              // Ignore partial JSON
            }
          }
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') return;
      console.warn('[SSE Read Error]', streamErr);
      throw streamErr;
    }
  },

  /**
   * Retrieve previous chat dialogue history
   */
  getHistory: () =>
    request('/chat/history', {
      method: 'GET',
    }),

  /**
   * Admin/Dev retrieval diagnostics
   */
  debug: (message, options = {}) =>
    request('/chat/debug', {
      method: 'POST',
      body: JSON.stringify({ message, options }),
    }),
};

export const adminAPI = {
  /**
   * Fetch Redis cache performance metrics and active cache version
   */
  getCacheStats: () =>
    request('/admin/cache/stats', {
      method: 'GET',
    }),

  /**
   * Bump cache version to invalidate cached RAG responses
   * @param {string} [reason]
   */
  invalidateCache: (reason) =>
    request('/admin/cache/invalidate', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  /**
   * Get paginated admin document registry with filters
   * @param {object} params - { page, limit, search, category, department, documentType, status, isActive }
   */
  getDocuments: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/documents${query ? `?${query}` : ''}`, {
      method: 'GET',
    });
  },

  /**
   * Get document detail with versions and latest job
   * @param {string} id
   */
  getDocumentById: (id) =>
    request(`/admin/documents/${id}`, {
      method: 'GET',
    }),

  /**
   * Create document with metadata and upload initial Version 1
   * @param {FormData} formData
   */
  createDocument: (formData) =>
    request('/admin/documents', {
      method: 'POST',
      body: formData,
    }),

  /**
   * Upload a new version for an existing document
   * @param {string} id
   * @param {FormData} formData
   */
  uploadNewVersion: (id, formData) =>
    request(`/admin/documents/${id}/versions`, {
      method: 'POST',
      body: formData,
    }),

  /**
   * List all versions for a document
   * @param {string} id
   */
  getDocumentVersions: (id) =>
    request(`/admin/documents/${id}/versions`, {
      method: 'GET',
    }),

  /**
   * Re-index active version of document
   * @param {string} id
   */
  reindexDocument: (id) =>
    request(`/admin/documents/${id}/reindex`, {
      method: 'POST',
    }),

  /**
   * Retry failed version ingestion
   * @param {string} id
   * @param {string} versionId
   */
  retryVersion: (id, versionId) =>
    request(`/admin/documents/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ versionId }),
    }),

  /**
   * Toggle document active/inactive state
   * @param {string} id
   * @param {boolean} isActive
   */
  setDocumentStatus: (id, isActive) =>
    request(`/admin/documents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  /**
   * Soft-delete document
   * @param {string} id
   */
  deleteDocument: (id) =>
    request(`/admin/documents/${id}`, {
      method: 'DELETE',
    }),

  /**
   * Poll live ingestion status/progress
   * @param {string} id
   */
  getDocumentStatus: (id) =>
    request(`/admin/documents/${id}/status`, {
      method: 'GET',
    }),

  // ----------------------------------------------------
  // Structured Course Catalog APIs (Phase 6)
  // ----------------------------------------------------
  getCourses: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/courses${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  getCourseById: (id) =>
    request(`/admin/courses/${id}`, { method: 'GET' }),

  createCourse: (data) =>
    request('/admin/courses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCourse: (id, data) =>
    request(`/admin/courses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteCourse: (id) =>
    request(`/admin/courses/${id}`, { method: 'DELETE' }),

  // ----------------------------------------------------
  // Academic Events & Deadlines APIs (Phase 6)
  // ----------------------------------------------------
  getEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/events${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  getEventById: (id) =>
    request(`/admin/events/${id}`, { method: 'GET' }),

  createEvent: (data) =>
    request('/admin/events', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateEvent: (id, data) =>
    request(`/admin/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteEvent: (id) =>
    request(`/admin/events/${id}`, { method: 'DELETE' }),

  // ----------------------------------------------------
  // Website Crawler & Automated Ingestion APIs (Phase 7)
  // ----------------------------------------------------
  getCrawlerSources: () =>
    request('/admin/crawler/sources', { method: 'GET' }),

  getCrawlerSourceById: (id) =>
    request(`/admin/crawler/sources/${id}`, { method: 'GET' }),

  createCrawlerSource: (data) =>
    request('/admin/crawler/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCrawlerSource: (id, data) =>
    request(`/admin/crawler/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteCrawlerSource: (id) =>
    request(`/admin/crawler/sources/${id}`, { method: 'DELETE' }),

  runCrawlerSource: (id) =>
    request(`/admin/crawler/sources/${id}/run`, { method: 'POST' }),

  stopCrawlerSource: (id) =>
    request(`/admin/crawler/sources/${id}/stop`, { method: 'POST' }),

  getCrawlJobs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/crawler/jobs${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  getCrawlJobById: (id) =>
    request(`/admin/crawler/jobs/${id}`, { method: 'GET' }),

  // ----------------------------------------------------
  // Knowledge Ingestion & PYQ Drive APIs (Phase 8)
  // ----------------------------------------------------
  getKnowledgeStats: () =>
    request('/admin/knowledge/stats', { method: 'GET' }),

  startFullPyqSync: (folderUrl = null) =>
    request('/admin/pyq/sync', {
      method: 'POST',
      body: JSON.stringify({ folderUrl }),
    }),

  startIncrementalPyqSync: (folderUrl = null) =>
    request('/admin/pyq/sync/incremental', {
      method: 'POST',
      body: JSON.stringify({ folderUrl }),
    }),

  stopPyqSync: (jobId = null) =>
    request('/admin/pyq/sync/stop', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  getPyqSyncStatus: (jobId = null) =>
    request(`/admin/pyq/sync/status${jobId ? `?jobId=${jobId}` : ''}`, { method: 'GET' }),

  getPyqDocuments: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/admin/pyq/documents${query ? `?${query}` : ''}`, { method: 'GET' });
  },

  getPyqDocumentById: (id) =>
    request(`/admin/pyq/documents/${id}`, { method: 'GET' }),

  reviewPyqDocument: (id, data) =>
    request(`/admin/pyq/review/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  reprocessPyqDocument: (id) =>
    request(`/admin/pyq/reprocess/${id}`, { method: 'POST' }),
};

export const systemAPI = {
  checkHealth: () =>
    request('/health', {
      method: 'GET',
    }),
};

export default {
  auth: authAPI,
  document: documentAPI,
  chat: chatAPI,
  admin: adminAPI,
  system: systemAPI,
};
