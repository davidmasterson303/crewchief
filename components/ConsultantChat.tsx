'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Loader as Loader2, Send, Plus, Search, MessageSquare, Paperclip, X, FileText, ExternalLink, Heart, Check, Wrench, TriangleAlert, Sparkles } from 'lucide-react';
import { logger } from '@/lib/logger';
import { isDemoMode, isDemoVehicleId } from '@/lib/demo';
import {
  sendConsultantMessage,
  createConsultantSession,
  generateSessionTitle,
  getConsultantSession,
  getConsultantSessions,
} from '@/app/actions';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@/lib/query-invalidation';

interface ConsultantChatProps {
  vehicleId: string;
  vehicle: any;
  knowledge: any;
  wishlistItems: any[];
  allServiceItems: any[];
  completedItems: any[];
  maintenanceLineItems: any[];
  documents: any[];
  issueTracking: any[];
  modTracking?: any[];
  sessions: any[];
  initialSessionId?: string;
  nhtsaData?: any;
  healthSummary?: any;
  modWishlistItems?: any[];
}

const THINKING_STAGES = [
  'Reviewing vehicle profile...',
  'Checking service history...',
  'Analyzing maintenance records...',
  'Consulting knowledge base...',
  'Preparing response...',
];

const FOLLOW_UP_SUGGESTIONS: Record<string, string[]> = {
  default: [
    'What are the most common issues for this engine?',
    'How much would this repair typically cost?',
    'What should I prioritize fixing first?',
  ],
  maintenance: [
    'When is my next service due?',
    'What other maintenance is coming up?',
    'How does my maintenance compare to recommendations?',
  ],
  performance: [
    'What modifications would give the best power gain?',
    'Which mods should I do in what order?',
    'What\'s my estimated horsepower with these mods?',
  ],
};

function getFollowUps(lastMessage: string): string[] {
  const lower = lastMessage.toLowerCase();
  if (lower.includes('oil') || lower.includes('maintenance') || lower.includes('service')) {
    return FOLLOW_UP_SUGGESTIONS.maintenance;
  }
  if (lower.includes('mod') || lower.includes('performance') || lower.includes('horsepower')) {
    return FOLLOW_UP_SUGGESTIONS.performance;
  }
  return FOLLOW_UP_SUGGESTIONS.default;
}

function renderMarkdownLine(line: string, key: number) {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push(<strong key={`b-${key}-${match.index}`} className="font-semibold text-white">{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length > 0 ? parts : line;
}

function getSourceBadges(content: string, knowledge: any): { label: string; icon: React.ReactNode }[] {
  const badges: { label: string; icon: React.ReactNode }[] = [];
  const lower = content.toLowerCase();
  if (lower.includes('service') || lower.includes('oil') || lower.includes('maintenance') || lower.includes('filter')) {
    badges.push({ label: 'Service records', icon: <Wrench className="h-2.5 w-2.5" /> });
  }
  if (lower.includes('issue') || lower.includes('recall') || lower.includes('defect') || lower.includes('warning')) {
    badges.push({ label: 'Issue history', icon: <TriangleAlert className="h-2.5 w-2.5" /> });
  }
  if (lower.includes('mod') || lower.includes('performance') || lower.includes('horsepower') || lower.includes('torque')) {
    badges.push({ label: 'Mod profile', icon: <Sparkles className="h-2.5 w-2.5" /> });
  }
  return badges.slice(0, 2);
}

export default function ConsultantChat({
  vehicleId,
  vehicle,
  knowledge,
  wishlistItems,
  allServiceItems,
  completedItems,
  maintenanceLineItems,
  documents,
  issueTracking,
  modTracking = [],
  sessions: initialSessions,
  initialSessionId,
  nhtsaData,
  healthSummary,
  modWishlistItems = [],
}: ConsultantChatProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId || null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<any[]>([]);
  const [addedWishlistItems, setAddedWishlistItems] = useState<Set<string>>(new Set());
  const [addingWishlistItem, setAddingWishlistItem] = useState<string | null>(null);
  const [showFollowUps, setShowFollowUps] = useState(false);
  const [currentFollowUps, setCurrentFollowUps] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (activeSessionId) {
      isInitialLoadRef.current = true;
      loadSession(activeSessionId);
    }
  }, [activeSessionId]);

  useLayoutEffect(() => {
    if (isInitialLoadRef.current && messages.length > 0 && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      isInitialLoadRef.current = false;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (thinkingIntervalRef.current) clearInterval(thinkingIntervalRef.current);
    };
  }, []);

  const startThinkingAnimation = () => {
    setThinkingStage(0);
    thinkingIntervalRef.current = setInterval(() => {
      setThinkingStage(prev => (prev + 1) % THINKING_STAGES.length);
    }, 1800);
  };

  const stopThinkingAnimation = () => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
      thinkingIntervalRef.current = null;
    }
  };

  const loadSession = async (sessionId: string) => {
    const result = await getConsultantSession(sessionId);
    if (result.success && result.data) {
      setMessages(result.data.message_history || []);
      setShowFollowUps(false);
    }
  };

  const scrollToBottom = () => {
    if (!messagesContainerRef.current) return;
    const container = messagesContainerRef.current;
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });
  };

  const handleAddToWishlist = async (action: { name: string; type: string; description: string }) => {
    const key = `${action.name}-${action.type}`;
    if (addedWishlistItems.has(key)) return;
    setAddingWishlistItem(key);
    try {
      const response = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          itemType: action.type,
          itemName: action.name,
          itemIdentifier: `consultant-${action.name.toLowerCase().replace(/\s+/g, '-')}`,
          description: action.description,
          category: action.type === 'modification' ? 'modification' : action.type === 'maintenance' ? 'maintenance' : 'repair',
          source: 'consultant',
        }),
      });
      const result = await response.json();
      if (response.ok || response.status === 409) {
        setAddedWishlistItems((prev) => { const next = new Set(Array.from(prev)); next.add(key); return next; });
        toast.success(`Added "${action.name}" to wishlist`);
      } else {
        toast.error(result.error || 'Failed to add to wishlist');
      }
    } catch {
      toast.error('Failed to add to wishlist');
    } finally {
      setAddingWishlistItem(null);
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
    setSelectedFiles([]);
    setUploadedDocuments([]);
    setShowFollowUps(false);
  };

  const handleSessionClick = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setSelectedFiles([]);
    setUploadedDocuments([]);
    setShowFollowUps(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large. Maximum size is 10MB.`);
        return false;
      }
      return true;
    });

    if (selectedFiles.length + validFiles.length > 3) {
      toast.error('Maximum 3 files can be attached per message');
      return;
    }

    setSelectedFiles((prev) => [...prev, ...validFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async (sessionId: string) => {
    if (selectedFiles.length === 0) return [];

    setUploadingFiles(true);
    const uploadedDocs: any[] = [];

    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('vehicleId', vehicleId);
        formData.append('sessionId', sessionId);

        const response = await fetch('/api/consultant/upload-document', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();

        if (result.rejected) {
          toast.error(`That file didn't appear to relate to your car. I've deleted it.`);
          continue;
        }

        if (!result.success) {
          toast.error(`Failed to upload ${file.name}`);
          continue;
        }

        uploadedDocs.push(result.document);
      }

      setSelectedFiles([]);
      return uploadedDocs;
    } catch (error) {
      logger.error('CONSULTANT_CHAT:UPLOAD', error as Error);
      toast.error('Failed to upload files');
      return [];
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleSend = async (overrideInput?: string) => {
    const messageText = overrideInput ?? input;
    if ((!messageText.trim() && selectedFiles.length === 0) || loading || uploadingFiles) return;

    const userMessage = messageText.trim();
    setInput('');
    setShowFollowUps(false);
    setLoading(true);
    startThinkingAnimation();

    const demo = isDemoMode() || isDemoVehicleId(vehicleId);

    let currentSessionId = activeSessionId;

    if (!currentSessionId && !demo) {
      const title = await generateSessionTitle(userMessage || 'Document Review');
      const createResult = await createConsultantSession(vehicleId, title);

      if (!createResult.success || !createResult.sessionId) {
        toast.error('Failed to create session');
        setLoading(false);
        stopThinkingAnimation();
        return;
      }

      currentSessionId = createResult.sessionId;
      setActiveSessionId(currentSessionId);

      const sessionsResult = await getConsultantSessions(vehicleId);
      if (sessionsResult.success) {
        setSessions(sessionsResult.data);
      }
    }

    if (!currentSessionId && !demo) {
      toast.error('Failed to create session');
      setLoading(false);
      stopThinkingAnimation();
      return;
    }

    const uploadedDocs = demo ? [] : await uploadFiles(currentSessionId!);

    const userMessageWithDocs = {
      role: 'user',
      content: userMessage || 'Please review the attached document(s).',
      timestamp: new Date().toISOString(),
      documents: uploadedDocs,
    };

    const optimisticMessages = [...messages, userMessageWithDocs];
    setMessages(optimisticMessages);
    scrollToBottom();

    const result = await sendConsultantMessage({
      vehicleId,
      sessionId: currentSessionId || 'demo-session',
      message: userMessage || 'Please review the attached document(s).',
      messageHistory: messages,
      vehicle,
      knowledge,
      wishlistItems,
      allServiceItems,
      completedItems,
      maintenanceLineItems,
      documents,
      issueTracking,
      modTracking,
      attachedDocuments: uploadedDocs,
      nhtsaData,
      healthSummary,
      modWishlistItems,
      isDemo: demo,
    });

    stopThinkingAnimation();
    setLoading(false);

    if (result.success) {
      const assistantMsg = {
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        wishlistActions: result.wishlistActions,
      };
      setMessages([...optimisticMessages, assistantMsg]);
      setCurrentFollowUps(getFollowUps(result.response || ''));
      setShowFollowUps(true);
      scrollToBottom();

      const dataChanged = result.invoiceProcessed || result.performanceUpdated || (result.issueUpdates ?? 0) > 0 || (result.modUpdates ?? 0) > 0;

      if (result.invoiceProcessed) {
        toast.success(`Invoice processed — ${result.invoiceItemsProcessed || 0} maintenance records added`);
      }
      if (result.performanceUpdated) {
        toast.success('Performance stats updated');
      }
      if ((result.issueUpdates ?? 0) > 0) {
        toast.success(`${result.issueUpdates} issue${result.issueUpdates! > 1 ? 's' : ''} marked as completed`);
      }
      if ((result.modUpdates ?? 0) > 0) {
        toast.success(`${result.modUpdates} modification${result.modUpdates! > 1 ? 's' : ''} marked as completed`);
      }

      if (dataChanged) {
        invalidateDashboardCache(vehicleId);
        router.refresh();
      }
    } else {
      setMessages([
        ...optimisticMessages,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  };

  const handleFollowUpClick = (suggestion: string) => {
    setShowFollowUps(false);
    handleSend(suggestion);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filteredSessions = sessions.filter((session) =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-[calc(100vh-320px)] min-h-[520px] max-h-[760px] border border-white/10 rounded-2xl overflow-hidden flex bg-slate-950/90 shadow-xl shadow-black/40 animate-consultant-fade">
      <div className="w-64 border-r border-white/8 flex flex-col bg-black/40 flex-shrink-0">
        <div className="p-4 border-b border-white/8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-white">Conversations</h3>
            <Button
              size="sm"
              onClick={handleNewChat}
              className="bg-cyan-600 hover:bg-cyan-500 text-white h-7 px-2.5 border-0 text-xs rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
            <Input
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-lg"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4 py-8">
              <MessageSquare className="h-8 w-8 text-white/15 mb-3" />
              <p className="text-xs text-white/35 leading-relaxed">
                {searchQuery ? 'No matching conversations' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSessionClick(session.id)}
                  className={`w-full text-left p-3 rounded-xl transition-all ${
                    activeSessionId === session.id
                      ? 'bg-cyan-400/10 border border-cyan-400/25'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <p className={`text-xs font-medium line-clamp-2 leading-snug ${
                    activeSessionId === session.id ? 'text-cyan-300' : 'text-white/80'
                  }`}>
                    {session.title}
                  </p>
                  <p className="text-[10px] text-white/30 mt-1">
                    {new Date(session.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center mx-auto mb-5">
                  <MessageSquare className="h-7 w-7 text-cyan-400" />
                </div>
                <h3 className="text-lg font-bold mb-2 text-white">Hey, CrewChief here.</h3>
                <p className="text-white/55 mb-5 text-sm leading-relaxed">
                  I know your {vehicle.year} {vehicle.make} {vehicle.model} inside and out. What&apos;s on your mind?
                </p>
                <div className="grid gap-2 text-left">
                  {[
                    'Something acting funny? Let\'s figure it out.',
                    'Planning your next round of work? I\'ll help prioritize.',
                    'Got a quote from a shop? Send it over for a second opinion.',
                    'Thinking about mods? I know what works on these.',
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(suggestion)}
                      className="text-left p-3 bg-white/5 hover:bg-cyan-400/8 border border-white/8 hover:border-cyan-400/25 rounded-xl text-sm text-white/65 hover:text-white transition-all"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg: any, index: number) => (
                <div
                  key={index}
                  className={`flex gap-3 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <Avatar className="h-8 w-8 mt-1 flex-shrink-0">
                    <AvatarFallback className={msg.role === 'user' ? 'bg-cyan-600 text-white text-xs' : 'bg-white/10 text-white/70 text-xs'}>
                      {msg.role === 'user' ? 'U' : 'CC'}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`flex-1 max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-cyan-600/90 text-white rounded-2xl rounded-tr-sm'
                        : 'bg-cyan-900/20 border border-cyan-400/12 text-white rounded-2xl rounded-tl-sm'
                    } p-4 overflow-hidden`}
                  >
                    {msg.documents && msg.documents.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {msg.documents.map((doc: any, docIdx: number) => (
                          <a
                            key={docIdx}
                            href={doc.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-2 p-2 rounded-lg ${
                              msg.role === 'user'
                                ? 'bg-cyan-700/60 hover:bg-cyan-700'
                                : 'bg-white/8 hover:bg-white/12'
                            } transition-colors`}
                          >
                            <FileText className="h-4 w-4 flex-shrink-0" />
                            <span className="text-sm flex-1 truncate">{doc.file_name}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {msg.content.split('\n').map((line: string, i: number) => (
                        <p key={i} className="text-sm leading-relaxed break-words">{renderMarkdownLine(line, i)}</p>
                      ))}
                    </div>
                    {msg.role === 'assistant' && (() => {
                      const badges = getSourceBadges(msg.content, knowledge);
                      return badges.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {badges.map((badge, bi) => (
                            <span key={bi} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/6 border border-white/10 text-[10px] text-white/45 font-medium">
                              {badge.icon}
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    })()}
                    {msg.wishlistActions && msg.wishlistActions.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                        <p className="text-xs font-semibold text-white/50 uppercase tracking-widest">Suggested for wishlist</p>
                        {msg.wishlistActions.map((action: any, actionIdx: number) => {
                          const key = `${action.name}-${action.type}`;
                          const isAdded = addedWishlistItems.has(key);
                          const isAdding = addingWishlistItem === key;
                          return (
                            <button
                              key={actionIdx}
                              onClick={() => handleAddToWishlist(action)}
                              disabled={isAdded || isAdding}
                              className={`flex items-center gap-2 w-full text-left p-2.5 rounded-xl text-sm transition-all ${
                                isAdded
                                  ? 'bg-green-500/15 border border-green-400/25 text-green-300 cursor-default'
                                  : 'bg-cyan-400/8 border border-cyan-400/20 text-cyan-200 hover:bg-cyan-400/15 hover:border-cyan-400/40'
                              }`}
                            >
                              {isAdding ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                              ) : isAdded ? (
                                <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-400" />
                              ) : (
                                <Heart className="h-3.5 w-3.5 flex-shrink-0" />
                              )}
                              <span className="flex-1 font-medium text-xs">{action.name}</span>
                              <span className="text-[10px] opacity-50 capitalize">{action.type}</span>
                              {!isAdded && !isAdding && <span className="text-xs text-cyan-400 font-semibold">+ Add</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="text-[10px] opacity-40 mt-2">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-3 animate-fade-in">
                  <Avatar className="h-8 w-8 mt-1 flex-shrink-0">
                    <AvatarFallback className="bg-white/10 text-white/70 text-xs">CC</AvatarFallback>
                  </Avatar>
                  <div className="bg-white/8 border border-white/8 rounded-2xl rounded-tl-sm p-4 flex items-center gap-3">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400 flex-shrink-0" />
                    <span className="text-sm text-white/50">{THINKING_STAGES[thinkingStage]}</span>
                  </div>
                </div>
              )}

              {showFollowUps && !loading && currentFollowUps.length > 0 && (
                <div className="flex flex-col gap-2 pl-11 animate-slide-up">
                  <p className="text-xs text-white/35 font-medium">Ask a follow-up</p>
                  <div className="flex flex-wrap gap-2">
                    {currentFollowUps.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleFollowUpClick(suggestion)}
                        className="text-left px-3 py-1.5 bg-white/5 hover:bg-cyan-400/10 border border-white/10 hover:border-cyan-400/30 rounded-full text-xs text-white/60 hover:text-white transition-all"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!loading && messages.length > 0 && (() => {
                const highPriorityWishlist = wishlistItems.filter((item: any) =>
                  item.priority === 'high' || item.category === 'repair'
                );
                if (highPriorityWishlist.length === 0) return null;
                return (
                  <div className="pl-11 animate-slide-up">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-400/20">
                      <TriangleAlert className="h-4 w-4 text-amber-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-amber-300">
                          {highPriorityWishlist.length} item{highPriorityWishlist.length > 1 ? 's' : ''} need attention
                        </p>
                        <p className="text-[10px] text-white/40 mt-0.5">Get quotes from local shops</p>
                      </div>
                      <a
                        href={`/dashboard/${vehicleId}?tab=wishlist`}
                        className="flex-shrink-0 px-2.5 py-1 bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 rounded-lg text-[11px] font-semibold text-amber-300 transition-colors"
                      >
                        Get Quote
                      </a>
                    </div>
                  </div>
                );
              })()}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="border-t border-white/8 bg-black/30 p-4">
          {selectedFiles.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {selectedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-cyan-400/8 border border-cyan-400/20 p-2.5 rounded-xl"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate text-white">{file.name}</p>
                      <p className="text-xs text-white/40">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeSelectedFile(idx)}
                    className="ml-2 p-1 hover:bg-red-500/10 rounded-lg transition-colors"
                    disabled={uploadingFiles || loading}
                  >
                    <X className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex flex-col flex-1 gap-2">
              <Textarea
                placeholder="Ask me anything about your vehicle..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                rows={3}
                className="resize-none bg-white/6 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-cyan-400/40 transition-colors text-sm"
                disabled={loading || uploadingFiles}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploadingFiles || selectedFiles.length >= 3}
                title="Attach documents, invoices, or diagnostic reports"
                className="border-white/10 text-white/50 hover:text-cyan-400 hover:bg-cyan-400/8 hover:border-cyan-400/30 transition-all"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                onClick={() => handleSend()}
                disabled={loading || uploadingFiles || (!input.trim() && selectedFiles.length === 0)}
                size="lg"
                className="bg-cyan-600 hover:bg-cyan-500 text-white border-0 transition-all disabled:opacity-40"
              >
                {uploadingFiles ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <p className="text-xs text-white/25 mt-2">
            Enter to send &middot; Shift+Enter for new line &middot; Attach up to 3 files
          </p>
        </div>
      </div>
    </div>
  );
}
