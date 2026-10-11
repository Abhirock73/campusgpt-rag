import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Helper to pause execution
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper to filter out internal system tags (e.g. [USED_SOURCES: 1, 2])
 * from the live token stream so students never see raw metadata tags.
 */
class StreamingTokenFilter {
  constructor(onToken) {
    this.onToken = onToken;
    this.buffer = '';
    this.stopped = false;
  }

  push(chunk) {
    if (!this.onToken || this.stopped || !chunk) return;
    this.buffer += chunk;

    const usedIdx = this.buffer.indexOf('[USED_SOURCES');
    const sugIdx = this.buffer.indexOf('[SUGGESTIONS');
    const markerIndex = (usedIdx !== -1 && sugIdx !== -1)
      ? Math.min(usedIdx, sugIdx)
      : (usedIdx !== -1 ? usedIdx : sugIdx);

    if (markerIndex !== -1) {
      // Emit everything prior to the marker
      const toEmit = this.buffer.slice(0, markerIndex);
      if (toEmit) {
        this.onToken(toEmit);
      }
      this.buffer = this.buffer.slice(markerIndex);
      this.stopped = true;
      return;
    }

    // Hold back the trailing 20 characters in case tag is partially split across chunks
    if (this.buffer.length > 25) {
      const safeLength = this.buffer.length - 20;
      const toEmit = this.buffer.slice(0, safeLength);
      this.buffer = this.buffer.slice(safeLength);
      this.onToken(toEmit);
    }
  }

  flush() {
    if (!this.onToken || this.stopped) return;
    if (this.buffer.length > 0) {
      const usedIdx = this.buffer.indexOf('[USED_SOURCES');
      const sugIdx = this.buffer.indexOf('[SUGGESTIONS');
      const markerIndex = (usedIdx !== -1 && sugIdx !== -1)
        ? Math.min(usedIdx, sugIdx)
        : (usedIdx !== -1 ? usedIdx : sugIdx);

      const toEmit = markerIndex !== -1 ? this.buffer.slice(0, markerIndex) : this.buffer;
      if (toEmit) {
        this.onToken(toEmit);
      }
      this.buffer = '';
    }
  }
}

/**
 * Low-level SSE stream consumer for Google Gemini API streamGenerateContent endpoint
 */
async function streamGeminiContent(url, payload, onChunk) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    let errMsg = `Gemini HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error?.message) errMsg = errJson.error.message;
    } catch {}
    throw new Error(errMsg);
  }

  if (!response.body) {
    throw new Error('Gemini response body is missing readable stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullAccumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep last incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (chunkText) {
            fullAccumulated += chunkText;
            if (onChunk) {
              onChunk(chunkText);
            }
          }
        } catch {
          // ignore heartbeat or partial JSON fragment
        }
      }
    }
  }

  // Process any leftover fragment in buffer
  if (buffer.trim().startsWith('data: ')) {
    const jsonStr = buffer.trim().slice(6).trim();
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (chunkText) {
          fullAccumulated += chunkText;
          if (onChunk) onChunk(chunkText);
        }
      } catch {}
    }
  }

  return fullAccumulated;
}

/**
 * Generate a grounded answer using Gemini LLM with streaming support,
 * strictly based on retrieved context chunks.
 * 
 * @param {string} question - User inquiry
 * @param {Array<{ text: string, documentTitle: string, pageNumber: number }>|string} contexts - Retrieved chunks
 * @param {object} [options] - Generation options
 * @param {object} [options.coverageReport] - Evidence coverage assessment
 * @param {function} [options.onToken] - Optional chunk callback for live token streaming
 * @returns {Promise<String>} Grounded answer with .answer and .usedSourceIndices properties
 */
export const generateAnswerStream = async (question, contexts = [], options = {}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured');
  }

  const { coverageReport = null, onToken = null } = options;

  // Format retrieved chunks into context string
  let contextBlock = '';
  if (typeof contexts === 'string') {
    contextBlock = contexts;
  } else if (Array.isArray(contexts) && contexts.length > 0) {
    contextBlock = contexts
      .map(
        (c, idx) =>
          `[Source ${idx + 1}: ${c.documentTitle || 'Document'} | Page ${c.pageNumber || 'N/A'}]\n${c.text}`
      )
      .join('\n\n---\n\n');
  }

  let coverageGuidance = '';
  if (coverageReport) {
    if (coverageReport.coverage === 'PARTIAL') {
      coverageGuidance = `
EVIDENCE COVERAGE STATUS: PARTIAL
MANDATORY INSTRUCTIONS:
1. Answer the user's inquiry directly using all verified facts, rules, and guidelines present in the Context.
2. DO NOT include internal system disclaimers or apologies (e.g. NEVER say "the provided context consists of excerpts", "pages 4, 5, 6", or "not the unbroken document").
3. DO NOT add a separate "What could not be verified" section or explain what query was not fulfilled. Simply provide the verified information directly.
4. DO NOT invent, assume, or extrapolate unverified dates, subjects, or numbers.
5. DO NOT reject the entire answer with "I couldn't find this information" when useful official information is present in Context.`;
    } else if (coverageReport.coverage === 'INSUFFICIENT') {
      coverageGuidance = `
EVIDENCE COVERAGE STATUS: INSUFFICIENT
1. If the user question is underspecified or ambiguous (e.g. asking for "the mid exam schedule" without mentioning semester, branch, or program), ask a concise, helpful clarification question offering specific options (e.g. "Which programme and semester are you asking about? For example: - 7th semester CSE, - 5th semester CSE, - 7th semester ECE").
2. If the user query was already specific but no matching evidence exists in the Context, state clearly: "I couldn't find verified information on this topic in the currently indexed official documents." If any related official information exists in Context, provide it as related context without fabricating.`;
    }
  }

  const systemInstruction = `You are AskCampusAi, an official AI assistant for a university campus.
Your task is to answer the student or faculty member's inquiry using ONLY the provided official context chunks below.

STRICT GROUNDING & RETRIEVAL RULES:
1. Grounding & Zero Hallucination: Base your answer EXCLUSIVELY on the provided Context. DO NOT invent or extrapolate facts, attendance requirements, course codes, deadlines, or rules from general knowledge.
2. Direct Grounded Answers: Present all verified facts, policies, rules, and guidelines found in the Context directly, clearly, and concisely. DO NOT include meta-commentary, apologies, or disclaimers about RAG chunking (e.g. NEVER mention that you only have excerpts, page numbers, or not the unbroken document). DO NOT add separate sections titled "What could not be verified" or explain what query was not fulfilled. Just give the user the verified response based on what was found in the official documents.
3. Multi-Chunk Synthesis: Synthesize and combine relevant evidence across multiple chunks seamlessly (e.g., combining examination dates from one chunk with subject codes or time slots from another).
4. Accuracy & Attribution: Accurately preserve all regulation numbers (e.g. Regulation 1.1, 4.2.3), course codes (e.g. CS302, MEIC 416), dates, percentages, and monetary amounts.
5. Missing Information: If no relevant evidence exists at all, or if the question is ambiguous, follow the guidance provided below. Never guess.
6. Tone: Provide concise, professional, student-friendly answers without technical retrieval jargon (such as BM25, vectors, or RRF).
7. Formatting & Presentation (Dynamic & Content-Aware Markdown):
   - Adapt the response structure naturally to the user's inquiry, matching modern ChatGPT-quality presentation:
   - For simple, direct questions (e.g. asking for a date, venue, single rule, or short definition), give a direct, concise paragraph response without forcing artificial headings or unnecessary bullet lists.
   - For complex, multi-part, or structured topics (e.g., question papers, examination schedules, policies, syllabus outlines, regulations):
     * Use logical Markdown headings (### or ####) to separate major sections instead of raw bold text with trailing colons. Never use excessive or redundant H1/H2 headers.
     * Use short, scannable paragraphs with clean spacing between ideas.
     * Use bullet points (* or -) or numbered lists (1., 2.) only when presenting actual lists, distinct steps, or enumerated conditions.
     * Keep related content unified within its parent bullet point rather than fragmenting one thought or code fragment across multiple dangling sub-bullets.
   - Code & Algorithms: Always encapsulate code snippets, pseudo-code, algorithms, or programmatic statements in standard fenced code blocks with appropriate language tags (such as python, cpp, c, pseudocode, or text). Never break a single snippet into separate inline backtick blocks across fragmented lines.
   - Mathematics & Formulas: Always use standard LaTeX syntax: "$formula$" for inline math expressions (e.g. "$O(1)$", "$116x^4 + 4x^3$", "$N = 6$", "$n - 1$") and "$$formula$$" on separate lines for standalone block formulas or proofs.
   - Tables: Use standard Markdown tables ("| Header 1 | Header 2 |") whenever tabular data, schedules, credit breakdowns, or comparison charts are helpful.
   - Selective Bold: Use **bold** judiciously for critical terms, codes, or deadlines without overusing it.
   - Content Preservation: Preserve exact numbers, equations, technical terms, and original meaning from the source documents. Never invent facts just to satisfy formatting.
8. Source Attribution & Usage Tag:
   - Ground your answer ONLY in the sources that directly contain verified information answering the student's question.
   - At the VERY END of your response, on a final new line, write which Source numbers you actually retrieved information from:
     [USED_SOURCES: 1, 2]
   - If the provided Context does NOT contain information to answer the question, or if you could not find the requested information, state clearly that you couldn't find this information in the official documents, and write:
     [USED_SOURCES: NONE]
9. Dynamic Follow-Up Suggestions (Smart Follow-Up Chips):
   - At the VERY END of your response, on the line directly after [USED_SOURCES: ...], provide 2 to 3 contextual, clickable follow-up questions that a student might logically ask next.
   - Format on a single line strictly as:
     [SUGGESTIONS: "Follow up question 1?", "Follow up question 2?", "Follow up question 3?"]
   - Examples:
     * After attendance rules: [SUGGESTIONS: "How does medical leave condonation work?", "What are the detention consequences for end sem?"]
     * After syllabus or PYQs: [SUGGESTIONS: "What is the DBMS course syllabus & credit breakdown?", "Do you have Computer Networks PYQs for 5th sem too?"]
     * After placement policy: [SUGGESTIONS: "What is the CGPA cutoff for tier-1 companies?", "Can unplaced students apply for off-campus internships?"]`;

  const promptText = `CONTEXT FROM OFFICIAL UNIVERSITY DOCUMENTS:
${contextBlock || 'NO MATCHING CONTEXT FOUND.'}

${coverageGuidance}

USER QUESTION:
${question}

GROUNDED ANSWER:`;

  const configuredModel = process.env.LLM_MODEL || 'gemini-2.0-flash-lite';
  const modelsToTry = [
    configuredModel,
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
  ];

  let lastError;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const streamUrl = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

        const payload = {
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        };

        const tokenFilter = new StreamingTokenFilter(onToken);

        const rawReply = await streamGeminiContent(streamUrl, payload, (chunk) => {
          tokenFilter.push(chunk);
        });

        tokenFilter.flush();

        if (rawReply) {
          const usedMatch = rawReply.match(/\[USED_SOURCES:\s*([^\]]+)\]/i);
          let usedSourceIndices = [];
          if (usedMatch) {
            const val = usedMatch[1].trim();
            if (!val.toLowerCase().includes('none')) {
              usedSourceIndices = val
                .split(',')
                .map((s) => parseInt(s.trim().replace(/[^0-9]/g, ''), 10))
                .filter((n) => !isNaN(n) && n > 0);
            }
          }

          const suggestions = parseSuggestionsFromReply(rawReply);

          const cleanAnswer = rawReply
            .replace(/\n*\[USED_SOURCES:[^\]]*\]/gi, '')
            .replace(/\n*\[SUGGESTIONS:[^\]]*\]/gi, '')
            .trim();

          // Return string object with attached metadata for 100% backward compatibility
          const result = new String(cleanAnswer);
          result.answer = cleanAnswer;
          result.usedSourceIndices = usedSourceIndices;
          result.suggestions = suggestions;
          return result;
        }
      } catch (err) {
        lastError = err;
        if (err.message?.includes('high demand') || err.message?.includes('503')) {
          await sleep(1200);
        }
      }
    }
  }

  throw new Error(`[LLM Service Failed] ${lastError?.message || 'Unable to generate response'}`);
};

/**
 * Generate a grounded answer (synchronous signature, backward compatible)
 */
export const generateAnswer = async (question, contexts = [], options = {}) => {
  return generateAnswerStream(question, contexts, options);
};

/**
 * Generate an answer for general knowledge, coding, or concept questions
 * using Gemini's general model knowledge directly with streaming support.
 * 
 * @param {string} question - User question
 * @param {object|string} [optionsOrSystemContext] - Options or optional context string
 * @returns {Promise<string>} Rich formatted response
 */
export const generateGeneralAnswerStream = async (question, optionsOrSystemContext = {}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured');
  }

  const options = typeof optionsOrSystemContext === 'string'
    ? { systemContext: optionsOrSystemContext }
    : optionsOrSystemContext || {};

  const { systemContext = '', onToken = null } = options;

  const systemInstruction = `You are CampusGPT, an intelligent academic and technical AI assistant.
Answer the user's question clearly, accurately, and thoroughly using modern ChatGPT-style presentation.
Formatting Guidelines:
- Use clean Markdown headings (### or ####) for structured topics.
- For coding, algorithms, or technical definitions, provide well-commented code snippets in fenced code blocks.
- For mathematics or theory, use LaTeX notation ($inline$, $$block$$).
- Use bullet points or numbered steps for explanations and comparisons.
- Be concise, educational, and helpful.
- At the VERY END of your answer, on a final line, suggest 2 to 3 concise, clickable follow-up questions:
  [SUGGESTIONS: "Follow-up question 1?", "Follow-up question 2?"]`;

  const configuredModel = process.env.LLM_MODEL || 'gemini-2.0-flash-lite';
  const modelsToTry = [
    configuredModel,
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
  ];

  let lastError;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const streamUrl = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const payload = {
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              parts: [{ text: systemContext ? `${systemContext}\n\nQuestion: ${question}` : question }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        };

        const tokenFilter = new StreamingTokenFilter(onToken);

        const rawReply = await streamGeminiContent(streamUrl, payload, (chunk) => {
          tokenFilter.push(chunk);
        });

        tokenFilter.flush();

        if (rawReply) {
          const suggestions = parseSuggestionsFromReply(rawReply);
          const cleanAnswer = rawReply
            .replace(/\n*\[SUGGESTIONS:[^\]]*\]/gi, '')
            .trim();

          const result = new String(cleanAnswer);
          result.answer = cleanAnswer;
          result.suggestions = suggestions;
          return result;
        }
      } catch (err) {
        lastError = err;
        if (err.message?.includes('high demand') || err.message?.includes('503')) {
          await sleep(1200);
        }
      }
    }
  }

  throw new Error(`[LLM General Failed] ${lastError?.message || 'Unable to generate response'}`);
};

/**
 * Generate general answer (backward compatible non-streaming signature)
 */
export const generateGeneralAnswer = async (question, systemContext = '') => {
  return generateGeneralAnswerStream(question, { systemContext });
};

/**
 * Helper to parse [SUGGESTIONS: ...] from LLM response text
 */
export const parseSuggestionsFromReply = (rawReply) => {
  if (!rawReply || typeof rawReply !== 'string') return [];
  const sugMatch = rawReply.match(/\[SUGGESTIONS:\s*(\[.*?\]|.+?)\]/is);
  if (!sugMatch) return [];

  const content = sugMatch[1].trim();
  try {
    if (content.startsWith('[') && content.endsWith(']')) {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter((s) => s.length > 3)
          .slice(0, 3);
      }
    }
  } catch {}

  const matches = content.match(/"([^"]+)"|'([^']+)'/g);
  if (matches && matches.length > 0) {
    return matches
      .map((s) => s.replace(/^["']|["']$/g, '').trim())
      .filter((s) => s.length > 3)
      .slice(0, 3);
  }

  return content
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 3)
    .slice(0, 3);
};

/**
 * Derive clean heuristic title from user inquiry
 */
export const deriveFallbackTitle = (query) => {
  if (!query || typeof query !== 'string') return 'Campus Inquiry';
  const cleaned = query
    .replace(/[?.,!/\\#@$%^&*()_+={}\[\]<>:;~`|"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w.length > 1);
  if (words.length === 0) return 'Campus Inquiry';
  const prefixDrop = /^(can|could|please|give|tell|what|when|where|how|who|why|is|are|the|show|explain)$/i;
  const filtered = words.filter((w) => !prefixDrop.test(w));
  const finalWords = filtered.length > 0 ? filtered.slice(0, 4) : words.slice(0, 4);
  return finalWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

/**
 * Automatically generate short 2-4 word conversation title using Gemini
 */
export const generateConversationTitle = async (userQuery, assistantAnswer = '') => {
  if (!userQuery || !userQuery.trim()) {
    return 'Campus Inquiry';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return deriveFallbackTitle(userQuery);
  }

  try {
    const prompt = `You are a concise title generator for a university student chat assistant.
Generate a short, descriptive 2 to 4 word topic title for the conversation that begins with the inquiry below.
Rules:
- 2 to 4 words maximum.
- Title Case.
- Do NOT use punctuation, quotes, or markdown.
- Do NOT use generic words like "Chat", "Query", "Question", "Inquiry", or "Conversation".
- Capture the specific university subject, policy, or exam topic.

Examples:
- "What are the attendance rules for 6th sem?" -> Attendance Regulations
- "DBMS mid sem PYQs 2024" -> DBMS Exam Prep
- "How does minor degree registration work?" -> Minor Degree Guidelines
- "Placement eligibility criteria for CSE" -> Placement Policy Queries
- "Hostel curfew timings and mess rules" -> Hostel Rules & Timings

User Inquiry: "${userQuery.slice(0, 300)}"
Topic Title:`;

    const model = process.env.LLM_MODEL || 'gemini-2.0-flash-lite';
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 25,
        },
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const rawTitle = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawTitle) {
        const cleaned = rawTitle
          .replace(/["'*#_:`]/g, '')
          .replace(/\n/g, ' ')
          .trim();
        if (cleaned && cleaned.length >= 3 && cleaned.length <= 60) {
          return cleaned;
        }
      }
    }
  } catch (err) {
    console.warn(`[Title Generation] Fallback used: ${err.message}`);
  }

  return deriveFallbackTitle(userQuery);
};

export default {
  generateAnswer,
  generateAnswerStream,
  generateGeneralAnswer,
  generateGeneralAnswerStream,
  generateConversationTitle,
  deriveFallbackTitle,
  parseSuggestionsFromReply,
};
