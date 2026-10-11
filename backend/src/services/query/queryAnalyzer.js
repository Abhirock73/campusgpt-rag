/**
 * Modular Query Analyzer (Phase 6 & 7 RAG Enhancement)
 * Extracts structured university domain signals:
 * - intent
 * - entities (department, program, semester, course code, regulation number, etc.)
 * - requested fields (e.g. ['subject', 'date', 'time'])
 * - time / year / academicYear
 * - examType (mid_semester, end_semester, etc.)
 * - documentType
 * - category
 * - search query & normalized query
 * - query expansion variants
 */

import {
  ROMAN_SEMESTER_MAP,
  SEMESTER_TO_ROMAN,
  normalizeUniversityTerms,
  detectExamType,
  extractRequestedFields,
  extractAcademicYear,
} from './queryTerminology.js';

// Department aliases mapping
const DEPARTMENT_MAP = {
  cse: 'Computer Science & Engineering',
  'computer science': 'Computer Science & Engineering',
  'computer engineering': 'Computer Engineering',
  computer: 'Computer Engineering',
  cs: 'Computer Science & Engineering',
  it: 'Information Technology',
  ece: 'Electronics & Communication Engineering',
  electronics: 'Electronics & Communication Engineering',
  mech: 'Mechanical Engineering',
  mechanical: 'Mechanical Engineering',
  civil: 'Civil Engineering',
  ee: 'Electrical Engineering',
  electrical: 'Electrical Engineering',
};

// Program aliases
const PROGRAM_MAP = {
  'b.tech': 'B.Tech',
  btech: 'B.Tech',
  'b tech': 'B.Tech',
  'm.tech': 'M.Tech',
  mtech: 'M.Tech',
  'm tech': 'M.Tech',
  mca: 'MCA',
  mba: 'MBA',
  phd: 'PhD',
  'ph.d': 'PhD',
};

// Common subject / topic keywords
const SUBJECT_KEYWORDS = [
  'machine learning',
  'artificial intelligence',
  'ai/ml',
  'ai',
  'dbms',
  'database management systems',
  'databases',
  'operating systems',
  'computer networks',
  'data structures',
  'algorithms',
  'compiler design',
  'software engineering',
  'web development',
  'cloud computing',
  'cyber security',
  'cryptography',
  'deep learning',
];

// Document Type detection
const DOCUMENT_TYPE_MAP = {
  previous_year_paper: ['previous year', 'past paper', 'pyq', 'pyqs', 'question paper', 'past year paper', 'old paper'],
  regulation: ['regulation', 'rule', 'ordinance', 'policy', 'by-law'],
  academic_calendar: ['academic calendar', 'calendar', 'datesheet', 'deadline'],
  syllabus: ['syllabus', 'curriculum', 'course outline'],
  exam_notification: ['exam notification', 'examination schedule', 'mid exam schedule', 'end exam schedule', 'mid semester schedule', 'end semester schedule', 'exam date', 'datesheet'],
  notice: ['notice', 'circular', 'announcement', 'order'],
  handbook: ['handbook', 'manual', 'guide'],
};

// Category mapping
const CATEGORY_MAP = {
  hostel: ['hostel', 'curfew', 'room', 'warden', 'mess', 'in-time', 'boarding'],
  examinations: ['exam', 'examination', 'grading', 'marks', 'passing criteria', 'backlog', 'grades', 'grade point', 'cgpa', 'sgpa', 'datesheet', 'mid sem', 'end sem', 'mse', 'ese'],
  academics: ['attendance', 'academic', 'semester', 'lecture', 'condonation', 'debarred', 'credit', 'syllabus'],
  admissions: ['admission', 'enrollment', 'eligibility', 'cutoff', 'seat', 'fee payment'],
  courses: ['course', 'elective', 'prerequisite', 'syllabus', 'credits', 'curriculum'],
  placements: ['placement', 'internship', 'package', 'recruiter', 'interview', 'job'],
  notices: ['notice', 'circular', 'announcement', 'order'],
};

/**
 * Analyze a raw student query and extract structured university signals
 * @param {string} rawQuery - Student message
 * @returns {object} Extracted domain entities & cleaned search terms
 */
export const analyzeQuery = (rawQuery = '') => {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return {
      rawQuery: '',
      searchQuery: '',
      normalizedQuery: '',
      intent: null,
      examType: null,
      requestedFields: [],
      department: null,
      program: null,
      semester: null,
      year: null,
      academicYear: null,
      regulationNumber: null,
      courseCode: null,
      subject: null,
      documentType: null,
      category: null,
      eventType: null,
      exactPhrases: [],
    };
  }

  const query = rawQuery.trim();
  const lower = query.toLowerCase();
  const normalizedQuery = normalizeUniversityTerms(query);
  const normalizedLower = normalizedQuery.toLowerCase();

  let department = null;
  let program = null;
  let semester = null;
  let year = null;
  let academicYear = null;
  let regulationNumber = null;
  let courseCode = null;
  let subject = null;
  let documentType = null;
  let category = null;
  let eventType = null;
  let intent = null;
  const exactPhrases = [];

  // 1. Exam Type detection
  const examType = detectExamType(query) || detectExamType(normalizedQuery);

  // 2. Requested fields detection (e.g. ['subject', 'date', 'time'])
  const requestedFields = extractRequestedFields(query);

  // 3. Academic Year detection (e.g. "2025-26")
  academicYear = extractAcademicYear(query) || extractAcademicYear(normalizedQuery);

  // 4. Semester extraction (e.g. "6th semester", "semester 6", "sem 4", "7th sem", "semester VII")
  const semMatch = query.match(/\b(?:semester|sem)\s*([1-8])\b|\b([1-8])(?:st|nd|rd|th)?\s*(?:semester|sem)\b/i);
  if (semMatch) {
    semester = parseInt(semMatch[1] || semMatch[2], 10);
    exactPhrases.push(`semester ${semester}`);
  } else {
    // Check Roman numeral semester
    const romanMatch = query.match(/\b(?:semester|sem)\s+(i|ii|iii|iv|v|vi|vii|viii)\b|\b(i|ii|iii|iv|v|vi|vii|viii)\s+(?:semester|sem)\b/i);
    if (romanMatch) {
      const romanStr = (romanMatch[1] || romanMatch[2]).toLowerCase();
      if (ROMAN_SEMESTER_MAP[romanStr]) {
        semester = ROMAN_SEMESTER_MAP[romanStr];
        exactPhrases.push(`semester ${semester}`);
      }
    }
  }

  // 5. Program extraction (e.g. "B.Tech", "M.Tech", "MCA")
  for (const [alias, canonicalProgram] of Object.entries(PROGRAM_MAP)) {
    const regex = new RegExp(`\\b${alias.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(query)) {
      program = canonicalProgram;
      exactPhrases.push(canonicalProgram);
      break;
    }
  }

  // 6. Department extraction
  for (const [alias, canonicalDept] of Object.entries(DEPARTMENT_MAP)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(query) || regex.test(normalizedQuery)) {
      department = canonicalDept;
      break;
    }
  }

  // 7. Course Code extraction (e.g. "CS301", "CS-402", "IT202", "MEIC 416")
  const codeMatch = query.match(/\b([A-Z]{2,4})[- ]?([0-9]{3})\b/i);
  if (codeMatch) {
    courseCode = `${codeMatch[1].toUpperCase()}${codeMatch[2]}`;
    exactPhrases.push(courseCode);
  }

  // 8. Regulation or Section number (e.g. "regulation 4.2.3", "section 1.2")
  const regMatch = query.match(/(?:regulation|section|rule|clause)\s+([0-9]+(?:\.[0-9]+)+|[0-9]+)/i);
  if (regMatch) {
    regulationNumber = regMatch[1];
    exactPhrases.push(regMatch[0]);
    documentType = 'regulation';
  }

  // 9. Year and Year-Range extraction (e.g. 2017, 2024, or "from 2020 to 2025")
  let startYear = null;
  let endYear = null;
  const yearRangeMatch = query.match(/\b(20\d{2}|19\d{2})\s*(?:to|-|till)\s*(20\d{2}|19\d{2})\b/i);
  if (yearRangeMatch) {
    startYear = parseInt(yearRangeMatch[1], 10);
    endYear = parseInt(yearRangeMatch[2], 10);
  }

  const yearMatch = query.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  // 10. Subject / Topic extraction
  for (const s of SUBJECT_KEYWORDS) {
    const regex = new RegExp(`\\b${s.replace('/', '[/\\s]')}\\b`, 'i');
    if (regex.test(lower)) {
      subject = s.toUpperCase() === s ? s : s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      exactPhrases.push(subject);
      break;
    }
  }

  // 11. Event Type extraction for academic calendar/deadlines
  if (/\b(registration|enrollment)\b/i.test(lower)) eventType = 'registration';
  else if (/\b(exam|examination|end-sem|mid-sem|datesheet)\b/i.test(lower)) eventType = 'examination';
  else if (/\b(fee|payment|dues)\b/i.test(lower)) eventType = 'fee_payment';
  else if (/\b(holiday|vacation|break)\b/i.test(lower)) eventType = 'holiday';
  else if (/\b(result|grades)\b/i.test(lower)) eventType = 'result';
  else if (/\b(deadline|last date)\b/i.test(lower)) eventType = 'deadline';

  // 12. Document Type extraction
  if (!documentType) {
    for (const [docType, keywords] of Object.entries(DOCUMENT_TYPE_MAP)) {
      if (keywords.some((k) => lower.includes(k) || normalizedLower.includes(k))) {
        documentType = docType;
        break;
      }
    }
  }

  // 13. Category extraction
  const matchedCategories = [];
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some((k) => lower.includes(k) || normalizedLower.includes(k))) {
      matchedCategories.push(cat);
    }
  }
  if (matchedCategories.length === 1) {
    category = matchedCategories[0];
  } else if (examType || eventType === 'examination') {
    category = 'examinations';
  }

  // 14. Primary High-Level Intent
  if (examType || (eventType === 'examination' && (semester || department || requestedFields.includes('date')))) {
    intent = 'exam_schedule';
  } else if (eventType === 'registration') {
    intent = 'registration';
  } else if (eventType === 'deadline' || eventType === 'holiday') {
    intent = 'academic_calendar';
  } else if (subject || courseCode) {
    intent = 'course_inquiry';
  } else if (regulationNumber) {
    intent = 'regulation_inquiry';
  } else {
    intent = 'policy_question';
  }

  // 14b. Source Type Preference
  let sourceType = null;
  const isPYQ =
    /\b(previous year|past paper|pyq|pyqs|question paper|past year paper|old paper|exam paper)\b/i.test(lower) ||
    documentType === 'previous_year_paper';

  if (isPYQ) {
    sourceType = 'student_drive';
  } else if (
    /\b(placement policy|official|syllabus|curriculum|exam schedule|academic calendar|ordinance|rules|regulations|notice|circular)\b/i.test(lower)
  ) {
    sourceType = 'official_nitkkr';
  }

  // 15. Clean search query
  const cleanedSearchQuery = query
    .replace(
      /^(?:what is|what are|when is|where can i find|can you tell me|show me|find|please tell me about|tell me about|how to|do you know|what does|give me the|give me|tell me)\s+/i,
      ''
    )
    .replace(/[?!.]+$/, '')
    .trim();

  return {
    rawQuery: query,
    searchQuery: cleanedSearchQuery || query,
    normalizedQuery,
    intent,
    examType,
    requestedFields,
    department,
    branch: department,
    program,
    semester,
    year,
    startYear,
    endYear,
    academicYear,
    regulationNumber,
    courseCode,
    subject,
    documentType,
    category,
    eventType,
    sourceType,
    exactPhrases,
  };
};

/**
 * Generate a controlled set of retrieval query variants (2 to 4 variants)
 * Combines domain-aware normalization and multi-field decomposition to ensure
 * robust retrieval across semantically equivalent queries.
 *
 * @param {string} rawQuery 
 * @param {object} [analysis] 
 * @returns {Array<string>} List of query variants
 */
export const expandQuery = (rawQuery = '', analysis = null) => {
  if (!rawQuery || typeof rawQuery !== 'string') return [];
  const parsed = analysis || analyzeQuery(rawQuery);
  const variants = new Set();

  const semStr = parsed.semester ? `${parsed.semester}th semester` : '';
  const romanSem = parsed.semester && SEMESTER_TO_ROMAN[parsed.semester] ? `semester ${SEMESTER_TO_ROMAN[parsed.semester]}` : '';
  const deptShort = parsed.department
    ? parsed.department.includes('Computer Science')
      ? 'CSE'
      : parsed.department.includes('Electronics')
      ? 'ECE'
      : parsed.department.includes('Information Technology')
      ? 'IT'
      : parsed.department.includes('Mechanical')
      ? 'Mechanical'
      : parsed.department.includes('Civil')
      ? 'Civil'
      : parsed.department.includes('Electrical')
      ? 'Electrical'
      : parsed.department
    : '';

  // Strategy 1: Exam Schedule queries
  if (parsed.examType || parsed.intent === 'exam_schedule' || /\b(exam|examination|schedule|datesheet|mid|end)\b/i.test(rawQuery)) {
    const examLabel =
      parsed.examType === 'mid_semester'
        ? 'mid semester examination'
        : parsed.examType === 'end_semester'
        ? 'end semester examination'
        : 'examination';

    if (parsed.semester && deptShort) {
      variants.add(`${examLabel} schedule ${semStr} ${deptShort}`);
      variants.add(`${semStr} ${deptShort} ${examLabel} dates`);
      if (romanSem) variants.add(`${deptShort} ${romanSem} examination schedule`);
      variants.add(`${semStr} examination date ${deptShort}`);
    } else if (parsed.semester) {
      variants.add(`${examLabel} schedule ${semStr}`);
      variants.add(`${semStr} examination dates`);
      if (romanSem) variants.add(`${romanSem} examination schedule`);
    } else if (deptShort) {
      variants.add(`${examLabel} schedule ${deptShort}`);
      variants.add(`${deptShort} examination dates`);
    }
  }

  // Strategy 2: Course / Subject queries
  if (parsed.subject || parsed.courseCode) {
    if (parsed.courseCode) {
      variants.add(`${parsed.courseCode} syllabus course curriculum`);
      variants.add(`course details ${parsed.courseCode}`);
    }
    if (parsed.subject && semStr) {
      variants.add(`${parsed.subject} syllabus ${semStr} ${deptShort}`);
    }
  }

  // Strategy 3: Normalized query variant
  const normalizedCleaned = normalizeUniversityTerms(rawQuery)
    .replace(
      /^(?:what is|what are|when is|where can i find|can you tell me|show me|find|give me the|give me|tell me about)\s+/i,
      ''
    )
    .replace(/[?!.]+$/, '')
    .trim();

  if (normalizedCleaned && normalizedCleaned.toLowerCase() !== rawQuery.toLowerCase().trim()) {
    variants.add(normalizedCleaned);
  }

  // Filter out exact matches to original query and cap at 4 variants
  return Array.from(variants)
    .filter((v) => v && v.toLowerCase() !== rawQuery.toLowerCase().trim())
    .slice(0, 4);
};

export default {
  analyzeQuery,
  expandQuery,
  normalizeUniversityTerms,
};
