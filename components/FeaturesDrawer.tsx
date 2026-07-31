'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
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

/*
 * Nine features, rewritten.
 *
 * The previous copy had one rhythm and used it nine times: a promise, then
 * "CrewChief" as the subject of a sentence explaining the promise, then a
 * closing flourish about darkness or gloveboxes. Read end to end it flattened —
 * every item sounded equally important, which is the same as none of them being.
 *
 * Two rules for the rewrite. Headings state what you get, not how it feels.
 * Bodies say the concrete thing — the actual data source, the actual artefact
 * that comes out — and stop, because a reader who opened a feature list is
 * already interested and does not need selling to twice.
 */
const FEATURES = [
  {
    icon: Brain,
    label: 'AI Consultant',
    badge: 'Core',
    heading: 'Answers about your car, not cars in general',
    body:
      'Ask what that noise is, whether a quote is fair, or what to do first. It answers with your mileage, your service history and your model’s known failure points already in hand.',
  },
  {
    icon: ShieldAlert,
    label: 'Recalls & Health',
    badge: 'Safety',
    heading: 'Open recalls, pulled from the NHTSA',
    body:
      'Live recall data for your exact year, make and model, surfaced in the garage rather than buried on a federal website. A health score summarises what needs attention now.',
  },
  {
    icon: ClipboardList,
    label: 'Service History',
    badge: 'Records',
    heading: 'Photograph a receipt, get a timeline',
    body:
      'Upload an invoice and the line items are read out of it — parts, labour, cost, date. What you get back is a searchable history instead of a folder of scans.',
  },
  {
    icon: ListChecks,
    label: 'Wishlist',
    badge: 'Planning',
    heading: 'A queue for everything the car needs',
    body:
      'Repairs, maintenance and modifications in one list, with your cost and labour estimates against each. Sort out what is urgent and what can wait until the next visit.',
  },
  {
    icon: FileText,
    label: 'Shop Quotes',
    badge: 'Savings',
    heading: 'Arrive with the job already written down',
    body:
      'Pick items off the wishlist and get a quote request you can hand to a shop. Bundling related work is where the labour savings are, so the draft groups it for you.',
  },
  {
    icon: Zap,
    label: 'Performance Goals',
    badge: 'Enthusiast',
    heading: 'Advice that knows what you want the car for',
    body:
      'A commuter and a track car do not want the same maintenance plan. Set the goal — reliability, weekend pace, track days — and recommendations change to match.',
  },
  {
    icon: Star,
    label: 'Model Knowledge',
    badge: 'Intelligence',
    heading: 'What owners of your car have already learned',
    body:
      'Common failure points, real service intervals and owner-community findings, collected per model and used as the basis for the consultant’s answers and the health score.',
  },
  {
    icon: MessageSquare,
    label: 'Chat History',
    badge: 'Continuity',
    heading: 'Conversations you can come back to',
    body:
      'Every thread is saved and titled. Pick up a repair discussion from three months ago, or start a clean one, without losing either.',
  },
  {
    icon: Wrench,
    label: 'Documents',
    badge: 'Storage',
    heading: 'Paperwork attached to the car it belongs to',
    body:
      'Invoices, inspections and service records stored against the vehicle. The consultant reads them too, so an answer can cite what a shop actually did.',
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
              Nine things it does, and what each one actually gives you.
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
                <div className="h-9 w-9 rounded-lg bg-info-wash border border-info-border flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                  <Icon className="h-4 w-4 text-info" />
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
                <p className="text-xs font-medium text-info mb-1.5">{heading}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}

          <div className="mt-2 p-4 rounded-xl bg-info-wash border border-info-border">
            <p className="text-xs text-gray-400 leading-relaxed">
              <span className="text-info font-medium">Built for the long haul.</span>{' '}
              CrewChief grows with your car. Every service record, every conversation, every decision you log makes future recommendations sharper and more personalized.
            </p>
          </div>

          {/*
            The drawer had no link in it at all — you read the whole feature
            list and the only way out was to close it. Somebody convinced by
            this content had nowhere to go.
          */}
          <div className="mt-4 flex flex-col items-center gap-3 pb-2">
            <Link href="/signup" onClick={() => onOpenChange(false)} className="w-full">
              <Button className="w-full h-11 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-all">
                Sign up
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Keep looking around the demo
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
