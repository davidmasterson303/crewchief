'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, AlertCircle, HelpCircle } from 'lucide-react';
import { healthClaim } from '@wellkept/core/health-claims';
import { RECALL_MATCH_CAVEAT } from '@wellkept/core/advice-disclosure';

interface RecallHistoryModalProps {
  recalls: any[];
  trigger: React.ReactNode;
  /**
   * Whether an NHTSA lookup has ever run for this vehicle.
   *
   * ⚠ Required rather than optional, and defaulted nowhere. An optional
   * `checked` would let an un-updated call site keep rendering the old
   * all-clear silently — the same reasoning `readCachedModDetails` uses for
   * making `performanceGoal` required.
   */
  checked: boolean;
}

/**
 * The recall list behind the health tile.
 *
 * ── ⚠ Why this needed `checked` ─────────────────────────────────────────────
 *
 * Found 22 Aug by the scan in `absence-is-not-an-all-clear.test.ts`, and it is
 * the **third** instance of one defect on the web plus one on mobile.
 *
 * `HealthSummary` computes `recallClaim` correctly and renders a grey question
 * mark and "We have not checked this vehicle for recalls yet… This is not a
 * clear result." **That tile is this modal's trigger.** So an owner read the
 * honest hedge, clicked it to find out more, and arrived at a green icon,
 * "No recalls to date", and — worst of all — **"This vehicle has a clean
 * safety record."**
 *
 * That last sentence is a claim about the *car*, not about NHTSA's list, which
 * makes it stronger than the copy `health-claims.ts` was written to undo. It
 * was rendered for a vehicle whose record had never been fetched.
 *
 * ⚠ The lesson is not "check the modal too". It is that a component receiving
 * only `recalls: any[]` **cannot** tell "checked, none found" from "never
 * checked", so it was structurally incapable of being right. The evidence has
 * to arrive as data.
 */
export default function RecallHistoryModal({ recalls, trigger, checked }: RecallHistoryModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div onClick={() => setIsOpen(true)} className="cursor-pointer">
        {trigger}
      </div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              Recall History
            </DialogTitle>
            <DialogDescription>
              {recalls.length > 0
                ? `${recalls.length} recall${recalls.length !== 1 ? 's' : ''} found for this vehicle`
                : checked
                  ? 'This vehicle has no recalls to date'
                  : 'We have not checked this vehicle for recalls yet'}
            </DialogDescription>
            {/*
              ⚠ §10 / D11. The description above says "found for this vehicle"
              and "no recalls to date" — both of which an owner will read as
              being about their car. The match was on year, make and model;
              there is no VIN in this lookup and never has been. Same constant
              as the alert card and the mobile screen.
            */}
            {checked && (
              <p className="text-xs text-muted-foreground pt-1">{RECALL_MATCH_CAVEAT}</p>
            )}
          </DialogHeader>

          {recalls.length === 0 ? (
            checked ? (
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
                <p className="text-muted-foreground font-medium">No recalls to date</p>
                <p className="text-slate-500 text-sm mt-2">This vehicle has a clean safety record</p>
              </div>
            ) : (
              /*
                ⚠ Neutral, not green, and not red either. Nothing has gone
                wrong for this owner — we simply have not got there yet, and
                `health-claims.ts` argues that saying so plainly beats both a
                tick and an alarm. The green tick above is the treatment this
                branch existed inside until 22 Aug.
              */
              <div className="text-center py-12">
                <HelpCircle className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <p className="text-muted-foreground font-medium">Recalls not checked yet</p>
                <p className="text-slate-500 text-sm mt-2">
                  {healthClaim('recall', '', false).text}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {recalls.map((recall: any, index: number) => (
                <div key={index} className="border rounded-lg p-4 bg-orange-50 border-orange-200">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-orange-600 flex-shrink-0" />
                        <h3 className="font-semibold text-foreground">{recall.Component || 'Component Unknown'}</h3>
                      </div>
                      <p className="text-sm text-slate-700 mb-3">{recall.Summary || recall.Description || 'No summary available'}</p>
                      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground mb-3">
                        {recall.NHTSACampaignNumber && (
                          <div>
                            <span className="font-semibold">Campaign Number:</span>
                            <div className="text-slate-700 font-mono mt-1">{recall.NHTSACampaignNumber}</div>
                          </div>
                        )}
                        {recall.ManufacturerName && (
                          <div>
                            <span className="font-semibold">Manufacturer:</span>
                            <div className="text-slate-700 mt-1">{recall.ManufacturerName}</div>
                          </div>
                        )}
                        {recall.ReportReceivedDate && (
                          <div>
                            <span className="font-semibold">Date Reported:</span>
                            <div className="text-slate-700 mt-1">{new Date(recall.ReportReceivedDate).toLocaleDateString()}</div>
                          </div>
                        )}
                        {recall.PotentialNumberOfAffectedVehicles && (
                          <div>
                            <span className="font-semibold">Affected Vehicles:</span>
                            <div className="text-slate-700 mt-1">{recall.PotentialNumberOfAffectedVehicles.toLocaleString()}</div>
                          </div>
                        )}
                      </div>
                      {recall.DefectSummary && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Defect:</p>
                          <p className="text-xs text-muted-foreground">{recall.DefectSummary}</p>
                        </div>
                      )}
                      {recall.ConsequenceSummary && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Consequence:</p>
                          <p className="text-xs text-muted-foreground">{recall.ConsequenceSummary}</p>
                        </div>
                      )}
                      {recall.CorrectiveActionsSummary && (
                        <div>
                          <p className="text-xs font-semibold text-slate-700 mb-1">Corrective Action:</p>
                          <p className="text-xs text-muted-foreground">{recall.CorrectiveActionsSummary}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <Button
                onClick={() => window.open('https://www.nhtsa.gov/recalls', '_blank')}
                variant="outline"
                className="w-full"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View More on NHTSA.gov
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
