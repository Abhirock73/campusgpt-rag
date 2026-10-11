import { understandQuery } from './queryUnderstandingService.js';
import { resolveUserContext, detectProfileUpdateRequest } from './userContextService.js';
import courseService from '../courses/courseService.js';
import documentSearchService from '../documents/documentSearchService.js';
import { answerQuestion } from '../rag/ragService.js';
import { generateGeneralAnswerStream } from '../ai/llmService.js';
import User from '../../models/User.js';
import ChatMessage from '../../models/ChatMessage.js';

/**
 * Format structured course results into a clean, human-readable student response
 */
const formatCoursesResponse = (courses, query) => {
  if (!courses || courses.length === 0) {
    return null;
  }

  let text = `Here are the matching courses found in the university academic catalog:\n\n`;

  courses.forEach((c, idx) => {
    text += `### ${idx + 1}. **${c.code}: ${c.name}**\n`;
    text += `- **Department:** ${c.department}\n`;
    text += `- **Semester:** ${c.semester} | **Program:** ${c.program || 'B.Tech'}\n`;
    text += `- **Credits:** ${c.credits} (${c.type.toUpperCase()})\n`;
    if (c.prerequisites && c.prerequisites.length > 0) {
      text += `- **Prerequisites:** ${c.prerequisites.join(', ')}\n`;
    }
    if (c.description) {
      text += `- **Description:** ${c.description}\n`;
    }
    text += `\n`;
  });

  return text.trim();
};

/**
 * Format specialized PYQ search response matching exact prompt guidelines
 */
const formatPyqSearchResponse = (docs, query, analysis) => {
  if (!docs || docs.length === 0) return null;

  if (docs.length === 1) {
    const doc = docs[0];
    const courseTitle =
      doc.courseName && doc.courseCode
        ? `${doc.courseName} (${doc.courseCode})`
        : doc.courseName || doc.title;
    const branchText = doc.branch ? `B.Tech ${doc.branch}` : doc.program || 'B.Tech';
    const semText = doc.semester ? `Semester ${doc.semester}` : '';
    const dateText = [doc.examMonth, doc.year].filter(Boolean).join(' ');

    let res = `### **${courseTitle}**\n`;
    if (branchText || semText) {
      res += `${[branchText, semText].filter(Boolean).join(' — ')}\n`;
    }
    if (dateText) {
      res += `${dateText}\n\n`;
    } else {
      res += `\n`;
    }
    if (doc.sourceUrl) {
      res += `📄 **[View Original PDF](${doc.sourceUrl})**\n\n`;
    }
    res += `*Source: NIT KKR PYQ Drive*`;
    return res;
  }

  // Multiple papers found
  let res = `Found ${docs.length} question paper(s) matching your request from the **NIT KKR PYQ Drive**:\n\n`;
  docs.forEach((doc, idx) => {
    const courseTitle =
      doc.courseName && doc.courseCode
        ? `${doc.courseName} (${doc.courseCode})`
        : doc.title;
    const yearText = doc.year ? ` — ${doc.year}` : '';
    const semText = doc.semester ? ` (Semester ${doc.semester})` : '';

    res += `${idx + 1}. **${courseTitle}${yearText}**${semText}\n`;
    if (doc.sourceUrl) {
      res += `   🔗 [View Original PDF](${doc.sourceUrl})\n`;
    }
    res += `\n`;
  });

  res += `*Source: NIT KKR PYQ Drive*`;
  return res.trim();
};

/**
 * Intelligent Query Router (Phase 6)
 * Routes incoming inquiry to optimal handler:
 * - 'clarification': Asks student for options when query is ambiguous
 * - 'structured': Fast, accurate database queries for courses or deadlines
 * - 'document_search': Metadata-driven document & PYQ discovery
 * - 'hybrid': Blends structured facts (courses/programs) + policy regulations
 * - 'rag': Deep multi-stage retrieval across indexed university regulations
 * 
 * @param {string} rawQuery - Student message
 * @param {object} user - Authenticated user context
 * @param {object} options - Retrieval & model options
 * @returns {Promise<object>} Complete response object
 */
export const routeQuery = async (rawQuery, user = null, options = {}) => {
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return {
      answer: 'Please provide a campus question.',
      queryType: 'rag',
      intent: 'empty',
      sources: [],
      structuredData: null,
      clarification: null,
      retrieval: { strategy: 'none', cached: false },
    };
  }

  const query = rawQuery.trim();

  // --------------------------------------------------------------------------
  // STEP 1: Check for Explicit User Profile Update Requests
  // e.g., "I'm now in 6th semester", "Remember that I'm a B.Tech CSE student"
  // --------------------------------------------------------------------------
  const profileUpdate = detectProfileUpdateRequest(query);
  if (profileUpdate) {
    if (user && user._id) {
      try {
        await User.findByIdAndUpdate(user._id, { $set: profileUpdate });
        Object.assign(user, profileUpdate);
        const updatedSummary = Object.entries(profileUpdate)
          .map(([k, v]) => `• **${k}**: ${v}`)
          .join('\n');

        return {
          answer: `✅ **Profile Updated Successfully!**\n\nI have updated your student profile with:\n${updatedSummary}\n\nI will automatically use this information for future course, PYQ, and semester queries without asking again. How can I assist you next?`,
          queryType: 'profile_update',
          intent: 'PROFILE_UPDATE',
          sources: [],
          structuredData: { profileUpdate },
          clarification: null,
          retrieval: { strategy: 'profile_update', cached: false },
        };
      } catch (err) {
        console.warn(`[Profile Update] Failed to save update: ${err.message}`);
      }
    } else {
      const updatedSummary = Object.entries(profileUpdate)
        .map(([k, v]) => `• **${k}**: ${v}`)
        .join('\n');
      return {
        answer: `I have noted your information for this session:\n${updatedSummary}\n\n*(Log in to save this permanently to your profile)*. How can I assist you today?`,
        queryType: 'profile_update',
        intent: 'PROFILE_UPDATE',
        sources: [],
        structuredData: { profileUpdate },
        clarification: null,
        retrieval: { strategy: 'session_context', cached: false },
      };
    }
  }

  // --------------------------------------------------------------------------
  // STEP 2: Load Recent Conversation Memory
  // --------------------------------------------------------------------------
  let recentHistory = options.conversationHistory || [];
  if ((!recentHistory || recentHistory.length === 0) && user && user._id) {
    try {
      const msgs = await ChatMessage.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(6);
      recentHistory = msgs.reverse();
    } catch (e) {
      // ignore
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: Dynamic Query Understanding Layer (Gemini-driven)
  // --------------------------------------------------------------------------
  const userContextSnapshot = user ? {
    degree: user.degree || user.program || 'B.Tech',
    program: user.program || user.degree || 'B.Tech',
    branch: user.branch || user.department,
    department: user.department,
    semester: user.semester,
    year: user.year,
    campus: user.campus || 'NIT Kurukshetra',
  } : {};

  const understanding = await understandQuery(query, userContextSnapshot);

  // --------------------------------------------------------------------------
  // STEP 4: Strict Context Precedence Resolution
  // Current Query Explicit > Stored User Profile > Recent Conversation > Unknown
  // --------------------------------------------------------------------------
  const { resolvedEntities, entitySources } = resolveUserContext(
    understanding.entities || {},
    user,
    recentHistory
  );

  console.log(`[QUERY ROUTER] Query: "${query.slice(0, 50)}..." -> Dynamic Intent: ${understanding.intent}, Type: ${understanding.queryType}`);
  console.log(`[QUERY ROUTER] Resolved Entities:`, JSON.stringify(resolvedEntities), `Sources:`, JSON.stringify(entitySources));

  const callbacks = options.callbacks || {};
  callbacks.onMetadata?.({
    queryType: understanding.queryType,
    intent: understanding.intent,
    resolvedEntities,
  });

  // --------------------------------------------------------------------------
  // ROUTE 0: Conversational Chat & Greetings
  // --------------------------------------------------------------------------
  if (understanding.queryType === 'chat' || understanding.intent === 'GREETING' || /^(hi|hello|hey|good morning|thanks|thank you)\b/i.test(query)) {
    let chatAnswer = "Hello! I'm CampusGPT, your official NIT Kurukshetra campus assistant. How can I help you with courses, exams, campus regulations, or previous year papers today?";
    const lowerQuery = query.toLowerCase();
    if (/thank/i.test(lowerQuery)) {
      chatAnswer = "You're welcome! Let me know if you need any other official regulations, syllabus details, or question papers.";
    } else if (/who are you|what can you do|what are you/i.test(lowerQuery)) {
      chatAnswer = "I'm CampusGPT, an intelligent assistant for NIT Kurukshetra. I can help you with official academic ordinances, attendance regulations, examination schedules, previous year question papers (PYQs), placement policies, and syllabus details.";
    }

    callbacks.onToken?.(chatAnswer);

    return {
      answer: chatAnswer,
      queryType: 'chat',
      intent: 'GENERAL_CHAT',
      coverage: 'FULL',
      sources: [],
      structuredData: null,
      clarification: null,
      retrieval: { strategy: 'conversational_response', cached: false },
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE 1: Pure General Knowledge / Programming Queries (Direct Gemini Knowledge)
  // E.g., "Explain binary search", "What is PCA?", "Explain TCP vs UDP", "Who won the World Cup?"
  // --------------------------------------------------------------------------
  if (understanding.queryType === 'general') {
    console.log(`[QUERY ROUTER] Routing to Gemini General Knowledge (no campus RAG): "${query}"`);
    callbacks.onStatus?.('Generating academic response...');
    const generalResult = await generateGeneralAnswerStream(query, { onToken: callbacks.onToken });
    const answerText = (generalResult && generalResult.answer) ? generalResult.answer : String(generalResult);
    const suggestions = (generalResult && generalResult.suggestions) ? generalResult.suggestions : [];

    return {
      answer: answerText,
      suggestions,
      queryType: 'general',
      intent: understanding.intent || 'GENERAL_KNOWLEDGE',
      coverage: 'FULL',
      sources: [],
      structuredData: null,
      clarification: null,
      retrieval: { strategy: 'gemini_general_knowledge', cached: false },
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE 2: Hybrid Questions (General Concept + NIT Kurukshetra Information)
  // E.g., "Explain DBMS and tell me which DBMS course is offered at NIT Kurukshetra."
  // --------------------------------------------------------------------------
  if (understanding.queryType === 'hybrid') {
    console.log(`[QUERY ROUTER] Routing to Hybrid Pipeline (General Concept + NIT Kurukshetra RAG)...`);
    callbacks.onStatus?.('Generating conceptual explanation...');
    const generalPart = understanding.hybridSplit?.generalPart || query;
    const institutePart = understanding.hybridSplit?.institutePart || query;

    // 1. Conceptual answer from Gemini
    const generalResult = await generateGeneralAnswerStream(generalPart, { onToken: callbacks.onToken });
    // generateGeneralAnswerStream returns a new String() object with .answer on it
    const generalAnswerText = (generalResult && generalResult.answer) ? generalResult.answer : String(generalResult);
    const generalSuggestions = (generalResult && generalResult.suggestions) ? generalResult.suggestions : [];

    // 2. Institute specific check: course search or RAG
    callbacks.onStatus?.('Searching NIT Kurukshetra records...');
    let instituteAnswer = '';
    let instituteSources = [];

    const courseSearchTerm = resolvedEntities.subject || resolvedEntities.courseCode;
    if (courseSearchTerm) {
      const courses = await courseService.searchCourses(courseSearchTerm, {
        department: resolvedEntities.department || resolvedEntities.branch,
        semester: resolvedEntities.semester,
      });
      if (courses && courses.length > 0) {
        instituteAnswer = formatCoursesResponse(courses, institutePart);
      }
    }

    if (!instituteAnswer) {
      const ragResult = await answerQuestion(institutePart, {
        ...options,
        user,
        rewrittenQuery: understanding.rewrittenQuery,
        expandedTerms: understanding.expandedTerms,
        callbacks,
      });
      instituteAnswer = ragResult.answer;
      instituteSources = ragResult.sources || [];
    }

    const combinedAnswer = `### Conceptual Overview\n\n${generalAnswerText}\n\n---\n\n### At NIT Kurukshetra\n\n${instituteAnswer}`;

    return {
      answer: combinedAnswer,
      suggestions: generalSuggestions,
      queryType: 'hybrid',
      intent: understanding.intent || 'HYBRID_INQUIRY',
      coverage: 'FULL',
      sources: instituteSources,
      structuredData: null,
      clarification: null,
      retrieval: { strategy: 'hybrid_general_and_rag', cached: false },
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE 3: Dynamic Clarification System
  // Clarify ONLY when essential information is genuinely missing and NOT present
  // in user profile or conversation memory.
  // --------------------------------------------------------------------------
  const isPYQQuery = understanding.intent === 'PYQ_SEARCH' || /pyq|previous year|question paper/i.test(query);
  const isMissingSubjectForPYQ = isPYQQuery && !resolvedEntities.subject;

  if (understanding.needsClarification && (isMissingSubjectForPYQ || (understanding.missingInformation?.length > 0 && !resolvedEntities.semester && !resolvedEntities.branch && !resolvedEntities.subject))) {
    const questionText = understanding.clarificationQuestion ||
      (isPYQQuery
        ? "Which subject's previous-year questions do you need? For example: DBMS, Operating Systems, Computer Networks, or Data Structures."
        : "Could you please specify your semester or programme so I can retrieve the exact official document?");

    callbacks.onStatus?.('Clarification needed');
    const clarificationAnswer = `${questionText}\n\nPlease specify your request so I can give you the exact official documents.`;
    callbacks.onToken?.(clarificationAnswer);

    return {
      answer: clarificationAnswer,
      queryType: 'clarification',
      intent: understanding.intent,
      coverage: 'CLARIFICATION',
      sources: [],
      structuredData: null,
      clarification: {
        needed: true,
        question: questionText,
        missingFields: understanding.missingInformation || [],
        resolvedEntities,
      },
      retrieval: { strategy: 'dynamic_clarification', cached: false },
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE 4: Document Discovery & PYQ Search (Integrated Knowledge Source)
  // --------------------------------------------------------------------------
  if (isPYQQuery || understanding.entities?.documentType === 'question_paper') {
    callbacks.onStatus?.('Searching question paper drive...');
    const searchTerm = resolvedEntities.subject || query;
    const examYear = (typeof resolvedEntities.year === 'number' && resolvedEntities.year > 1900)
      ? resolvedEntities.year
      : null;

    const docs = await documentSearchService.searchDocuments(searchTerm, {
      documentType: 'previous_year_paper',
      sourceType: 'student_drive',
      branch: resolvedEntities.branch,
      department: resolvedEntities.department || resolvedEntities.branch,
      semester: resolvedEntities.semester,
      year: examYear,
      courseCode: resolvedEntities.courseCode,
      subject: resolvedEntities.subject,
    });

    if (docs && docs.length > 0) {
      const formattedDocs = formatPyqSearchResponse(docs, query, resolvedEntities);
      const sources = docs.map((d) => ({
        documentId: d.documentId,
        title: d.title,
        category: 'examinations',
        department: d.department || d.branch || 'General',
        documentType: 'previous_year_paper',
        sourceType: 'student_drive',
        sourceAuthority: 'community',
        sourceTrust: 'community',
        sourceName: 'NIT KKR PYQ Drive',
        year: d.year,
        sourceUrl: d.sourceUrl || d.webViewLink,
        pageDisplay: 'Original PDF',
      }));

      callbacks.onSources?.(sources);
      callbacks.onToken?.(formattedDocs);

      const subj = resolvedEntities.subject || 'this course';
      const pyqSuggestions = [
        `What is the ${subj} course syllabus & credit breakdown?`,
        `Do you have previous year papers for other semesters?`,
        `What are the recommended reference books for ${subj}?`,
      ];

      return {
        answer: formattedDocs,
        suggestions: pyqSuggestions,
        queryType: 'document_search',
        intent: 'PYQ_SEARCH',
        sources,
        structuredData: { documents: docs },
        clarification: null,
        retrieval: { strategy: 'pyq_metadata_search', cached: false },
      };
    }

    // Fallback: search indexed chunks with PYQ filters
    console.log('[QUERY ROUTER] No PYQ document metadata matches. Falling back to hybrid RAG...');
    const ragFallback = await answerQuestion(query, {
      ...options,
      user,
      rewrittenQuery: understanding.rewrittenQuery,
      expandedTerms: understanding.expandedTerms,
      filters: { sourceType: 'student_drive' },
      callbacks,
    });

    return {
      ...ragFallback,
      queryType: 'document_search',
      intent: 'PYQ_SEARCH',
      clarification: null,
      retrieval: {
        strategy: 'pyq_rag_fallback',
        cached: ragFallback.cache?.hit || false,
      },
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE 5: Structured Course Catalog Search
  // --------------------------------------------------------------------------
  if (understanding.intent === 'COURSE_CATALOG' || understanding.intent === 'COURSE_SEARCH') {
    callbacks.onStatus?.('Searching course catalog...');
    const courseSearchTerm = resolvedEntities.subject || resolvedEntities.courseCode || query;
    const courses = await courseService.searchCourses(courseSearchTerm, {
      department: resolvedEntities.department || resolvedEntities.branch,
      program: resolvedEntities.program || resolvedEntities.degree,
      semester: resolvedEntities.semester,
    });

    if (courses && courses.length > 0) {
      const formattedText = formatCoursesResponse(courses, query);
      callbacks.onToken?.(formattedText);

      const code = courses[0]?.code || 'this subject';
      const courseSuggestions = [
        `What are the prerequisites for ${code}?`,
        `Are previous year question papers available for ${code}?`,
        `What are the minimum credit requirements for this semester?`,
      ];

      return {
        answer: formattedText,
        suggestions: courseSuggestions,
        queryType: 'structured',
        intent: understanding.intent,
        sources: [],
        structuredData: { courses },
        clarification: null,
        retrieval: { strategy: 'structured_database_search', cached: false },
      };
    }
  }

  // --------------------------------------------------------------------------
  // ROUTE 6: Official NIT Kurukshetra Policy & Regulation RAG (Default Pipeline)
  // Used for: attendance regulations, exam ordinances, placement policies,
  // scholarships, fee structures, hostel rules, etc.
  // --------------------------------------------------------------------------
  console.log(`[QUERY ROUTER] Executing Official Campus RAG pipeline for: "${query}"...`);
  const ragResult = await answerQuestion(query, {
    ...options,
    user,
    rewrittenQuery: understanding.rewrittenQuery,
    expandedTerms: understanding.expandedTerms,
    resolvedEntities,
    callbacks,
  });

  return {
    ...ragResult,
    queryType: 'rag',
    intent: understanding.intent || 'OFFICIAL_REGULATION',
    clarification: null,
    retrieval: {
      strategy: 'hybrid_rag',
      cached: ragResult.cache?.hit || false,
    },
  };
};

export default {
  routeQuery,
};
