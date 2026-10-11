import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { conversationAPI } from '../services/api';

const ChatContext = createContext(null);

/**
 * Extracts a concise, professional fallback topic name for the chat folder
 */
export const extractTopicName = (text) => {
  if (!text || typeof text !== 'string') return 'Campus Inquiry';
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Domain-specific topic matches for university categories
  if (
    lower.includes('placement') ||
    lower.includes('internship') ||
    lower.includes('job') ||
    lower.includes('tpo') ||
    lower.includes('spc') ||
    lower.includes('package') ||
    lower.includes('ctc')
  ) {
    return 'Placement Policy';
  }
  if (
    lower.includes('mid sem') ||
    lower.includes('mid-sem') ||
    lower.includes('end sem') ||
    lower.includes('end-sem') ||
    lower.includes('exam') ||
    lower.includes('datesheet') ||
    lower.includes('schedule')
  ) {
    return 'Exam Schedule';
  }
  if (
    lower.includes('attendance') ||
    lower.includes('condonation') ||
    lower.includes('detain') ||
    lower.includes('shortage')
  ) {
    return 'Attendance Rules';
  }
  if (
    lower.includes('hostel') ||
    lower.includes('mess') ||
    lower.includes('curfew') ||
    lower.includes('warden') ||
    lower.includes('room')
  ) {
    return 'Hostel Rules';
  }
  if (
    lower.includes('fee') ||
    lower.includes('scholarship') ||
    lower.includes('dues') ||
    lower.includes('refund')
  ) {
    return 'Fees & Scholarships';
  }
  if (
    lower.includes('course') ||
    lower.includes('syllabus') ||
    lower.includes('curriculum') ||
    lower.includes('branch') ||
    lower.includes('credit')
  ) {
    return 'Courses & Syllabus';
  }
  if (
    lower.includes('admission') ||
    lower.includes('cutoff') ||
    lower.includes('seat') ||
    lower.includes('counseling')
  ) {
    return 'Admissions & Cutoffs';
  }
  if (lower.includes('library') || lower.includes('book') || lower.includes('reading room')) {
    return 'Library Rules';
  }
  if (
    lower.includes('holiday') ||
    lower.includes('vacation') ||
    lower.includes('calendar') ||
    lower.includes('break')
  ) {
    return 'Academic Calendar';
  }
  if (
    lower.includes('pyq') ||
    lower.includes('previous year') ||
    lower.includes('question paper')
  ) {
    return 'Exam PYQs';
  }

  // 2. Natural cleanup for custom user questions
  let stripped = clean.replace(/[?.,!":;]/g, '').trim();
  const prefixRegex =
    /^(can you (please )?|could you (please )?|please |give me (the )?|tell me (about )?|what is (the )?|what are (the )?|when is (the )?|when are (the )?|how to |how do i |explain (the )?|show me (the )?|summarize (the )?|summary of (the )?)/i;
  stripped = stripped.replace(prefixRegex, '').trim();
  if (!stripped) stripped = clean;

  const words = stripped.split(/\s+/).slice(0, 4);
  const title = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return title.length > 28 ? `${title.slice(0, 28)}...` : title || 'Campus Inquiry';
};

export const ChatProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?._id || user?.id || null;
  const currentUserIdRef = useRef(userId);

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);

  const activeChatIdRef = useRef(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const chatsRef = useRef(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Helper to sort chats: pinned first, then newest updatedAt
  const sortConversations = (convList) => {
    return [...convList].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  };

  // Helper to check if two IDs match across string/ObjectId/tempId
  const matchId = (chatObj, searchId) => {
    if (!chatObj || !searchId) return false;
    const targetStr = String(searchId);
    return (
      String(chatObj.id) === targetStr ||
      String(chatObj._id) === targetStr ||
      (chatObj.tempId && String(chatObj.tempId) === targetStr)
    );
  };

  // Sync state cleanly when user identity changes
  useEffect(() => {
    currentUserIdRef.current = userId;

    if (!userId) {
      setChats([]);
      setActiveChatId(null);
      return;
    }

    const loadConversations = async () => {
      setIsLoadingChats(true);
      try {
        const res = await conversationAPI.list();
        const convList = res?.data?.conversations || [];

        if (currentUserIdRef.current !== userId) return;

        if (convList.length > 0) {
          const sorted = sortConversations(
            convList.map((c) => ({
              ...c,
              id: String(c.id || c._id),
              _id: String(c._id || c.id),
              messages: c.messages || [],
            }))
          );
          setChats(sorted);

          // Restore previously active chat if valid, or select top conversation
          const savedActiveId = localStorage.getItem(`campusgpt_active_chat_id_${userId}`);
          const match = sorted.find((c) => matchId(c, savedActiveId));
          const initialId = match ? match.id : sorted[0].id;
          setActiveChatId(initialId);

          // Fetch full messages for initial active conversation
          try {
            const detailRes = await conversationAPI.get(initialId);
            if (detailRes?.data?.messages) {
              const formatted = detailRes.data.messages.map((m) => ({
                id: String(m._id || m.id),
                sender: m.role || m.sender,
                text: m.content || m.text,
                sources: m.sources || [],
                suggestions: m.suggestions || [],
                timestamp: m.timestamp || (m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
              }));

              setChats((prev) =>
                prev.map((c) =>
                  matchId(c, initialId) ? { ...c, messages: formatted } : c
                )
              );
            }
          } catch (e) {
            console.warn('[ChatContext] Failed to load messages for initial active chat:', e);
          }
        } else {
          setChats([]);
          setActiveChatId(null);
        }
      } catch (err) {
        console.warn('[ChatContext] Error loading conversations:', err);
      } finally {
        setIsLoadingChats(false);
      }
    };

    loadConversations();
  }, [userId]);

  // Persist activeChatId
  useEffect(() => {
    if (!userId) return;
    try {
      const activeKey = `campusgpt_active_chat_id_${userId}`;
      if (activeChatId && !activeChatId.startsWith('temp_')) {
        localStorage.setItem(activeKey, activeChatId);
      }
    } catch (e) {}
  }, [activeChatId, userId]);

  // Resolve current active chat - 100% strictly matches the selected conversation
  const activeChat = chats.find((c) => matchId(c, activeChatId)) || null;
  const activeMessages = activeChat ? activeChat.messages || [] : [];

  /**
   * Start a brand new empty chat session (isolated from all other chats)
   */
  const createNewChat = useCallback(() => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setActiveChatId(tempId);
    return tempId;
  }, []);

  /**
   * Switch to an existing chat from the sidebar
   */
  const selectChat = useCallback(async (chatId) => {
    if (!chatId) return;
    const strId = String(chatId);
    setActiveChatId(strId);

    // Fetch conversation detail to ensure fresh and strictly isolated messages
    if (!strId.startsWith('temp_')) {
      try {
        const res = await conversationAPI.get(strId);
        if (res?.data?.messages) {
          const formatted = res.data.messages.map((m) => ({
            id: String(m._id || m.id),
            sender: m.role || m.sender,
            text: m.content || m.text,
            sources: m.sources || [],
            suggestions: m.suggestions || [],
            timestamp: m.timestamp || (m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''),
          }));

          setChats((prev) =>
            prev.map((c) =>
              matchId(c, strId) ? { ...c, messages: formatted } : c
            )
          );
        }
      } catch (e) {
        console.warn('[ChatContext] Error fetching conversation detail:', e);
      }
    }
  }, []);

  /**
   * Toggle pinned state for a chat
   */
  const pinChat = useCallback(async (chatId) => {
    const chat = chats.find((c) => matchId(c, chatId));
    if (!chat) return;

    const newPinned = !chat.pinned;
    setChats((prev) =>
      sortConversations(
        prev.map((c) => (matchId(c, chatId) ? { ...c, pinned: newPinned } : c))
      )
    );

    if (!String(chatId).startsWith('temp_')) {
      try {
        await conversationAPI.update(chatId, { pinned: newPinned });
      } catch (err) {
        console.warn('[ChatContext] Failed to update pinned status:', err);
      }
    }
  }, [chats]);

  /**
   * Rename a chat session
   */
  const renameChat = useCallback(async (chatId, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    const cleanTitle = newTitle.trim();

    setChats((prev) =>
      prev.map((c) => (matchId(c, chatId) ? { ...c, title: cleanTitle, updatedAt: new Date() } : c))
    );

    if (!String(chatId).startsWith('temp_')) {
      try {
        await conversationAPI.update(chatId, { title: cleanTitle });
      } catch (err) {
        console.warn('[ChatContext] Failed to rename conversation:', err);
      }
    }
  }, []);

  /**
   * Delete a chat session / folder
   */
  const deleteChat = useCallback(async (chatId, e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }

    setChats((prev) => prev.filter((c) => !matchId(c, chatId)));

    if (matchId({ id: activeChatId }, chatId)) {
      createNewChat();
    }

    if (!String(chatId).startsWith('temp_')) {
      try {
        await conversationAPI.delete(chatId);
      } catch (err) {
        console.warn('[ChatContext] Failed to delete conversation:', err);
      }
    }
  }, [activeChatId, createNewChat]);

  /**
   * Add a user message strictly to the active chat session
   */
  const addMessageToActiveChat = useCallback((userMessage) => {
    let currentId = activeChatIdRef.current;
    const exists = currentId && chatsRef.current.some((c) => matchId(c, currentId));

    if (!exists) {
      currentId = currentId || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setActiveChatId(currentId);

      const topicName = extractTopicName(userMessage.text);
      const newChat = {
        id: currentId,
        _id: currentId,
        tempId: currentId,
        title: topicName || 'Campus Inquiry',
        pinned: false,
        messages: [userMessage],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      setChats((prev) => [newChat, ...prev]);
      return currentId;
    }

    // Existing session: append message strictly to this session
    setChats((prev) =>
      prev.map((c) => {
        if (matchId(c, currentId)) {
          return {
            ...c,
            messages: [...(c.messages || []), userMessage],
            updatedAt: new Date(),
          };
        }
        return c;
      })
    );

    return currentId;
  }, []);

  /**
   * Add assistant response placeholder strictly to target chat session
   */
  const addAssistantMessageToActiveChat = useCallback((assistantMessage, targetChatId) => {
    const targetId = targetChatId || activeChatIdRef.current;
    setChats((prev) =>
      prev.map((c) => {
        if (matchId(c, targetId)) {
          return {
            ...c,
            messages: [...(c.messages || []), assistantMessage],
            updatedAt: new Date(),
          };
        }
        return c;
      })
    );
  }, []);

  /**
   * Update an existing message in a chat session (for SSE streaming chunks, status, sources, suggestions)
   */
  const updateMessageInChat = useCallback((messageId, updater, targetChatId) => {
    const targetId = targetChatId || activeChatIdRef.current;
    setChats((prev) =>
      prev.map((c) => {
        if (matchId(c, targetId)) {
          const updatedMessages = (c.messages || []).map((msg) => {
            if (String(msg.id) === String(messageId)) {
              return typeof updater === 'function' ? updater(msg) : { ...msg, ...updater };
            }
            return msg;
          });
          return {
            ...c,
            messages: updatedMessages,
            updatedAt: new Date(),
          };
        }
        return c;
      })
    );
  }, []);

  /**
   * Replace a temporary/draft chatId with the real backend conversation ID and update title
   */
  const setConversationSessionId = useCallback((oldId, newId, serverTitle) => {
    if (!newId) return;
    const strOld = String(oldId);
    const strNew = String(newId);

    setChats((prev) =>
      sortConversations(
        prev.map((c) => {
          if (matchId(c, strOld)) {
            return {
              ...c,
              id: strNew,
              _id: strNew,
              tempId: strOld, // preserve tempId reference so any pending tokens still match!
              title: serverTitle || c.title,
              updatedAt: new Date(),
            };
          }
          return c;
        })
      )
    );

    setActiveChatId((curr) => (matchId({ id: curr }, strOld) ? strNew : curr));
  }, []);

  const contextValue = React.useMemo(
    () => ({
      chats,
      activeChatId,
      activeChat,
      activeMessages,
      isLoadingChats,
      createNewChat,
      selectChat,
      renameChat,
      pinChat,
      deleteChat,
      addMessageToActiveChat,
      addAssistantMessageToActiveChat,
      updateMessageInChat,
      setConversationSessionId,
    }),
    [
      chats,
      activeChatId,
      activeChat,
      activeMessages,
      isLoadingChats,
      createNewChat,
      selectChat,
      renameChat,
      pinChat,
      deleteChat,
      addMessageToActiveChat,
      addAssistantMessageToActiveChat,
      updateMessageInChat,
      setConversationSessionId,
    ]
  );

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
