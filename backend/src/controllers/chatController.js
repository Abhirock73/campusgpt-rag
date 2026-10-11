import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage.js';
import Conversation from '../models/Conversation.js';
import { routeQuery } from '../services/query/queryRouter.js';
import { analyzeQuery } from '../services/query/queryAnalyzer.js';
import { classifyIntent } from '../services/query/intentClassifier.js';
import { retrieveHybridContext } from '../services/retrieval/hybridRetriever.js';
import { generateConversationTitle, deriveFallbackTitle } from '../services/ai/llmService.js';

/**
 * Resolve an existing conversation or create a new session
 */
const resolveOrCreateConversation = async (userId, conversationId, initialQuery) => {
  if (conversationId && mongoose.isValidObjectId(conversationId)) {
    const existing = await Conversation.findOne({ _id: conversationId, userId });
    if (existing) return existing;
  }
  const initialTitle = deriveFallbackTitle(initialQuery);
  return await Conversation.create({
    userId,
    title: initialTitle || 'Campus Inquiry',
  });
};

/**
 * Asynchronously generate short 2-4 word conversation title after the first turn
 */
const triggerAutoTitling = (convId, query, answer) => {
  ChatMessage.countDocuments({ conversationId: convId })
    .then((count) => {
      if (count <= 2) {
        return generateConversationTitle(query, answer).then(async (newTitle) => {
          if (newTitle && newTitle.trim()) {
            await Conversation.findByIdAndUpdate(convId, { title: newTitle.trim() });
          }
        });
      }
    })
    .catch((err) => {
      console.warn(`[Auto-Title Error] ${err.message}`);
    });
};

/**
 * @desc    Submit user inquiry and receive grounded answer via Intelligent Query Router (Phase 6)
 * @route   POST /api/chat
 * @access  Private (Authenticated users)
 */
export const sendMessage = async (req, res, next) => {
  try {
    const { message, options, conversationId: bodyConvId } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a non-empty message for the campus assistant.',
      });
    }

    const trimmedQuery = message.trim();
    const reqConversationId = bodyConvId || options?.conversationId || null;

    // Resolve or create Conversation session thread
    const conversation = await resolveOrCreateConversation(req.user._id, reqConversationId, trimmedQuery);

    // 1. Run Phase 6 Intelligent Query Routing pipeline (Clarification, Structured, Document Search, Hybrid, or RAG)
    const routeResult = await routeQuery(trimmedQuery, req.user, options || {});

    // 2. Persist message turn in MongoDB under conversationId
    try {
      await ChatMessage.create({
        userId: req.user._id,
        conversationId: conversation._id,
        role: 'user',
        content: trimmedQuery,
        sources: [],
      });

      await ChatMessage.create({
        userId: req.user._id,
        conversationId: conversation._id,
        role: 'assistant',
        content: routeResult.answer,
        sources: routeResult.sources || [],
        suggestions: routeResult.suggestions || [],
      });

      conversation.updatedAt = new Date();
      await conversation.save();

      // Trigger automatic title generation after the first turn
      triggerAutoTitling(conversation._id, trimmedQuery, routeResult.answer);
    } catch (dbErr) {
      console.warn(`[Chat History Warning] Failed to log chat message: ${dbErr.message}`);
    }

    // 3. Return grounded answer, citations, suggestions, structured payload, and routing metadata
    return res.status(200).json({
      success: true,
      message: 'Assistant response generated successfully.',
      data: {
        conversationId: conversation._id,
        conversationTitle: conversation.title,
        answer: routeResult.answer,
        suggestions: routeResult.suggestions || [],
        queryType: routeResult.queryType || 'rag',
        intent: routeResult.intent || 'policy_question',
        coverage: routeResult.coverage || 'FULL',
        requestedFields: routeResult.requestedFields || [],
        supportedFields: routeResult.supportedFields || [],
        missingFields: routeResult.missingFields || [],
        sources: routeResult.sources || [],
        structuredData: routeResult.structuredData || null,
        clarification: routeResult.clarification || null,
        retrieval: routeResult.retrieval || { strategy: 'routed', cached: false },
        cache: routeResult.cache || { hit: false, type: 'miss' },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user's recent chat dialogue history
 * @route   GET /api/chat/history
 * @access  Private (Authenticated users)
 */
export const getChatHistory = async (req, res, next) => {
  try {
    const { conversationId } = req.query;
    const filter = { userId: req.user._id };

    if (conversationId && mongoose.isValidObjectId(conversationId)) {
      filter.conversationId = conversationId;
    }

    const recentMessages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      success: true,
      message: 'Chat history retrieved.',
      data: {
        messages: recentMessages.reverse().map((m) => ({
          id: m._id,
          _id: m._id,
          conversationId: m.conversationId,
          role: m.role,
          sender: m.role,
          content: m.content,
          text: m.content,
          sources: m.sources || [],
          suggestions: m.suggestions || [],
          createdAt: m.createdAt,
          timestamp: m.createdAt
            ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Development & Admin-only retrieval diagnostics endpoint
 * @route   POST /api/chat/debug
 * @access  Private (Admin or Development environment only)
 */
export const debugRetrieval = async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' && req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Retrieval diagnostics endpoint is restricted.',
      });
    }

    const { message, options } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a message to evaluate.',
      });
    }

    const queryText = message.trim();
    const analysis = analyzeQuery(queryText);
    const classification = classifyIntent(analysis);
    const result = await retrieveHybridContext(queryText, options || {});

    return res.status(200).json({
      success: true,
      message: 'Retrieval diagnostics completed.',
      data: {
        routing: {
          intent: classification.intent,
          queryType: classification.queryType,
          confidence: classification.confidence,
          clarification: classification.clarification,
          analysis,
        },
        diagnostics: result.diagnostics,
        chunks: result.chunks.map((c) => ({
          documentTitle: c.documentTitle,
          pageNumber: c.pageNumber,
          chunkIndex: c.chunkIndex,
          score: Math.round((c.rerankScore || c.rrfScore || c.score || 0) * 1000) / 1000,
          vectorRank: c.vectorRank,
          keywordRank: c.keywordRank,
          sourcesFoundIn: c.sourcesFoundIn,
          snippet: c.text.slice(0, 250),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Submit user inquiry and receive live grounded answer via SSE streaming
 * @route   POST /api/chat/stream
 * @access  Private (Authenticated users)
 */
export const sendMessageStream = async (req, res, next) => {
  const { message, options, conversationId: bodyConvId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a non-empty message for the campus assistant.',
    });
  }

  const trimmedQuery = message.trim();
  const reqConversationId = bodyConvId || options?.conversationId || null;

  // Resolve or create Conversation session thread
  const conversation = await resolveOrCreateConversation(req.user._id, reqConversationId, trimmedQuery);

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let isClientConnected = true;
  req.on('close', () => {
    isClientConnected = false;
    console.log('[SSE] Client disconnected from /api/chat/stream. Continuing background execution to persist response...');
  });

  const sendEvent = (event, data) => {
    if (isClientConnected && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  // 1. Initial connection event with conversation metadata
  sendEvent('connected', {
    timestamp: Date.now(),
    conversationId: conversation._id,
    conversationTitle: conversation.title,
  });

  try {
    // 2. Call Intelligent Query Routing with live SSE callbacks
    const routeResult = await routeQuery(trimmedQuery, req.user, {
      ...(options || {}),
      callbacks: {
        onStatus: (statusMsg) => {
          sendEvent('status', { message: statusMsg });
        },
        onMetadata: (meta) => {
          sendEvent('metadata', {
            ...meta,
            conversationId: conversation._id,
            conversationTitle: conversation.title,
          });
        },
        onSources: (sourcesList) => {
          sendEvent('sources', { sources: sourcesList });
        },
        onToken: (tokenChunk) => {
          sendEvent('token', { token: tokenChunk });
        },
      },
    });

    // 3. Persist conversation in MongoDB under conversationId
    try {
      await ChatMessage.create({
        userId: req.user._id,
        conversationId: conversation._id,
        role: 'user',
        content: trimmedQuery,
        sources: [],
      });

      await ChatMessage.create({
        userId: req.user._id,
        conversationId: conversation._id,
        role: 'assistant',
        content: routeResult.answer,
        sources: routeResult.sources || [],
        suggestions: routeResult.suggestions || [],
      });

      conversation.updatedAt = new Date();
      await conversation.save();

      // Trigger automatic title generation after the first turn
      triggerAutoTitling(conversation._id, trimmedQuery, routeResult.answer);
    } catch (dbErr) {
      console.warn(`[Chat History Warning] Failed to log chat message: ${dbErr.message}`);
    }

    // 4. Send final completion event with suggestions and conversationId
    sendEvent('done', {
      conversationId: conversation._id,
      conversationTitle: conversation.title,
      answer: routeResult.answer,
      suggestions: routeResult.suggestions || [],
      queryType: routeResult.queryType || 'rag',
      intent: routeResult.intent || 'policy_question',
      coverage: routeResult.coverage || 'FULL',
      sources: routeResult.sources || [],
      clarification: routeResult.clarification || null,
      structuredData: routeResult.structuredData || null,
      cache: routeResult.cache || { hit: false, type: 'miss' },
    });

    if (isClientConnected && !res.writableEnded) {
      res.end();
    }
  } catch (error) {
    console.error('[SSE Stream Error]', error);
    sendEvent('error', {
      message: 'I encountered an issue processing your request. Please try again in a moment.',
    });
    if (!res.writableEnded) {
      res.end();
    }
  }
};

export default {
  sendMessage,
  sendMessageStream,
  getChatHistory,
  debugRetrieval,
};
