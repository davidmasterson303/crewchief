'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader as Loader2, Send, Plus, Search, MessageSquare, Paperclip, X, FileText, ExternalLink, Heart, Check, Wrench, TriangleAlert, Sparkles, PanelLeft, Copy } from 'lucide-react';
import { logger } from '@crewchief/core/logger';
import { isDemoVehicleId } from '@crewchief/core/demo';
import { isDemoMode } from '@/lib/demo-mode';
import { wishlistItemIdentifier } from '@crewchief/core/wishlist-identifier';
import {
  sendConsultantMessage,
  createConsultantSession,
  generateSessionTitle,
  getConsultantSession,
  getConsultantSessions,
} from '@/app/actions';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@crewchief/core/query-invalidation';
import { useSignedUrl } from '@/hooks/useSignedUrl';

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

/**
 * One attachment chip in the transcript.
 *
 * A component rather than an inline `<a>` because `file_url` holds a storage
 * path against a private bucket and has to be signed before it can be opened —
 * and a hook cannot be called from inside the `.map` that renders these.
 *
 * While the URL is resolving the chip renders as plain text: still visible,
 * still named, just not yet clickable. A link that 404s the moment it is
 * pressed is worse than one that arrives a moment late.
 */
function AttachmentLink({ doc, className }: { doc: any; className: string }) {
  const href = useSignedUrl(doc.file_url);

  const body = (
    <>
      <FileText className="h-4 w-4 flex-shrink-0" />
      <span className="text-sm flex-1 truncate">{doc.file_name}</span>
      {href && <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />}
    </>
  );

  if (!href) {
    return <div className={`${className} opacity-60 cursor-default`}>{body}</div>;
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  );
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

/*
 * What the model was actually given.
 *
 * ── The bug this replaces ───────────────────────────────────────────────────
 *
 * This function used to lowercase the assistant's own reply and keyword-match
 * it: `content.includes('oil')` produced a "Service records" chip,
 * `includes('recall')` produced "Issue history". The chips asserted what the
 * system had read, and nothing about them was connected to what it read. A
 * reply that merely said the word "recall" claimed issue history had been
 * consulted whether or not a single row existed.
 *
 * Two details made it worse than a rough heuristic. It was handed `knowledge`
 * as its second argument and never referenced it — the real grounding data was
 * already at the call site and was discarded in favour of guessing from the
 * output. And `includes('mod')` matches "model", "modern", "moderate" and
 * "modify", so a reply mentioning "the 2019 model" earned a "Mod profile"
 * badge. That fires on ordinary copy, not edge cases.
 *
 * ── What it claims now, and what it deliberately does not ───────────────────
 *
 * These are the context collections that were non-empty at the moment the
 * question was sent — the same values handed to `sendConsultantMessage` a few
 * lines later. So the claim is "this was supplied to the model", which is
 * checkable, rather than "the model used this", which no client can know. That
 * is why the row is prefixed "Based on" and not "Sources".
 *
 * Computed at send time and stored on the message, because context is a
 * property of the turn, not of the transcript. Messages replayed from a saved
 * session carry no `sources` and therefore show no chips: the honest rendering
 * of "we no longer know" is to claim nothing, not to recompute from today's
 * garage and backdate it onto an old answer.
 */
type ContextKind = 'knowledge' | 'service' | 'issues' | 'mods' | 'wishlist' | 'recalls';

const CONTEXT_LABELS: Record<ContextKind, string> = {
  knowledge: 'Knowledge base',
  service: 'Service records',
  issues: 'Issue history',
  mods: 'Mod profile',
  wishlist: 'Wishlist',
  recalls: 'Recall data',
};

function contextIcon(kind: ContextKind) {
  if (kind === 'issues' || kind === 'recalls') return <TriangleAlert className="h-2.5 w-2.5" />;
  if (kind === 'mods') return <Sparkles className="h-2.5 w-2.5" />;
  if (kind === 'wishlist') return <Heart className="h-2.5 w-2.5" />;
  return <Wrench className="h-2.5 w-2.5" />;
}

function nonEmpty(v: any): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function suppliedContext(ctx: {
  knowledge?: any;
  completedItems?: any[];
  maintenanceLineItems?: any[];
  issueTracking?: any[];
  modTracking?: any[];
  modWishlistItems?: any[];
  nhtsaData?: any;
}): ContextKind[] {
  const kinds: ContextKind[] = [];
  if (nonEmpty(ctx.knowledge)) kinds.push('knowledge');
  if (nonEmpty(ctx.completedItems) || nonEmpty(ctx.maintenanceLineItems)) kinds.push('service');
  if (nonEmpty(ctx.issueTracking)) kinds.push('issues');
  /*
   * `modTracking` and `modWishlistItems` are two different things and were
   * briefly collapsed into one "Mod profile" chip. They must not be:
   * `modWishlistItems` is loaded from the `wishlist_items` table (see
   * app/consultant/[vehicleId]/page.tsx), and on the demo Accord that table
   * holds an oil-dilution check, a brake fluid flush and a CVT fluid flush —
   * maintenance, not modifications. The chip claimed a mod profile the car does
   * not have, which is the same overclaim this whole function exists to remove.
   * The upstream prop name is what misleads; the label here tells the truth.
   */
  if (nonEmpty(ctx.modTracking)) kinds.push('mods');
  if (nonEmpty(ctx.modWishlistItems)) kinds.push('wishlist');
  if (nonEmpty(ctx.nhtsaData?.recalls)) kinds.push('recalls');
  return kinds;
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
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * The field was `rows={3}`: three lines of empty box for a one-line question,
   * and still three for a long one. It now starts at one line and grows to six
   * before scrolling.
   *
   * Height is reset to 'auto' before measuring because scrollHeight never
   * shrinks below the element's current height — without the reset the field
   * grows and never comes back down after a delete.
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = line * 6 + pad;

    el.style.height = 'auto';

    /*
     * The empty height is computed, not measured.
     *
     * `scrollHeight` on an empty field measures the *placeholder*, and this
     * placeholder wraps to two lines at the composer's width — so an empty box
     * was 54px and shrank to 34px on the first keystroke. Measuring gave a
     * field that visibly jumped the moment you started typing.
     *
     * `max` includes the padding for the same reason: without it, six lines of
     * text did not fit in the six-line cap.
     */
    const target = input ? Math.min(el.scrollHeight, max) : line + pad;
    el.style.height = `${target}px`;
    el.style.overflowY = input && el.scrollHeight > max ? 'auto' : 'hidden';
  }, [input]);

  /* Shown in the composer, so the grounding claim sits where the question is
   * typed. "Open" is everything not completed and not merely wished for —
   * `status` also carries 'wishlist', which is an intention, not an obligation. */
  const displayMileage: number = vehicle.current_mileage ?? 0;
  const openItemCount = (allServiceItems || []).filter(
    (i: any) => i.status !== 'completed' && i.status !== 'wishlist'
  ).length;
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
    setSidebarOpen(false);
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
      const response = await fetch('/api/v1/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId,
          itemType: action.type,
          itemName: action.name,
          // Canonical identifier. This previously produced
          // `consultant-cvt-fluid-flush` while the dossier stored
          // `dossier:maintenance:cvt_fluid_flush` for the same item, so the
          // unique constraint never fired and the same job could be added
          // twice, shown as un-added, and fail to delete.
          itemIdentifier: wishlistItemIdentifier(action.type, action.name),
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

        const response = await fetch('/api/v1/consultant/upload-document', {
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
        /* Recorded from the same values sent above, at the moment they were
         * sent. See suppliedContext — this is what was supplied, not what was
         * used, and it is deliberately absent on replayed history. */
        sources: suppliedContext({
          knowledge,
          completedItems,
          maintenanceLineItems,
          issueTracking,
          modTracking,
          modWishlistItems,
          nhtsaData,
        }),
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

  /*
   * Copy ships; Retry does not, deliberately.
   *
   * A correct retry has to drop the answer being retried and re-send the
   * preceding question. `handleSend` builds both its optimistic list and its
   * `messageHistory` from the `messages` state captured in its closure, so
   * calling setMessages() and then handleSend() in the same tick sends the
   * stale history — the failed answer goes back to the model as context for
   * its own retry. Fixing it properly means threading a history override
   * through the send path, which is the one thing the v7 ticket says not to
   * touch. A retry that silently re-asks without removing the bad answer is
   * worse than no retry, so this is one button, not two.
   */
  const handleCopyTurn = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTurn(index);
      setTimeout(() => setCopiedTurn((cur) => (cur === index ? null : cur)), 1600);
    } catch (error) {
      logger.error('CONSULTANT:COPY', error as Error);
      toast.error('Could not copy to clipboard');
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
    <div className="relative h-[calc(100vh-320px)] min-h-[520px] max-h-[760px] border border-white/10 rounded-2xl overflow-hidden flex bg-slate-950/90 shadow-xl shadow-black/40 animate-consultant-fade">
      {/*
        Below md the sidebar becomes a drawer. As a permanent flex child it
        took 256px of a 375px viewport, leaving ~119px for the thread — the
        messages were clipped mid-word and the conversation was unusable on a
        phone. It stays a static column from md up.
      */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close conversations"
          onClick={() => setSidebarOpen(false)}
          className="absolute inset-0 z-20 bg-black/60 md:hidden"
        />
      )}
      <div
        className={`${
          sidebarOpen ? 'absolute inset-y-0 left-0 z-30 flex' : 'hidden'
        } w-64 border-r border-white/8 flex-col bg-black/90 md:static md:z-auto md:flex md:bg-black/40 md:flex-shrink-0`}
      >
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

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Drawer handle — mobile only; the sidebar is always visible above md. */}
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="tap-target-44 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
            Conversations
          </button>
        </div>
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-info-wash border border-info-border flex items-center justify-center mx-auto mb-5">
                  <MessageSquare className="h-7 w-7 text-info" />
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
                  className={`turn animate-fade-in flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  {/*
                    The assistant's identity is a label row, not an avatar.
                    There are exactly two speakers and alignment already says
                    which is which, so an 8x8 'CC' circle on every turn was
                    paying for information the layout already carried.
                  */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Sparkles className="h-[13px] w-[13px] flex-shrink-0" style={{ color: 'var(--info)' }} />
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-white/45">CrewChief</span>
                      <span className="text-[10px] text-white/25">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div
                    className={
                      msg.role === 'user'
                        ? 'max-w-[80%] bg-cyan-600/90 text-white rounded-2xl rounded-tr-sm p-4 overflow-hidden'
                        /*
                          Unboxed: no background, border, radius or padding. A
                          CrewChief answer is a diagnosis, not a chat line, and
                          after this a container on this screen means
                          "structured payload" rather than "someone spoke".

                          `.measure` (68ch) is load-bearing, not polish. The
                          bubble's max-w-[80%] was capping the line length by
                          accident; unboxed prose has no edges to stop it and
                          would run to ~120 characters on a wide panel.
                        */
                        : 'measure text-white overflow-hidden'
                    }
                  >
                    {msg.documents && msg.documents.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {msg.documents.map((doc: any, docIdx: number) => (
                          <AttachmentLink
                            key={docIdx}
                            doc={doc}
                            className={`flex items-center gap-2 p-2 rounded-lg ${
                              msg.role === 'user'
                                ? 'bg-cyan-700/60 hover:bg-cyan-700'
                                : 'bg-white/8 hover:bg-white/12'
                            } transition-colors`}
                          />
                        ))}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {msg.content.split('\n').map((line: string, i: number) => (
                        <p key={i} className="text-sm leading-relaxed break-words">{renderMarkdownLine(line, i)}</p>
                      ))}
                    </div>
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
                                  : 'bg-info-wash border border-info-border text-info hover:bg-cyan-400/15 hover:border-cyan-400/40'
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
                  </div>

                  {/*
                    Provenance at the foot of the turn, prefixed "Based on"
                    because it reports what was supplied to the model — not
                    what the model used, which is not knowable from here.
                    Absent entirely on messages replayed from a saved session.
                  */}
                  {msg.role === 'assistant' && msg.sources?.length > 0 && (
                    <div className="measure flex flex-wrap items-center gap-1.5 mt-2.5">
                      <span className="text-[10px] text-white/30 font-medium">Based on</span>
                      {msg.sources.map((kind: ContextKind) => (
                        <span
                          key={kind}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/6 border border-white/10 text-[10px] text-white/45 font-medium"
                        >
                          {contextIcon(kind)}
                          {CONTEXT_LABELS[kind]}
                        </span>
                      ))}
                    </div>
                  )}

                  {/*
                    Quiet utilities. Opacity, not display:none, so they stay in
                    the tab order — and pinned visible on touch, where there is
                    no hover to reveal them. Same rule as the garage card's
                    edit pencil; see .turn-actions in globals.css.
                  */}
                  {msg.role === 'assistant' && msg.content && (
                    <div className="turn-actions flex items-center gap-1 mt-1.5">
                      <button
                        onClick={() => handleCopyTurn(msg.content, index)}
                        className="tap-target-44 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/35 hover:text-white/70 transition-colors"
                        aria-label="Copy this answer"
                      >
                        {copiedTurn === index ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedTurn === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}

                  {/* The user bubble keeps its timestamp, below and right. */}
                  {msg.role === 'user' && (
                    <div className="text-[10px] text-white/30 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              ))}

              {/* The same label row as a real turn, with the indicator inline.
                  It was a third avatar+bubble, which made "thinking" look like
                  a message that had arrived. */}
              {loading && (
                <div className="animate-fade-in flex flex-col items-start">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="h-[13px] w-[13px] flex-shrink-0" style={{ color: 'var(--info)' }} />
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-white/45">CrewChief</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info flex-shrink-0" />
                    <span className="text-sm text-white/50">{THINKING_STAGES[thinkingStage]}</span>
                  </div>
                </div>
              )}

              {showFollowUps && !loading && currentFollowUps.length > 0 && (
                <div className="flex flex-col gap-2 animate-slide-up">
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
                  <div className="animate-slide-up">
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
                  className="flex items-center justify-between bg-info-wash border border-info-border p-2.5 rounded-xl"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText className="h-4 w-4 text-info flex-shrink-0" />
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
          {/*
            One panel, not three surfaces.
            Attach, field and send were three separately bordered controls in a
            flex row, so the composer read as a toolbar rather than a place to
            write. The panel now owns the border and the focus ring; the
            textarea is borderless inside it. Canonical order is still
            [attach, input, send] — attach beside the field, send last.
          */}
          <div className="composer-panel rounded-xl">
            <Textarea
              ref={textareaRef}
              placeholder="Ask me anything about your vehicle..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              rows={1}
              className="resize-none border-0 bg-transparent text-white placeholder:text-white/30 text-sm px-3 pt-2.5 pb-1 min-h-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
              disabled={loading || uploadingFiles}
            />
            <div className="flex items-center gap-2 px-2 pb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploadingFiles || selectedFiles.length >= 3}
                aria-label="Attach a file"
                title="Attach documents, invoices, or diagnostic reports"
                className="tap-target-44 h-8 w-8 p-0 text-white/50 hover:text-cyan-400 hover:bg-cyan-400/8"
              >
                <Paperclip className="h-[17px] w-[17px]" />
              </Button>

              {/*
                The product's promise is that the answer is grounded in this
                specific car. Say so where the question is being typed.
                Truncates, never wraps — a second line here pushes the controls
                around as mileage changes.
              */}
              <span className="flex-1 min-w-0 truncate text-[11px] text-white/30">
                {vehicle.year} {vehicle.make} {vehicle.model}
                {` · ${displayMileage.toLocaleString()} mi`}
                {openItemCount > 0 && ` · ${openItemCount} open item${openItemCount === 1 ? '' : 's'}`}
              </span>

              <Button
                onClick={() => handleSend()}
                disabled={loading || uploadingFiles || (!input.trim() && selectedFiles.length === 0)}
                size="sm"
                aria-label="Send"
                className="tap-target-44 h-8 bg-cyan-600 hover:bg-cyan-500 text-white border-0 transition-all disabled:opacity-40"
              >
                {uploadingFiles ? (
                  <Loader2 className="h-[15px] w-[15px] animate-spin" />
                ) : (
                  <Send className="h-[15px] w-[15px]" />
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
