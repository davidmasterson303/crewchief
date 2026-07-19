'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  Brain,
  Wrench,
  ShieldAlert,
  ClipboardList,
  ListChecks,
  FileText,
  Star,
  Zap,
  MessageSquare,
} from 'lucide-react';

interface FeaturesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FEATURES = [
  {
    icon: Brain,
    label: 'AI Consultant',
    badge: 'Core',
    heading: 'Your car has a dedicated expert on call',
    body:
      "Ask anything about your vehicle and get answers grounded in your actual maintenance history, open issues, and the vehicle's known reliability profile. CrewChief connects the dots so you're never making decisions in the dark.",
  },
  {
    icon: ShieldAlert,
    label: 'Recall & Health Alerts',
    badge: 'Safety',
    heading: 'Know about problems before they strand you',
    body:
      "We pull live NHTSA recall data for your specific year, make, and model and surface it directly in your garage. A health score and plain-English summary give you an at-a-glance read on where your car stands today.",
  },
  {
    icon: ClipboardList,
    label: 'Maintenance History',
    badge: 'Records',
    heading: 'Every receipt, captured and searchable',
    body:
      "Upload invoices and service documents. CrewChief reads them, extracts line items, and builds a searchable maintenance timeline so you always know what was done, when, and what it cost — without digging through a glovebox.",
  },
  {
    icon: ListChecks,
    label: 'Mod & Repair Wishlist',
    badge: 'Planning',
    heading: 'Plan your upgrades and repairs in one place',
    body:
      "Queue up modifications, maintenance items, and issues you want to address. Assign estimated costs and labor hours, then generate a consolidated shop quote for multiple items at once to save time and negotiate better.",
  },
  {
    icon: FileText,
    label: 'Quote Generation',
    badge: 'Savings',
    heading: 'Walk into any shop fully prepared',
    body:
      "Select items from your wishlist and CrewChief drafts a detailed quote request you can send directly to a shop. Bundle related work to cut down on labor time and walk in knowing what a fair price looks like.",
  },
  {
    icon: Zap,
    label: 'Performance Profiles',
    badge: 'Enthusiast',
    heading: 'Set a goal, get a roadmap',
    body:
      "Tell CrewChief what you want from your car — daily reliability, weekend performance, track-day capability — and it tailors its recommendations to match. Performance stats and powertrain details are tracked so advice stays relevant.",
  },
  {
    icon: Star,
    label: 'Vehicle Insights',
    badge: 'Intelligence',
    heading: 'Model-specific knowledge, not generic advice',
    body:
      "CrewChief builds a knowledge base around your exact vehicle — common failure points, recommended service intervals, and owner community intelligence — then uses it as context for everything from the AI chat to health scoring.",
  },
  {
    icon: MessageSquare,
    label: 'Multi-Session Chat History',
    badge: 'Continuity',
    heading: 'Conversations that pick up where you left off',
    body:
      "Every consultant conversation is saved and titled automatically. Switch between sessions, revisit old advice, or start a fresh thread for a new topic without losing context from previous discussions.",
  },
  {
    icon: Wrench,
    label: 'Document Library',
    badge: 'Storage',
    heading: 'All your vehicle documents in one place',
    body:
      "Invoices, inspection reports, and service records are stored and linked directly to the vehicle they belong to. The consultant can read them as context when answering questions, making every response smarter.",
  },
];

export default function FeaturesDrawer({ open, onOpenChange }: FeaturesDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto bg-gray-950 border-gray-800 text-white p-0"
      >
        <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-800 px-6 py-5">
          <SheetHeader>
            <SheetTitle className="text-white text-xl font-bold tracking-tight">
              What CrewChief Does
            </SheetTitle>
            <p className="text-gray-400 text-sm leading-relaxed mt-1">
              A full-stack ownership tool built for people who actually care about their cars.
            </p>
          </SheetHeader>
        </div>

        <div className="px-6 py-6 space-y-6">
          {FEATURES.map(({ icon: Icon, label, badge, heading, body }) => (
            <div
              key={label}
              className="group flex gap-4 p-4 rounded-xl border border-gray-800 hover:border-cyan-500/40 hover:bg-gray-900/60 transition-all duration-200"
            >
              <div className="flex-shrink-0 mt-0.5">
                <div className="h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                  <Icon className="h-4 w-4 text-cyan-400" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-white">{label}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 border-gray-700 text-gray-400 font-normal"
                  >
                    {badge}
                  </Badge>
                </div>
                <p className="text-xs font-medium text-cyan-400 mb-1.5">{heading}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}

          <div className="mt-2 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
            <p className="text-xs text-gray-400 leading-relaxed">
              <span className="text-cyan-400 font-medium">Built for the long haul.</span>{' '}
              CrewChief grows with your car. Every service record, every conversation, every decision you log makes future recommendations sharper and more personalized.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
