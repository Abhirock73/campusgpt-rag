import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { chatAPI } from '../services/api';
import {
  GraduationCap,
  User,
  ArrowUp,
  RotateCcw,
  FileText,
  ChevronDown,
  Sparkles,
  BookOpen,
  Calendar,
  ShieldAlert,
  Building,
  ExternalLink,
  Copy,
  Check,
  Menu,
  MoreVertical,
  SquarePen,
  Trash2,
  Bell,
} from 'lucide-react';

const getSourceUrl = (src) => {
  if (!src) return null;
  const url = src.sourceUrl || src.sourcePageUrl || src.url;
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  // If relative path like /api/documents/:id/file
  const rawApiBase = import.meta.env.VITE_API_BASE_URL || '/api';
  const origin = rawApiBase.startsWith('http')
    ? rawApiBase.replace(/\/api\/?$/, '')
    : '';
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
};

const formatSourceDomain = (url) => {
  if (!url) return '';
  try {
    if (url.startsWith('http')) {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').filter(Boolean).pop();
      if (filename && filename.length < 24) {
        return `${parsed.hostname}/.../${filename}`;
      }
      return parsed.hostname;
    }
    return 'View Document';
  } catch {
    return 'View Link';
  }
};

const SUGGESTED_PROMPTS = [
  {
    icon: Building,
    label: 'Placement Policy',
    prompt: 'Give me detail placement policy and eligibility criteria.',
  },
  {
    icon: Calendar,
    label: 'Mid-Sem Examination',
    prompt: 'When are the mid semester examinations scheduled for 7th semester CSE?',
  },
  {
    icon: ShieldAlert,
    label: 'Attendance Regulations',
    prompt: 'What is the minimum attendance requirement to appear in examinations?',
  },
  {
    icon: BookOpen,
    label: 'Hostel Rules',
    prompt: 'What are the hostel curfew timings and disciplinary rules?',
  },
];

const formatMarkdownContent = (text) => {
  if (!text || typeof text !== 'string') return '';
  let processed = text;
  // Normalize LaTeX delimiters \( ... \) -> $ ... $ and \[ ... \] -> $$ ... $$
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, match) => `$${match}$`);
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, match) => `$$${match}$$`);
  // Fix headings without space: e.g. "###Heading" -> "### Heading"
  processed = processed.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  return processed;
};

const CodeBlock = ({ className, children }) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';

  const extractText = (elem) => {
    if (!elem) return '';
    if (typeof elem === 'string') return elem;
    if (typeof elem === 'number') return String(elem);
    if (Array.isArray(elem)) return elem.map(extractText).join('');
    if (elem?.props?.children) return extractText(elem.props.children);
    return '';
  };

  const rawCode = extractText(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-campus-border bg-[#141517] shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1b1c20] border-b border-campus-border/70 text-[11px] text-campus-muted font-mono select-none">
        <span className="uppercase font-semibold tracking-wider text-zinc-400">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          type="button"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-zinc-700/60 hover:text-white transition-colors cursor-pointer"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs font-mono leading-relaxed text-zinc-200">
        <code>{rawCode}</code>
      </pre>
    </div>
  );
};

const Assistant = ({ onOpenMobileNav }) => {
  const { user, logout } = useAuth();
  const {
    activeChatId,
    activeMessages,
    createNewChat,
    deleteChat,
    addMessageToActiveChat,
    addAssistantMessageToActiveChat,
    updateMessageInChat,
    setConversationSessionId,
  } = useChat();
  const location = useLocation();
  const navigate = useNavigate();

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState(null);

  const scrollContainerRef = useRef(null);
  const isUserScrolledUpRef = useRef(false);
  const scrollRafRef = useRef(null);
  const textareaRef = useRef(null);
  const menuRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Monitor user scrolling: if user intentionally scrolls up, pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    isUserScrolledUpRef.current = distanceFromBottom > 120;
  }, []);

  // Vibration-free instant container scroll
  const scrollToBottom = useCallback((force = false) => {
    if (!scrollContainerRef.current) return;
    if (!force && isUserScrolledUpRef.current) return;

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [activeMessages, isTyping, scrollToBottom]);

  // Clean up streaming connection on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Close 3-dots dropdown menu when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [showMenu]);

  // Handle URL query ?new=true
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('new') === 'true') {
      createNewChat();
      navigate('/assistant', { replace: true });
    }
  }, [location.search, navigate, createNewChat]);

  // Auto-resize textarea
  const handleInputChange = (e) => {
    setInputValue(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyMessage = async (msgId, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputValue).trim();
    if (!query || isTyping) return;

    // Abort any existing in-flight request if present
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMsg = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Save message into active chat session
    const targetChatId = addMessageToActiveChat(userMsg);
    let sessionChatId = targetChatId;

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsTyping(true);
    isUserScrolledUpRef.current = false;
    scrollToBottom(true);

    const assistantMsgId = `asst-${Date.now()}`;
    const initialAssistantMsg = {
      id: assistantMsgId,
      sender: 'assistant',
      text: '',
      status: 'Searching official documents...',
      isStreaming: true,
      sources: [],
      clarification: null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    addAssistantMessageToActiveChat(initialAssistantMsg, targetChatId);

    const convIdToSend = targetChatId && !targetChatId.startsWith('temp_') ? targetChatId : null;

    try {
      await chatAPI.streamMessage(
        query,
        { conversationId: convIdToSend },
        {
          onConnected: (data) => {
            if (data?.conversationId) {
              setConversationSessionId(sessionChatId, data.conversationId, data.conversationTitle);
              sessionChatId = data.conversationId;
            }
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                status: prev.status || 'Searching official documents...',
              }),
              sessionChatId
            );
          },
          onMetadata: (meta) => {
            if (meta?.conversationId) {
              setConversationSessionId(sessionChatId, meta.conversationId, meta.conversationTitle);
              sessionChatId = meta.conversationId;
            }
          },
          onStatus: (statusMsg) => {
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                status: statusMsg,
              }),
              sessionChatId
            );
          },
          onSources: (retrievedSources) => {
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                sources: retrievedSources && retrievedSources.length > 0 ? retrievedSources : prev.sources,
              }),
              sessionChatId
            );
          },
          onToken: (tokenChunk) => {
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                text: (prev.text || '') + tokenChunk,
                status: null, // Clear status chip once tokens start arriving
              }),
              sessionChatId
            );
          },
          onDone: (doneData) => {
            if (doneData?.conversationId) {
              setConversationSessionId(sessionChatId, doneData.conversationId, doneData.conversationTitle);
              sessionChatId = doneData.conversationId;
            }
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                text: doneData.answer || prev.text,
                sources: (doneData.sources && doneData.sources.length > 0) ? doneData.sources : prev.sources,
                suggestions: (doneData.suggestions && doneData.suggestions.length > 0) ? doneData.suggestions : (prev.suggestions || []),
                clarification: doneData.clarification || prev.clarification || null,
                status: null,
                isStreaming: false,
              }),
              sessionChatId
            );
          },
          onError: (errData) => {
            updateMessageInChat(
              assistantMsgId,
              (prev) => ({
                ...prev,
                text: prev.text || "I'm temporarily having trouble accessing university records right now. Please try asking your question again in a moment.",
                isFallback: true,
                originalQuery: query,
                status: null,
                isStreaming: false,
              }),
              sessionChatId
            );
          },
        },
        controller.signal
      );
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      console.warn('[CampusGPT] Chat query error:', err?.message || err);

      let fallbackText = "I'm temporarily having trouble accessing university records right now. Please try asking your question again in a moment, or try asking about another topic such as courses, syllabus, exam schedules, or hostel guidelines.";
      if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('Too many requests')) {
        fallbackText = "I'm receiving requests a bit quickly right now. Please wait a few seconds and try again.";
      }

      updateMessageInChat(
        assistantMsgId,
        (prev) => ({
          ...prev,
          text: prev.text || fallbackText,
          isFallback: true,
          originalQuery: query,
          status: null,
          isStreaming: false,
        }),
        sessionChatId
      );
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-campus-bg text-campus-text select-text">
      {/* Sticky Top Header Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-3 sm:px-4 py-2 bg-campus-bg/95 backdrop-blur-md flex-shrink-0 select-none">
        {/* Left: Sidebar Toggle Button (Mobile only) */}
        <div className="flex items-center">
          <button
            onClick={onOpenMobileNav}
            className="md:hidden w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center border border-zinc-700/50 transition-colors cursor-pointer"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Right: New Chat & Three Dots Action */}
        <div className="flex items-center justify-end gap-1.5 relative" ref={menuRef}>
          <button
            onClick={() => {
              createNewChat();
              setShowMenu(false);
            }}
            className="w-9 h-9 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center border border-zinc-700/50 transition-colors cursor-pointer"
            title="Start new chat"
            aria-label="New chat"
          >
            <SquarePen className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowMenu((prev) => !prev)}
            className={`w-9 h-9 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
              showMenu
                ? 'bg-zinc-700 text-white border-zinc-500'
                : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700/50'
            }`}
            title="Options menu"
            aria-label="Options"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* Three Dots Dropdown Menu */}
          {showMenu && (
            <div className="absolute right-0 top-11 w-48 py-1.5 bg-[#1a1b1e] border border-campus-border rounded-xl shadow-2xl z-50 text-xs text-zinc-200">
              <button
                onClick={() => {
                  createNewChat();
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-800/80 text-left transition-colors"
              >
                <SquarePen className="w-4 h-4 text-blue-400" />
                <span>New Chat</span>
              </button>

              <div className="my-1 border-t border-campus-border/50" />

              <button
                onClick={() => {
                  navigate('/documents');
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-800/80 text-left transition-colors"
              >
                <FileText className="w-4 h-4 text-zinc-400" />
                <span>Official Documents</span>
              </button>

              <button
                onClick={() => {
                  navigate('/courses');
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-800/80 text-left transition-colors"
              >
                <BookOpen className="w-4 h-4 text-zinc-400" />
                <span>Courses & Syllabus</span>
              </button>

              <button
                onClick={() => {
                  navigate('/notices');
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-zinc-800/80 text-left transition-colors"
              >
                <Bell className="w-4 h-4 text-zinc-400" />
                <span>Campus Notices</span>
              </button>

              {activeChatId && (
                <>
                  <div className="my-1 border-t border-campus-border/50" />
                  <button
                    onClick={() => {
                      deleteChat(activeChatId);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-red-500/10 text-red-400 text-left transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                    <span>Delete Conversation</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Conversation Stream */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 overscroll-contain"
      >
        <div className="max-w-3xl mx-auto w-full">
          {/* Empty State / Welcome Hero */}
          {activeMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-2">
              <div className="w-14 h-14 rounded-2xl bg-campus-card border border-campus-border text-blue-400 flex items-center justify-center mb-4 shadow-sm">
                <GraduationCap className="w-7 h-7" />
              </div>

              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                How can I help you today?
              </h2>
              <p className="text-sm text-campus-muted max-w-md mt-2 leading-relaxed">
                Ask anything about NIT Kurukshetra — admissions, courses, examinations, hostel rules, or placement policies.
              </p>

              {/* Classic Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl mt-8">
                {SUGGESTED_PROMPTS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(item.prompt)}
                      className="p-3.5 rounded-xl border border-campus-border bg-campus-card/70 hover:bg-campus-card hover:border-zinc-500 text-left transition-all duration-150 group shadow-sm cursor-pointer"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-white mb-1">
                        <Icon className="w-4 h-4 text-blue-400 group-hover:text-blue-300" />
                        <span>{item.label}</span>
                      </div>
                      <p className="text-xs text-campus-muted line-clamp-2 leading-relaxed">
                        {item.prompt}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Active Message List — Matching ChatGPT Mobile Layout (Full Width Response) */
            <div className="space-y-4 sm:space-y-6 pb-4">
              {activeMessages.map((msg) => {
                const isUser = msg.sender === 'user';
                return isUser ? (
                  /* User Message: Clean pill bubble on right */
                  <div key={msg.id} className="flex justify-end my-2 sm:my-3">
                    <div className="max-w-[85%] sm:max-w-[75%] rounded-3xl px-4 py-2.5 bg-blue-600 text-white text-sm sm:text-[15px] leading-relaxed shadow-sm">
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  </div>
                ) : (
                  /* Assistant Message: ChatGPT Mobile Style — Full width, edge-to-edge typography, no cramped bubble */
                  <div key={msg.id} className="w-full my-3 sm:my-5 space-y-2.5">
                    {/* Live Status Pill when searching/retrieving (only before text arrives to avoid layout pop) */}
                    {msg.status && !msg.text && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-xs text-zinc-300">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                        <span className="text-xs text-zinc-300 font-medium">{msg.status}</span>
                      </div>
                    )}

                    {/* Full Width Markdown Text */}
                    {msg.text ? (
                      <div className="w-full text-zinc-100 text-sm sm:text-[15px] leading-relaxed select-text space-y-3">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
                          components={{
                            h1: ({ children }) => (
                              <h1 className="text-lg sm:text-xl font-bold text-white mt-5 mb-2 tracking-tight first:mt-0 pb-1 border-b border-campus-border/40">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-base sm:text-lg font-bold text-white mt-4 mb-2 tracking-tight first:mt-0">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-sm sm:text-base font-semibold text-white mt-3.5 mb-1.5 first:mt-0">
                                {children}
                              </h3>
                            ),
                            h4: ({ children }) => (
                              <h4 className="text-xs sm:text-sm font-semibold text-zinc-300 mt-3 mb-1 first:mt-0">
                                {children}
                              </h4>
                            ),
                            p: ({ children }) => (
                              <p className="mb-2.5 last:mb-0 leading-relaxed text-zinc-200">
                                {children}
                              </p>
                            ),
                            ul: ({ children }) => (
                              <ul className="space-y-1.5 my-2.5 list-disc pl-5 marker:text-zinc-400 leading-relaxed">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="space-y-1.5 my-2.5 list-decimal pl-5 marker:text-zinc-400 leading-relaxed">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => (
                              <li className="leading-relaxed pl-1 my-1 text-zinc-200">
                                {children}
                              </li>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-white tracking-wide">
                                {children}
                              </strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic text-zinc-300">{children}</em>
                            ),
                            pre: ({ children }) => {
                              const codeChild =
                                React.Children.toArray(children).find(
                                  (c) => React.isValidElement(c) && (c.type === 'code' || c.props?.className)
                                ) || (React.isValidElement(children) ? children : null);
                              const codeProps = codeChild?.props || {};
                              return (
                                <CodeBlock className={codeProps.className}>
                                  {codeProps.children || children}
                                </CodeBlock>
                              );
                            },
                            code: ({ node, className, children, ...props }) => {
                              const isCodeBlock = Boolean(className && /language-(\w+)/.test(className));
                              if (isCodeBlock) {
                                return (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                );
                              }
                              return (
                                <code
                                  className="px-1.5 py-0.5 mx-0.5 rounded-md bg-[#141517] border border-campus-border/60 text-blue-300 font-mono text-[12px] font-medium"
                                  {...props}
                                >
                                  {children}
                                </code>
                              );
                            },
                            table: ({ children }) => (
                              <div className="my-3 overflow-x-auto rounded-xl border border-campus-border bg-campus-card/30 shadow-sm">
                                <table className="min-w-full divide-y divide-campus-border text-left text-xs">
                                  {children}
                                </table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead className="bg-[#1b1c20] text-white border-b border-campus-border">{children}</thead>
                            ),
                            tbody: ({ children }) => (
                              <tbody className="divide-y divide-campus-border/50 text-xs bg-campus-card/20">{children}</tbody>
                            ),
                            tr: ({ children }) => (
                              <tr className="hover:bg-campus-card/50 transition-colors">{children}</tr>
                            ),
                            th: ({ children }) => (
                              <th className="px-3.5 py-2.5 font-semibold text-white tracking-wider text-left">{children}</th>
                            ),
                            td: ({ children }) => (
                              <td className="px-3.5 py-2 text-zinc-300 leading-relaxed whitespace-normal">{children}</td>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="my-3 pl-3.5 border-l-2 border-blue-500 text-campus-muted italic bg-campus-bg/40 py-1.5 rounded-r-lg">
                                {children}
                              </blockquote>
                            ),
                            hr: () => <hr className="my-4 border-campus-border/70" />,
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors font-medium inline-flex items-center gap-0.5"
                              >
                                {children}
                                <ExternalLink className="w-3 h-3 inline-block ml-0.5 opacity-70" />
                              </a>
                            ),
                          }}
                        >
                          {formatMarkdownContent(msg.text)}
                        </ReactMarkdown>
                        {msg.isStreaming && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-400 animate-pulse align-middle" />
                        )}
                      </div>
                    ) : (
                      msg.isStreaming && !msg.status && (
                        <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                          <span>Generating answer...</span>
                        </div>
                      )
                    )}

                    {/* Actions row: Copy & Optional Retry (only when not actively streaming) */}
                    {!msg.isStreaming && msg.text && (
                      <div className="flex items-center gap-2 pt-1 text-xs text-zinc-400">
                        <button
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                          title="Copy response"
                        >
                          {copiedMsgId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {msg.isFallback && msg.originalQuery && (
                          <button
                            onClick={() => handleSendMessage(msg.originalQuery)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-blue-400 hover:text-blue-300 border border-zinc-700 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry question</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Interactive Clarification Options (if applicable) */}
                    {!msg.isStreaming && msg.clarification?.options && msg.clarification.options.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-campus-border/50 space-y-2">
                        <p className="text-xs font-medium text-blue-300">Select an option:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.clarification.options.map((option, optIdx) => (
                            <button
                              key={optIdx}
                              onClick={() => handleSendMessage(option)}
                              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 border border-campus-border text-zinc-200 hover:text-white transition-colors cursor-pointer"
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Clean Collapsed Sources Accordion */}
                    {msg.sources && msg.sources.length > 0 && (
                      <details className="mt-3 pt-2.5 border-t border-campus-border/40 text-xs text-campus-muted group">
                        <summary className="cursor-pointer hover:text-white flex items-center gap-1.5 font-medium select-none py-0.5 transition-colors">
                          <FileText className="w-3.5 h-3.5 text-blue-400" />
                          <span>{msg.sources.length} Verified Sources</span>
                          <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180 ml-auto" />
                        </summary>
                        <div className="mt-2 space-y-2 pt-1">
                          {msg.sources.map((src, sIdx) => {
                            const sourceLink = getSourceUrl(src);
                            const displayDomain = formatSourceDomain(sourceLink);

                            return (
                              <div
                                key={sIdx}
                                className="p-2.5 rounded-lg bg-campus-card/40 border border-campus-border/60 text-[11px] text-campus-subtext hover:border-campus-border transition-colors"
                              >
                                <div className="font-medium text-white flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
                                  {/* Source Name */}
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className="truncate font-semibold text-white"
                                      title={src.documentTitle || src.title || 'Official Document'}
                                    >
                                      {src.documentTitle || src.title || 'Official Document'}
                                    </span>
                                  </div>

                                  {/* Right side: Clickable URL with symbol & Page info */}
                                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
                                    {src.pageDisplay ? (
                                      <span className="font-mono text-[10px] text-campus-muted px-1.5 py-0.5 rounded bg-campus-card border border-campus-border/40">
                                        {src.pageDisplay}
                                      </span>
                                    ) : src.pageNumber ? (
                                      <span className="font-mono text-[10px] text-campus-muted px-1.5 py-0.5 rounded bg-campus-card border border-campus-border/40">
                                        Page {src.pageNumber}
                                      </span>
                                    ) : null}

                                    {sourceLink && (
                                      <a
                                        href={sourceLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Open official source URL: ${sourceLink}`}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-all group/link"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="max-w-[120px] sm:max-w-[180px] truncate underline decoration-blue-400/40 group-hover/link:decoration-blue-300">
                                          {displayDomain}
                                        </span>
                                        <ExternalLink className="w-3 h-3 flex-shrink-0 text-blue-400 group-hover/link:text-blue-300" />
                                      </a>
                                    )}
                                  </div>
                                </div>

                                {src.text && (
                                  <p className="text-campus-muted mt-1.5 line-clamp-2 leading-relaxed text-[11px]">
                                    {src.text}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}

                    {/* Dynamic Smart Follow-Up Chips */}
                    {!msg.isStreaming && msg.suggestions && msg.suggestions.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-campus-border/40">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-campus-muted mb-2">
                          <Sparkles className="w-3 h-3 text-blue-400" />
                          <span>Suggested Follow-ups</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {msg.suggestions.map((sug, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              disabled={isTyping}
                              onClick={() => handleSendMessage(sug)}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-normal text-zinc-200 bg-campus-card/90 hover:bg-zinc-800 hover:text-white border border-campus-border hover:border-blue-500/60 transition-all duration-150 cursor-pointer shadow-sm text-left group disabled:opacity-50"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 group-hover:scale-125 transition-transform flex-shrink-0" />
                              <span>{sug}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator (only shown if isTyping and no active streaming assistant message in list) */}
              {isTyping && !activeMessages.some((m) => m.isStreaming) && (
                <div className="w-full my-3 flex items-center gap-2 text-campus-muted text-sm py-1">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-xs">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse delay-150" />
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse delay-300" />
                    <span className="text-xs ml-1.5 text-zinc-300">Searching official documents...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Bottom Input (ChatGPT Style) */}
      <div className="flex-shrink-0 px-3 sm:px-4 pb-3 sm:pb-4 pt-2 bg-gradient-to-t from-campus-bg via-campus-bg to-transparent">
        <div className="max-w-3xl mx-auto w-full">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="rounded-2xl border border-campus-border bg-campus-card/95 focus-within:border-zinc-500 shadow-md p-2 flex items-end gap-2 transition-colors"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about NIT Kurukshetra..."
              className="w-full bg-transparent text-sm text-campus-text placeholder-campus-muted px-2 py-1.5 focus:outline-none resize-none max-h-40 min-h-[24px]"
            />

            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              aria-label="Send message"
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                inputValue.trim() && !isTyping
                  ? 'bg-white text-zinc-900 hover:bg-zinc-200 cursor-pointer'
                  : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-campus-border/60'
              }`}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>

          <p className="text-[11px] text-campus-muted text-center mt-2">
            CampusGpt answers are grounded in official NIT Kurukshetra documents.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Assistant;
