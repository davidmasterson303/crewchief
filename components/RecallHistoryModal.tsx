'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, AlertCircle } from 'lucide-react';

interface RecallHistoryModalProps {
  recalls: any[];
  trigger: React.ReactNode;
}

export default function RecallHistoryModal({ recalls, trigger }: RecallHistoryModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div onClick={() => setIsOpen(true)} className="cursor-pointer">
        {trigger}
      </div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              Recall History
            </DialogTitle>
            <DialogDescription>
              {recalls.length === 0
                ? 'This vehicle has no recalls to date'
                : `${recalls.length} recall${recalls.length !== 1 ? 's' : ''} found for this vehicle`}
            </DialogDescription>
          </DialogHeader>

          {recalls.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <p className="text-slate-600 font-medium">No recalls to date</p>
              <p className="text-slate-500 text-sm mt-2">This vehicle has a clean safety record</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recalls.map((recall: any, index: number) => (
                <div key={index} className="border rounded-lg p-4 bg-orange-50 border-orange-200">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-orange-600 flex-shrink-0" />
                        <h3 className="font-semibold text-slate-900">{recall.Component || 'Component Unknown'}</h3>
                      </div>
                      <p className="text-sm text-slate-700 mb-3">{recall.Summary || recall.Description || 'No summary available'}</p>
                      <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 mb-3">
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
                          <p className="text-xs text-slate-600">{recall.DefectSummary}</p>
                        </div>
                      )}
                      {recall.ConsequenceSummary && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Consequence:</p>
                          <p className="text-xs text-slate-600">{recall.ConsequenceSummary}</p>
                        </div>
                      )}
                      {recall.CorrectiveActionsSummary && (
                        <div>
                          <p className="text-xs font-semibold text-slate-700 mb-1">Corrective Action:</p>
                          <p className="text-xs text-slate-600">{recall.CorrectiveActionsSummary}</p>
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
