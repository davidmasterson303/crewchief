'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { scrollBehavior } from '@/hooks/use-reduced-motion';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader as Loader2, Send, Plus, Search, MessageSquare, Paperclip, X, FileText, ExternalLink, Heart, Check, Wrench, TriangleAlert, Sparkles, PanelLeft, Copy } from 'lucide-react';
import { logger } from '@wellkept/core/logger';
import { isDemoVehicleId } from '@wellkept/core/demo';
import { ADVISOR_NAME } from '@wellkept/core/prompts';
import { refusalCopy } from '@wellkept/core/access';
import { demoQuestionsFor } from '@wellkept/core/demo-answers';
import { isDemoMode } from '@/lib/demo-mode';
import { wishlistItemIdentifier } from '@wellkept/core/wishlist-identifier';
import {
  sendConsultantMessage,
  createConsultantSession,
  generateSessionTitle,
  getConsultantSession,
  getConsultantSessions,
  recordQuotePullClick,
} from '@/app/actions';
import { QuoteRequestDialogV2 } from './QuoteRequestDialogV2';
import { toast } from 'sonner';
import { invalidateDashboardCache } from '@wellkept/core/query-invalidation';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { CONTEXT_KIND_LABELS, type ContextKind } from '@wellkept/core/consultant-context-kinds';
import { AnswerRuns } from '@/components/AnswerLine';
import { parseAnswer } from '@wellkept/core/answer-markup';
import { adviceDisclosure } from '@wellkept/core/advice-disclosure';

/*
 * These are the four collections this component *renders*, and no longer the
 * fifteen it used to forward to the advisor. `knowledge`, `completedItems`,
 * `maintenanceLineItems`, `issueTracking`, `modTracking`, `nhtsaData`,
 * `healthSummary` and `modWishlistItems` were props for one reason — to be
 * posted straight back to `sendConsultantMessage` — and the server has loaded
 * its own copy of all of them since `a0e9894`.
 *
 * The page still reads several of them for other consumers (DashboardLayout
 * takes `knowledge`), so this narrows the component's surface, not the page's
 * query. Narrowing the query is a separate job with different blast radius.
 */
interface ConsultantChatProps {
  vehicleId: string;
  vehicle: any;
  /** Outstanding `service_items` — the high-priority strip in the empty state. */
  wishlistItems: any[];
  /** All `service_items`, for the open-item count in the header. */
  allServiceItems: any[];
  /*
    No `documents`. There was one, it was destructured and never read, and it
    was the last client-side reason to query `vehicle_documents` at all — which
    is what let 20260801140000 give that table an owner-only policy with no demo
    arm. Attachments shown in the transcript come from `msg.documents`, recorded
    on the turn, not from this prop.
  */
  sessions: any[];
  initialSessionId?: string;
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
    /*
      `text-white/60` rather than `opacity-60`: the chip wraps a `text-sm` file
      name, and an alpha on the wrapper multiplies against whatever the children
      set — the shape that put `ModificationsTab`'s badges at an effective 0.30.
      A colour lands on the text the guard can measure, and the children here
      set no colour of their own, so it reads identically.
    */
    return <div className={`${className} text-white/60 cursor-default`}>{body}</div>;
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

/*
 * What the model was actually given.
 *
 * ── Two bugs, in order ──────────────────────────────────────────────────────
 *
 * First version lowercased the assistant's own reply and keyword-matched it:
 * `content.includes('oil')` produced a "Service records" chip,
 * `includes('recall')` produced "Issue history". The chips asserted what the
 * system had read, and nothing about them was connected to what it read. A
 * reply that merely said the word "recall" claimed issue history had been
 * consulted whether or not a single row existed. Worse, `includes('mod')`
 * matches "model", "modern", "moderate" and "modify", so a reply mentioning
 * "the 2019 model" earned a "Mod profile" badge — that fires on ordinary copy,
 * not edge cases.
 *
 * Second version fixed that by computing the chips from the context collections
 * this component posted to `sendConsultantMessage`. Honest at the time. Then
 * the context moved server-side into `loadConsultantContext`, the server began
 * ignoring what was posted and loading its own — and these chips went on
 * describing the discarded payload. A provenance claim whose evidence had been
 * cut away underneath it, which is the same failure as the "AI Extracted"
 * badge removed in `9597869`.
 *
 * ── What it claims now ──────────────────────────────────────────────────────
 *
 * The server returns `contextKinds` from the context it actually loaded. The
 * claim is "this was loaded and put in front of the model" — checkable where it
 * is made, and no longer checkable here, which is precisely why it moved. It is
 * still not "the model used this", so the row stays prefixed "Based on".
 *
 * Stored on the message at send time, because context is a property of the
 * turn, not of the transcript. Messages replayed from a saved session carry no
 * `sources` and therefore show no chips: the honest rendering of "we no longer
 * know" is to claim nothing, not to recompute from today's garage and backdate
 * it onto an old answer.
 *
 * ── Where the words themselves live ────────────────────────────────────────
 *
 * `@wellkept/core/consultant-context-kinds`, since the Expo advisor screen
 * renders this same row. The labels are a provenance claim, so a second copy on
 * the phone would let the two clients describe one answer differently. Only the
 * icons below are web — Lucide has no React Native build here.
 */
function contextIcon(kind: ContextKind) {
  if (kind === 'issues' || kind === 'recalls') return <TriangleAlert className="h-2.5 w-2.5" />;
  if (kind === 'mods') return <Sparkles className="h-2.5 w-2.5" />;
  if (kind === 'wishlist') return <Heart className="h-2.5 w-2.5" />;
  return <Wrench className="h-2.5 w-2.5" />;
}

export default function ConsultantChat({
  vehicleId,
  vehicle,
  wishlistItems,
  allServiceItems,
  sessions: initialSessions,
  initialSessionId,
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
  /*
    Phase 2.98a. This was a `Set` of `name-type` keys, which was all the "✓
    Added" state needed. The quote pull needs the *row* — a wishlist id to
    preselect, and a description and category to render in the dialog's step 1
    — because the `wishlistItems` prop is server-rendered and does not contain
    an item added seconds ago in this component. So it is a Map keyed the same
    way; `.has()` keeps every existing call site working unchanged.
  */
  const [addedWishlistItems, setAddedWishlistItems] = useState<
    Map<string, { id: string | null; description: string; category: string }>
  >(new Map());
  const [addingWishlistItem, setAddingWishlistItem] = useState<string | null>(null);
  const [quotePullOpen, setQuotePullOpen] = useState(false);
  const [quotePullItemIds, setQuotePullItemIds] = useState<string[]>([]);
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
      /*
        `behavior` is specified to win over the `scroll-behavior` property, so
        the blanket reduced-motion rule in globals.css does not reach this —
        it is the one case where the CSS looks like it has motion covered and
        does not. Asked explicitly instead.
      */
      container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior() });
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
        /*
          Both outcomes carry an id, and both are needed: 201 returns the new
          row, 409 returns `itemId` for the row that already existed. The 409
          is not an edge case here — the dossier and the consultant can suggest
          the same job, so "already in your wishlist" is a normal way to arrive
          at an item the user then wants quotes for.
        */
        const id: string | null = result?.wishlistItem?.id ?? result?.itemId ?? null;
        /*
          Recorded whether or not an id came back. The "✓ Added" state is the
          user's feedback that their tap worked and must not become conditional
          on a field the quote pull happens to want — a missing id costs the
          item its place in the pull, not its acknowledgement.
        */
        setAddedWishlistItems((prev) => {
          const next = new Map(prev);
          next.set(key, {
            id,
            description: action.description || action.name,
            category:
              action.type === 'modification'
                ? 'modification'
                : action.type === 'maintenance'
                  ? 'maintenance'
                  : 'repair',
          });
          return next;
        });
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

  /**
   * Phase 2.98a/c — open the quote request against the work just accepted.
   *
   * The instrumentation call is fired but not awaited, and its failure cannot
   * reach the user: 2.98 exists to find out whether anyone takes this path, and
   * a measurement that can block the thing it measures is worse than no
   * measurement. The dialog opens either way.
   */
  const handleQuotePull = (itemIds: string[]) => {
    void recordQuotePullClick('consultant_reply', vehicleId, itemIds.length).catch(() => {});
    setQuotePullItemIds(itemIds);
    setQuotePullOpen(true);
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

    /*
      Only the question, the thread, and the files attached to this turn.

      The vehicle's entire context used to be posted alongside — twelve fields,
      loaded by app/consultant/[vehicleId]/page.tsx and shipped back on every
      message. `loadConsultantContext` now derives all of it from `vehicleId`
      server-side, so sending it was pure upload cost against a payload the
      server discarded.
    */
    const result = await sendConsultantMessage({
      vehicleId,
      sessionId: currentSessionId || 'demo-session',
      message: userMessage || 'Please review the attached document(s).',
      messageHistory: messages,
      attachedDocuments: uploadedDocs,
    });

    stopThinkingAnimation();
    setLoading(false);

    if (result.success) {
      const assistantMsg = {
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        wishlistActions: result.wishlistActions,
        /* Reported by the server from the context it loaded for this turn —
         * see the note above `contextIcon`. What was put in front of the
         * model, not what the model used, and deliberately absent on replayed
         * history. */
        sources: result.contextKinds ?? [],
        /*
          ⚠ Set by the server when this answer was written in advance rather
          than generated — the demo, which makes no model call at all since
          30 Aug. It rides on the message rather than on component state so a
          scrolled-back conversation cannot lose the label while keeping the
          answer, which is the one way this could quietly become a lie.
        */
        isSample: result.isSample === true,
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
    /*
      R4. This was `h-[calc(100vh-320px)] min-h-[520px] max-h-[760px]` at every
      width. On a 375x667 phone the calc yields 347px, `min-h` wins, and a
      520px panel sits inside a page that has already spent ~400px on banner,
      nav, tab strip, title and meta row. Measured before the fix: the composer
      began 860px down a 692px viewport.

      Below `md` the panel now takes the height the shell gives it — see
      `mobileLayout="app-shell"` in DashboardLayout — and the thread inside is
      the only thing that scrolls. `h-full` rather than a second `100dvh`,
      because the shell has already subtracted the nav.

      From `md` up the original clamp is untouched, and `100dvh` replaces
      `100vh` there too: same number on a desktop, correct on a tablet with a
      collapsing browser chrome.
    */
    <div className="relative h-full md:h-[calc(100dvh-320px)] md:min-h-[520px] md:max-h-[760px] border-0 md:border md:border-white/10 rounded-none md:rounded-2xl overflow-hidden flex bg-slate-950/90 md:shadow-xl md:shadow-black/40 animate-consultant-fade">
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-7 px-2.5 border-0 text-xs rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
            <Input fieldSize="sm"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs"
              /*
                ⚠ Inline, because `pl-8` loses here and that is not obvious.

                `.field-sm` lives in `@layer utilities` and sets the `padding`
                **shorthand**. Same specificity as `pl-8`, declared later, so it
                wins — measured live: `padding-left` resolved to 10px while the
                icon's right edge sat at 26px, putting the glyph on top of the
                first characters of its own placeholder. A design critique of
                the rendered page saw it as a rendering fault, which it is.

                The fix belongs in that class eventually — a component's padding
                should not outrank a caller's utility — but moving `.field-sm`
                out of the utilities layer changes every field in the app, and
                this is one input.
              */
              style={{ paddingLeft: '2rem' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4 py-8">
              <MessageSquare className="h-8 w-8 text-white/15 mb-3" />
              <p className="text-xs text-white/50 leading-relaxed">
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
                  <p className="text-xs text-white/50 mt-1">
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
        {/* `min-h-0` is load-bearing, not defensive. A flex child's default
            `min-height: auto` refuses to shrink below its content, so without
            it `flex-1` grows the thread to fit every message and pushes the
            composer out of the shell — the same symptom R4 set out to fix,
            arriving by a different route. */}
        <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-info-wash border border-info-border flex items-center justify-center mx-auto mb-5">
                  <MessageSquare className="h-7 w-7 text-info" />
                </div>
                {/*
                  The advisor is Jay; the product is Well Kept. Both names come
                  from one constant in core, so this greeting, the turn bylines
                  below and the name the model is given cannot drift apart.
                */}
                <h3 className="text-lg font-bold mb-2 text-white">Hey, {ADVISOR_NAME} here.</h3>
                <p className="text-white/55 mb-5 text-sm leading-relaxed">
                  I know your {vehicle.year} {vehicle.make} {vehicle.model} inside and out. What&apos;s on your mind?
                </p>
                <div className="grid gap-2 text-left">
                  {/*
                    ── ⚠ On the demo these MUST be the questions it holds ─────

                    The demo answers from a fixed set of pre-written answers and
                    matches on the exact question. These four prompts were
                    written for a live model and match none of them — so every
                    chip dead-ended in "the demo answers a fixed set of
                    questions", on the one surface a recruiter is sent to.

                    A prompt that cannot be answered is worse than no prompt.
                    So the demo offers its own questions and the product offers
                    the open ones, and the two lists cannot drift because the
                    demo's come from the module that answers them.
                  */}
                  {(isDemoVehicleId(vehicleId) ? demoQuestionsFor(vehicleId).map((entry) => entry.question) : [
                    'Something acting funny? Let\'s figure it out.',
                    'Planning your next round of work? I\'ll help prioritize.',
                    'Got a quote from a shop? Send it over for a second opinion.',
                    'Thinking about mods? I know what works on these.',
                  ]).map((suggestion, i) => (
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
                      <span className="text-xs font-semibold uppercase tracking-widest text-white/50">{ADVISOR_NAME}</span>
                      <span className="text-xs text-white/50">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div
                    className={
                      msg.role === 'user'
                        ? 'max-w-[80%] bg-primary/90 text-primary-foreground rounded-2xl rounded-tr-sm p-4 overflow-hidden'
                        /*
                          Unboxed: no background, border, radius or padding. A
                          an answer from Jay is a diagnosis, not a chat line, and
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
                    {/*
                      ── ⚠ `parseAnswer`, not `split('\n')` + `parseAnswerLine` ─

                      Two things the line-at-a-time route could not do, both of
                      which the phone has had for a while:

                      **Bullets.** `parseAnswer` consumes the `-`/`*` marker and
                      says the line is a bullet; splitting by hand left the
                      marker in the text, so a list the advisor wrote rendered
                      on the web as prose beginning with a hyphen.

                      **Figures.** A cost breakdown arrived as a run of
                      identical paragraphs — "$115" weighted the same as the
                      sentence around it — and a design critique named it the
                      biggest miss on this screen. `parseAnswer` hands back the
                      label and the amount already tokenised, so the numbers can
                      line up in a column without this component guessing at
                      what a number looks like.
                    */}
                    <div className="space-y-1.5">
                      {parseAnswer(msg.content).map((line, i: number) => {
                        if (line.kind === 'figure' && line.figure) {
                          const { total } = line.figure;
                          return (
                            <p
                              key={i}
                              /*
                                ⚠ The summing row is promoted. A critique of the
                                rendered page: "the total isn't a total" — it
                                sat at the same weight as a $115 brake flush,
                                so "the punchline row of the whole answer has
                                no promotion". A heavier rule above it and a
                                larger figure is what a printed estimate does,
                                and `answer-markup` decides which row it is by
                                reading the word the model wrote.
                              */
                              className={
                                total
                                  ? 'mt-1 flex items-baseline justify-between gap-4 border-t border-white/25 pt-2 text-sm leading-normal'
                                  : 'flex items-baseline justify-between gap-4 border-b border-white/8 py-1 text-sm leading-normal last:border-b-0'
                              }
                            >
                              <span className="min-w-0 break-words">
                                <AnswerRuns tokens={line.figure.label} lineKey={i} />
                              </span>
                              {/*
                                ⚠ Neither the house `.num` class nor
                                `tabular-nums`, and the reason is what these
                                amounts contain.

                                They are not pure figures — they carry words
                                and ranges: "$800 all-in", "~$1,900-2,100".
                                Tabular figures give every glyph the width of a
                                digit, **including the hyphen**, so "all-in"
                                rendered with a gap either side of its dash and
                                a critique reported it as "$800 all - in".
                                `.num` adds the register's negative tracking on
                                top, which was never meant for prose.

                                Tabular buys decimal alignment, and these are
                                right-aligned against a rule instead — the
                                column lines up on its edge, which is what a
                                printed estimate does with mixed amounts.
                              */}
                              <span
                                className={`shrink-0 text-white ${
                                  total ? 'text-base font-bold' : 'font-semibold'
                                }`}
                              >
                                <AnswerRuns tokens={line.figure.amount} lineKey={i} />
                              </span>
                            </p>
                          );
                        }

                        if (line.kind === 'bullet') {
                          return (
                            <p key={i} className="flex gap-2.5 text-sm leading-normal break-words">
                              <span aria-hidden="true" className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-white/40" />
                              <span className="min-w-0">
                                <AnswerRuns tokens={line.tokens} lineKey={i} />
                              </span>
                            </p>
                          );
                        }

                        return (
                          <p key={i} className="text-sm leading-normal break-words">
                            <AnswerRuns tokens={line.tokens} lineKey={i} />
                          </p>
                        );
                      })}
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
                              {/*
                                An explicit colour per state, not `opacity-50`.
                                An alpha multiplier is the one form of de-emphasis
                                `text-contrast-floor.test.ts` structurally cannot
                                measure — it reads colour classes — so a faded
                                label is an unaudited one. Same rule R10 states:
                                contrast, not size, makes a label recede.
                              */}
                              <span
                                className={`text-xs capitalize ${isAdded ? 'text-green-300/60' : 'text-info/60'}`}
                              >
                                {action.type}
                              </span>
                              {!isAdded && !isAdding && <span className="text-xs text-cyan-400 font-semibold">+ Add</span>}
                            </button>
                          );
                        })}
                        {/*
                          Phase 2.98a — the quote pull.

                          Deliberately conditional on something having been
                          added, not shown beside every suggestion. The pull is
                          for the moment a user has decided work is needed and
                          is now weighing what it should cost; offering it
                          against an empty selection would be a dead button and
                          would train people to ignore the row.

                          `generateQuoteRequestV2` takes wishlist ids, so an
                          item with no id cannot be quoted — those are filtered
                          rather than sent, which is why this can disappear
                          again even after an add.
                        */}
                        {(() => {
                          const pullable = msg.wishlistActions
                            .map((a: any) => addedWishlistItems.get(`${a.name}-${a.type}`))
                            .filter((entry: any): entry is { id: string; description: string; category: string } =>
                              Boolean(entry?.id)
                            );
                          if (pullable.length === 0) return null;
                          return (
                            <button
                              onClick={() => handleQuotePull(pullable.map((e: any) => e.id))}
                              className="flex items-center gap-2 w-full text-left p-2.5 rounded-xl text-sm min-h-[44px] bg-amber-400/10 border border-amber-400/25 text-amber-300 hover:bg-amber-400/20 hover:border-amber-400/40 transition-all"
                            >
                              <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                              <span className="flex-1 font-medium text-xs">Get competing quotes</span>
                              <span className="text-xs text-amber-300/60">
                                {pullable.length} item{pullable.length > 1 ? 's' : ''}
                              </span>
                            </button>
                          );
                        })()}
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
                      <span className="text-xs text-white/50 font-medium">Based on</span>
                      {msg.sources.map((kind: ContextKind) => (
                        <span
                          key={kind}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/6 border border-white/10 text-xs text-white/50 font-medium"
                        >
                          {contextIcon(kind)}
                          {CONTEXT_KIND_LABELS[kind]}
                        </span>
                      ))}
                    </div>
                  )}

                  {/*
                    ── ⚠ UX-16 / LEG-05 · the disclosure, where the advice is ──

                    **The product never said its advice was AI-generated**, and
                    the safety disclaimer lived only on a Terms page nobody
                    opens. A disclaimer at the point of advice is worth far more
                    than one behind a link, and it costs a line of copy.

                    Under every assistant turn, not once at the top of the
                    thread: a person scrolling a long conversation reads the
                    answer, not the header. `adviceDisclosure` keeps the wording
                    identical here and on the phone — a safety sentence that
                    says one thing on one client is this codebase's most
                    repeated defect applied to the sentence that limits
                    liability.
                  */}
                  {msg.role === 'assistant' && msg.content && msg.isSample && (
                    /*
                      ⚠ A pre-written answer says so, above the disclosure and
                      not instead of it. The two sentences answer different
                      questions — "who wrote this" and "when" — and a sample
                      that only carried the AI disclosure would be claiming a
                      model produced it for this visitor, which is precisely the
                      class of defect the scan sweep and the quote bar were.
                    */
                    <p className="measure text-xs text-white/60 mt-2 italic">
                      {refusalCopy('demo', 'generate')}
                    </p>
                  )}
                  {/*
                    ⚠ Set as apparatus, not as a second paragraph.

                    A design critique asked for this once per thread instead of
                    under every turn — "a tax on every message" — and that is
                    the one note here I am not taking. The comment above says
                    why and it still holds: a person scrolling a long
                    conversation reads the answer, not the header, and this is
                    the sentence that limits liability.

                    What the critique was right about is weight: three lines of
                    body-sized copy after every answer competed with the answer.
                    A hairline and a tighter setting make it read as a footnote
                    to the turn, which is what it is. Same words, same
                    frequency, less shout.
                  */}
                  {msg.role === 'assistant' && msg.content && (
                    <p className="measure mt-3 border-t border-white/8 pt-2 text-xs leading-normal text-white/50">
                      {adviceDisclosure('consultant')}
                    </p>
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
                        className="tap-target-44 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-white/50 hover:text-white/70 transition-colors"
                        aria-label="Copy this answer"
                      >
                        {copiedTurn === index ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedTurn === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}

                  {/* The user bubble keeps its timestamp, below and right. */}
                  {msg.role === 'user' && (
                    <div className="text-xs text-white/50 mt-1">
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
                    <span className="text-xs font-semibold uppercase tracking-widest text-white/50">{ADVISOR_NAME}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-info flex-shrink-0" />
                    <span className="text-sm text-white/50">{THINKING_STAGES[thinkingStage]}</span>
                  </div>
                </div>
              )}

              {showFollowUps && !loading && currentFollowUps.length > 0 && (
                <div className="flex flex-col gap-2 animate-slide-up">
                  <p className="text-xs text-white/50 font-medium">Ask a follow-up</p>
                  <div className="flex flex-wrap gap-2">
                    {currentFollowUps.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleFollowUpClick(suggestion)}
                        /*
                          RB0 rule 3, and deliberately NOT `.tap-target-44`.
                          That utility centres a 44px ::after on the element,
                          which on a ~30px chip overhangs ~7px top and bottom.
                          These chips wrap at `gap-2` — 8px — so two rows of
                          them would have overlapping hit areas and the tap
                          would land on whichever ::after paints last. A
                          control that answers the wrong tap is worse than one
                          that is slightly too small, so this grows for real.
                        */
                        className="text-left px-3 py-2.5 min-h-[44px] bg-white/5 hover:bg-cyan-400/10 border border-white/10 hover:border-cyan-400/30 rounded-full text-xs text-white/60 hover:text-white transition-all"
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
                        <p className="text-xs text-white/50 mt-0.5">Get quotes from local shops</p>
                      </div>
                      <a
                        href={`/dashboard/${vehicleId}?tab=wishlist`}
                        className="flex-shrink-0 px-2.5 py-1 bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 rounded-lg text-xs font-semibold text-amber-300 transition-colors"
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

        {/* `shrink-0` so the composer keeps its height as the thread grows —
            the whole point of the shell. The safe-area padding is for phones
            with a home indicator, where the last 34px of the viewport is not
            reliably tappable and the send button was landing in it. */}
        <div className="shrink-0 border-t border-white/8 bg-black/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4">
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
                      <p className="text-xs text-white/50">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
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
          {/*
            ⚠ `group` so the helper line below can wait for focus. See its own
            note — at rest the composer was three stacked rows for an idle
            input, and only one of them was the input.
          */}
          <div className="composer-panel group rounded-xl">
            <Textarea
              ref={textareaRef}
              placeholder="Ask me anything about your vehicle..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              rows={1}
              /* No `text-sm` here. A Tailwind utility outranks the bare `textarea`
                 selector in globals.css, so it would have kept this one control at
                 14px and left the iOS zoom in the single most-tapped field in the
                 product. R2 — the composer inherits the field scale. */
              className="resize-none border-0 bg-transparent text-white placeholder:text-white/50 px-3 pt-2.5 pb-1 min-h-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
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
              <span className="flex-1 min-w-0 truncate text-xs text-white/50">
                {vehicle.year} {vehicle.make} {vehicle.model}
                {` · ${displayMileage.toLocaleString()} mi`}
                {openItemCount > 0 && ` · ${openItemCount} open item${openItemCount === 1 ? '' : 's'}`}
              </span>

              <Button
                onClick={() => handleSend()}
                disabled={loading || uploadingFiles || (!input.trim() && selectedFiles.length === 0)}
                size="sm"
                aria-label="Send"
                className="tap-target-44 h-8 bg-primary hover:bg-primary/90 text-primary-foreground border-0 transition-all disabled:opacity-40"
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
          {/*
            ⚠ The keyboard half is desktop-only, and it was not.

            "Enter to send · Shift+Enter for new line" rendered on a 390px
            phone, where there is no Enter key doing that and no Shift at all —
            a design critique called it "an instant tell that the mobile layout
            is the desktop layout squeezed", and it was exactly that. The
            attachment limit is true on every device, so it stays.
          */}
          {/*
            ── ⚠ Shown on focus, not at rest ─────────────────────────────────

            A critique of the rendered page called the composer "a monument":
            three stacked rows for an idle input — the field, the vehicle chip,
            and this. It is instruction for someone about to type, and at rest
            nobody is.

            ⚠ Not conditionally rendered. It stays in the DOM so a screen
            reader reaches it and so the composer's height does not jump when
            the field takes focus; only its opacity moves. The placeholder's
            own size is untouched — 16px is R2's iOS zoom floor, not a
            typographic choice.
          */}
          <p className="mt-2 text-xs text-white/50 opacity-0 transition-opacity group-focus-within:opacity-100">
            <span className="hidden sm:inline">
              Enter to send &middot; Shift+Enter for new line &middot;{' '}
            </span>
            Attach up to 3 files
          </p>
        </div>
      </div>

      {/*
        Phase 2.98a. The item list is the server-rendered wishlist *merged with*
        anything added during this conversation, because the prop is a snapshot
        from page load and the whole point of this entry point is to quote work
        the user accepted a moment ago.

        Merged by id with the server row winning, so an item that came back as a
        409 — already on the wishlist — appears once with its stored name rather
        than twice.
      */}
      <QuoteRequestDialogV2
        open={quotePullOpen}
        onOpenChange={setQuotePullOpen}
        vehicleId={vehicleId}
        wishlistItems={(() => {
          const merged = new Map<string, { id: string; description: string; category: string }>();
          for (const entry of Array.from(addedWishlistItems.values())) {
            if (entry.id) {
              merged.set(entry.id, {
                id: entry.id,
                description: entry.description,
                category: entry.category,
              });
            }
          }
          for (const item of wishlistItems || []) {
            if (!item?.id) continue;
            merged.set(item.id, {
              id: item.id,
              description: item.item_name || item.description || 'Service item',
              category: item.category || 'repair',
            });
          }
          return Array.from(merged.values());
        })()}
        preferredZipCode={vehicle?.preferred_zip_code}
        preselectedItemIds={quotePullItemIds}
        onQuoteSaved={() => {
          toast.success('Quote request saved!');
        }}
      />
    </div>
  );
}
