import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import {
  GraduationCap,
  MessageSquare,
  FileText,
  BookOpen,
  Bell,
  LayoutDashboard,
  Shield,
  Plus,
  LogOut,
  Trash2,
  ChevronDown,
  X,
  MoreVertical,
  Pencil,
  Check,
  Pin,
} from 'lucide-react';

const Sidebar = ({ mobileOpen, setMobileOpen }) => {
  const { user, isAdmin, logout } = useAuth();
  const { chats, activeChatId, createNewChat, selectChat, renameChat, pinChat, deleteChat } = useChat();
  const [chatsFolderOpen, setChatsFolderOpen] = useState(true);
  const [activeMenuChatId, setActiveMenuChatId] = useState(null);
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const renameInputRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Close 3-dot dropdown menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveMenuChatId(null);
    };
    if (activeMenuChatId) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [activeMenuChatId]);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingChatId]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNewChat = () => {
    createNewChat();
    if (location.pathname !== '/assistant') {
      navigate('/assistant');
    }
    if (setMobileOpen) setMobileOpen(false);
  };

  const handleSelectChat = (chatId) => {
    selectChat(chatId);
    if (location.pathname !== '/assistant') {
      navigate('/assistant');
    }
    if (setMobileOpen) setMobileOpen(false);
  };

  const handleSaveRename = (chatId) => {
    if (editingTitle && editingTitle.trim()) {
      renameChat(chatId, editingTitle.trim());
    }
    setEditingChatId(null);
  };

  const navItems = [
    { name: 'Documents', path: '/documents', icon: FileText },
    { name: 'Courses', path: '/courses', icon: BookOpen },
    { name: 'Notices', path: '/notices', icon: Bell },
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  ];

  if (isAdmin) {
    navItems.push({ name: 'Admin Portal', path: '/admin', icon: Shield });
  }

  const isActiveNav = (path) => location.pathname === path;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-campus-sidebar border-r border-campus-border text-campus-text select-none">
      {/* Top Header & Brand */}
      <div className="p-3.5 border-b border-campus-border/60 flex items-center justify-between">
        <Link
          to="/assistant"
          onClick={() => setMobileOpen && setMobileOpen(false)}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
            <GraduationCap className="w-4 h-4" />
          </div>
          <div>
            <span className="font-semibold text-white tracking-tight text-base">CampusGpt</span>
            <span className="block text-[10px] text-campus-muted leading-none">NIT Kurukshetra</span>
          </div>
        </Link>

        {/* Mobile close button */}
        {setMobileOpen && (
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-campus-muted hover:text-white hover:bg-campus-card"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-campus-border bg-campus-card/70 hover:bg-campus-card text-zinc-100 text-sm font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 text-blue-400" />
          <span>New chat</span>
        </button>
      </div>

      {/* Scrollable Center: Explore Campus navigation first, then Chats below */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-4">
        {/* Campus Navigation Links (Explore Campus above Chats) */}
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-campus-muted px-2 py-1">
            Explore Campus
          </div>
          <div className="space-y-1 mt-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActiveNav(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen && setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${active
                      ? 'bg-campus-card text-white font-medium border border-campus-border/60'
                      : 'text-campus-muted hover:text-white hover:bg-campus-card/50'
                    }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-blue-400' : 'text-campus-muted'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Chats Section */}
        <div className="pt-2 border-t border-campus-border/60">
          <button
            type="button"
            onClick={() => setChatsFolderOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-mono uppercase tracking-wider text-campus-muted hover:text-white transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
              <span>Chats</span>
            </span>
            <div className="flex items-center gap-1">
              {chats.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-campus-card text-campus-muted font-sans font-medium">
                  {chats.length}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-campus-muted transition-transform duration-200 ${chatsFolderOpen ? '' : '-rotate-90'
                  }`}
              />
            </div>
          </button>

          {chatsFolderOpen && (
            <div className="space-y-1 mt-1">
              {chats.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-campus-muted/70 italic text-left">
                  No saved chats yet.
                </p>
              ) : (
                chats.map((chat) => {
                  const isCurrent =
                    Boolean(
                      activeChatId &&
                      (String(activeChatId) === String(chat.id) ||
                        String(activeChatId) === String(chat._id) ||
                        (chat.tempId && String(activeChatId) === String(chat.tempId)))
                    ) && location.pathname === '/assistant';
                  const isEditing = editingChatId === chat.id;
                  const isMenuOpen = activeMenuChatId === chat.id;

                  return (
                    <div
                      key={chat.id}
                      onClick={() => !isEditing && handleSelectChat(chat.id)}
                      className={`group relative flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${isCurrent
                          ? 'bg-campus-card text-white font-medium border border-campus-border shadow-sm'
                          : 'text-campus-muted hover:text-white hover:bg-campus-card/50'
                        }`}
                    >
                      {isEditing ? (
                        <div
                          className="flex items-center gap-1.5 w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(chat.id);
                              if (e.key === 'Escape') setEditingChatId(null);
                            }}
                            className="flex-1 min-w-0 bg-zinc-900 border border-blue-500/60 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(chat.id)}
                            title="Save name"
                            className="p-1 rounded hover:bg-zinc-700 text-emerald-400 flex-shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingChatId(null)}
                            title="Cancel"
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-400 flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {chat.pinned && (
                              <Pin className="w-3.5 h-3.5 flex-shrink-0 text-amber-400 rotate-45" />
                            )}
                            <span className="truncate">{chat.title || 'Campus Inquiry'}</span>
                          </div>

                          {/* 3-dot options menu */}
                          <div
                            className="relative flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuChatId((prev) => (prev === chat.id ? null : chat.id));
                              }}
                              title="Chat options"
                              className={`p-1 rounded text-campus-muted hover:text-white hover:bg-zinc-700/60 transition-all ${isMenuOpen
                                  ? 'opacity-100 bg-zinc-700/60 text-white'
                                  : 'opacity-70 md:opacity-0 md:group-hover:opacity-100'
                                }`}
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>

                            {/* Dropdown Menu */}
                            {isMenuOpen && (
                              <div className="absolute right-0 top-full mt-1 w-36 bg-zinc-900 border border-campus-border rounded-lg shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuChatId(null);
                                    pinChat(chat.id);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:text-white hover:bg-campus-card transition-colors text-left"
                                >
                                  <Pin className={`w-3.5 h-3.5 ${chat.pinned ? 'text-amber-400' : 'text-zinc-400'}`} />
                                  <span>{chat.pinned ? 'Unpin chat' : 'Pin chat'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingChatId(chat.id);
                                    setEditingTitle(chat.title || '');
                                    setActiveMenuChatId(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:text-white hover:bg-campus-card transition-colors text-left"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-blue-400" />
                                  <span>Rename</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveMenuChatId(null);
                                    deleteChat(chat.id, e);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* User Profile & Account Footer */}
      <div className="p-3 border-t border-campus-border/60 bg-campus-surface/30">
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg">
          <Link
            to="/profile"
            onClick={() => setMobileOpen && setMobileOpen(false)}
            className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-85 transition-opacity"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center text-xs font-semibold uppercase flex-shrink-0">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">{user?.name || 'User'}</p>
              <p className="text-[10px] text-campus-muted truncate capitalize">
                {user?.role || 'Student'}
              </p>
            </div>
          </Link>

          <button
            onClick={handleLogout}
            title="Log out"
            className="p-1.5 rounded-md text-campus-muted hover:text-red-400 hover:bg-campus-card transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Permanent) */}
      <aside className="hidden md:flex flex-col w-64 h-screen flex-shrink-0 sticky top-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer (Responsive Overlay) */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer content */}
          <div className="relative w-72 max-w-[80vw] h-full shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
