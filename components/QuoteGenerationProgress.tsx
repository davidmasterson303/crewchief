'use client';

import { motion } from 'framer-motion';
import { Wrench, Zap } from 'lucide-react';

/**
 * What is actually happening while a quote is generated, and nothing else.
 *
 * ── The third fake indicator, and the last one ──────────────────────────────
 *
 * This panel ran two `setInterval`s. One advanced a percentage 2 points every
 * 150ms to a hard 100; the other ticked four hard-coded stages every 2.5s and
 * drew green checks behind them. Neither was connected to anything. The client
 * awaits exactly one call — `generateQuoteRequestV2` — so there were no stages
 * to be on, no percentage to be at, and the bar reached 100% at 7.5 seconds
 * whether the answer had arrived or not.
 *
 * Two of the stages were worse than decorative. *"Checking regional labor
 * rates"* describes a lookup this product does not perform: the ZIP is typed by
 * the owner and pasted into a prompt, and the model is asked to allow for local
 * rates. *"Using AI to analyze market rates and regional pricing data"* named a
 * data source that does not exist. A progress step is a claim about work, and
 * these claimed work nobody does.
 *
 * ── Why a beat at all ──────────────────────────────────────────────────────
 *
 * David's call on the same defect in the hero and the invoice scanner:
 * *"not to remove the beat but to make it narrate something real… Same
 * reassurance, no fiction."* So the panel stays and the subject changes. What
 * this component can honestly say is what it was handed — the items being
 * priced, by name, and the ZIP going with them.
 *
 * **No percentage.** The wait is one model call, and a client cannot measure a
 * model call's progress. An indeterminate bar says "working" without claiming
 * to know how much is left; a number says something false to two significant
 * figures.
 *
 * **No per-item ticks.** The items are a list of what was sent, not a queue
 * being worked through — one request prices all of them at once, so marking
 * them off individually would invent an order that does not exist. Same
 * reasoning as the invoice scanner's two stages rather than four: the client
 * awaits one thing, and everything inside it is one opaque wait.
 *
 * ⚠ The old panel announced nothing to a screen reader — the stages were divs
 * that changed colour. It was, for a blind user, purely decorative *and*
 * purely fictional. `role="status"` now, with the sentence a screen reader
 * needs rather than the layout a sighted reader gets.
 */

interface ServiceItem {
  id: string;
  description: string;
  category: string;
}

interface QuoteGenerationProgressProps {
  items: ServiceItem[];
  zipCode: string;
}

export function QuoteGenerationProgress({ items, zipCode }: QuoteGenerationProgressProps) {
  const count = items.length;

  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <div className="text-center space-y-3">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', duration: 0.5 }}
          className="flex justify-center"
        >
          <div className="relative">
            <Zap className="h-16 w-16 text-info" aria-hidden="true" />
            <motion.div
              className="absolute inset-0 bg-info-wash rounded-full blur-xl"
              animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
        <h3 className="text-2xl font-bold text-info">Generating your quote</h3>
        <p className="text-sm text-muted-foreground">
          {/*
            Both halves are facts this component was handed. The ZIP is stated
            as something included rather than something consulted, because that
            is all that happens to it.
          */}
          Pricing {count} service {count === 1 ? 'item' : 'items'}. Your ZIP code {zipCode} goes
          with the request so the ranges can allow for local labour rates.
        </p>
      </div>

      {/*
        Indeterminate, and it has to stay that way. A determinate bar needs a
        denominator, and the only honest one here is "one call, unknown length".
        The CSS blanket rule in globals.css neutralises this under
        `prefers-reduced-motion`; it is a CSS animation for exactly that reason.
      */}
      <div
        className="h-1.5 bg-slate-800/80 rounded-full overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="h-full w-1/3 rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)',
            animation: 'indeterminateSlide 1.6s ease-in-out infinite',
          }}
        />
      </div>
      <style jsx>{`
        @keyframes indeterminateSlide {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(300%);
          }
        }
      `}</style>

      {count > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">
            {count === 1 ? 'The item' : 'The items'} being priced
          </div>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-info-border bg-black/20 p-3"
            >
              <Wrench className="h-4 w-4 text-info mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm text-foreground leading-snug">{item.description}</p>
                {item.category && (
                  <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        What the answer will contain, which is knowable — the action returns a
        cost breakdown and an email draft, always both. Naming the output is not
        the same as claiming to be part-way through producing it.
      */}
      <p className="text-center text-xs text-muted-foreground leading-relaxed">
        You will get parts and labour ranges for each item, and an email draft you can send to a
        shop.
      </p>
    </div>
  );
}
