'use client';

import { useReducer, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CircleCheck as CheckCircle, ChevronLeft, ChevronRight, FileText, MapPin, Loader as Loader2, CircleAlert as AlertCircle, Wrench } from 'lucide-react';
import { generateQuoteRequestV2 } from '@/app/actions';
import { CostBreakdownTable } from './CostBreakdownTable';
import { EmailDraftDisplay } from './EmailDraftDisplay';
import { QuoteGenerationProgress } from './QuoteGenerationProgress';

interface ServiceItem {
  id: string;
  description: string;
  category: string;
}

interface CostEstimateItem {
  description: string;
  parts_cost_low: number;
  parts_cost_high: number;
  labor_hours_low: number;
  labor_hours_high: number;
  labor_cost_low: number;
  labor_cost_high: number;
  notes: string;
}

interface CostEstimate {
  items: CostEstimateItem[];
  regional_labor_rate: string;
  total_low: number;
  total_high: number;
}

interface DialogState {
  step: 1 | 2 | 3;
  selectedItemIds: Set<string>;
  zipCode: string;
  rememberZip: boolean;
  additionalNotes: string;
  quoteName: string;
  isGenerating: boolean;
  result: {
    costBreakdown: CostEstimate;
    emailDraft: string;
    quoteRequestId: string;
  } | null;
  error: string | null;
  validationErrors: {
    items?: string;
    zipCode?: string;
  };
}

type DialogAction =
  | { type: 'TOGGLE_ITEM'; itemId: string }
  | { type: 'SELECT_ALL'; itemIds: string[] }
  | { type: 'DESELECT_ALL' }
  | { type: 'SET_ZIP_CODE'; zipCode: string }
  | { type: 'SET_REMEMBER_ZIP'; remember: boolean }
  | { type: 'SET_ADDITIONAL_NOTES'; notes: string }
  | { type: 'SET_QUOTE_NAME'; name: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_GENERATING'; isGenerating: boolean }
  | { type: 'SET_RESULT'; result: DialogState['result'] }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' };

const initialState: DialogState = {
  step: 1,
  selectedItemIds: new Set(),
  zipCode: '',
  rememberZip: true,
  additionalNotes: '',
  quoteName: '',
  isGenerating: false,
  result: null,
  error: null,
  validationErrors: {},
};

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'TOGGLE_ITEM': {
      const newSet = new Set(state.selectedItemIds);
      if (newSet.has(action.itemId)) {
        newSet.delete(action.itemId);
      } else {
        newSet.add(action.itemId);
      }
      return { ...state, selectedItemIds: newSet, validationErrors: { ...state.validationErrors, items: undefined } };
    }
    case 'SELECT_ALL':
      return { ...state, selectedItemIds: new Set(action.itemIds), validationErrors: { ...state.validationErrors, items: undefined } };
    case 'DESELECT_ALL':
      return { ...state, selectedItemIds: new Set() };
    case 'SET_ZIP_CODE':
      return { ...state, zipCode: action.zipCode, validationErrors: { ...state.validationErrors, zipCode: undefined } };
    case 'SET_REMEMBER_ZIP':
      return { ...state, rememberZip: action.remember };
    case 'SET_ADDITIONAL_NOTES':
      return { ...state, additionalNotes: action.notes };
    case 'SET_QUOTE_NAME':
      return { ...state, quoteName: action.name };
    case 'NEXT_STEP':
      return { ...state, step: (Math.min(state.step + 1, 3) as 1 | 2 | 3) };
    case 'PREV_STEP':
      return { ...state, step: (Math.max(state.step - 1, 1) as 1 | 2 | 3) };
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.isGenerating };
    case 'SET_RESULT':
      return { ...state, result: action.result, step: 3, isGenerating: false };
    case 'SET_ERROR':
      return { ...state, error: action.error, isGenerating: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'RESET':
      return { ...initialState, zipCode: state.rememberZip ? state.zipCode : '' };
    default:
      return state;
  }
}

interface QuoteRequestDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  wishlistItems: ServiceItem[];
  preferredZipCode?: string;
  onQuoteSaved?: (quoteRequestId: string) => void;
}

export function QuoteRequestDialogV2({
  open,
  onOpenChange,
  vehicleId,
  wishlistItems,
  preferredZipCode,
  onQuoteSaved,
}: QuoteRequestDialogV2Props) {
  const [state, dispatch] = useReducer(dialogReducer, {
    ...initialState,
    zipCode: preferredZipCode || '',
  });

  useEffect(() => {
    if (open) {
      dispatch({ type: 'RESET' });
      if (preferredZipCode) {
        dispatch({ type: 'SET_ZIP_CODE', zipCode: preferredZipCode });
      }
    }
  }, [open, preferredZipCode]);

  const validateStep1 = () => {
    if (state.selectedItemIds.size === 0) {
      return 'Please select at least one item for the quote';
    }
    return null;
  };

  const validateStep2 = () => {
    if (!state.zipCode) {
      return 'Please enter a zip code';
    }
    if (!/^\d{5}$/.test(state.zipCode)) {
      return 'Please enter a valid 5-digit zip code';
    }
    return null;
  };

  const handleNext = () => {
    if (state.step === 1) {
      const error = validateStep1();
      if (error) {
        dispatch({ type: 'SET_ERROR', error });
        return;
      }
    } else if (state.step === 2) {
      const error = validateStep2();
      if (error) {
        dispatch({ type: 'SET_ERROR', error });
        return;
      }
      handleGenerate();
      return;
    }
    dispatch({ type: 'CLEAR_ERROR' });
    dispatch({ type: 'NEXT_STEP' });
  };

  const handleBack = () => {
    dispatch({ type: 'CLEAR_ERROR' });
    dispatch({ type: 'PREV_STEP' });
  };

  const handleGenerate = async () => {
    dispatch({ type: 'SET_GENERATING', isGenerating: true });
    dispatch({ type: 'CLEAR_ERROR' });

    try {
      const selectedIds = Array.from(state.selectedItemIds);
      const selectedItems = wishlistItems.filter(item => selectedIds.includes(item.id));

      const result = await generateQuoteRequestV2(
        vehicleId,
        selectedIds,
        state.zipCode,
        state.additionalNotes || undefined,
        state.quoteName || undefined,
        selectedItems
      );

      if (result.success && result.data) {
        dispatch({
          type: 'SET_RESULT',
          result: {
            costBreakdown: result.data.costBreakdown,
            emailDraft: result.data.emailDraft,
            quoteRequestId: result.data.quoteRequestId,
          },
        });
        if (onQuoteSaved) {
          onQuoteSaved(result.data.quoteRequestId);
        }
      } else {
        dispatch({ type: 'SET_ERROR', error: result.error || 'Failed to generate quote' });
      }
    } catch (error: any) {
      dispatch({ type: 'SET_ERROR', error: error.message || 'An unexpected error occurred' });
    }
  };

  const handleClose = () => {
    dispatch({ type: 'RESET' });
    onOpenChange(false);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'maintenance':
        return <Wrench className="h-4 w-4" />;
      case 'repair':
        return <AlertCircle className="h-4 w-4" />;
      case 'modification':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'maintenance': return 'bg-blue-500/12 text-blue-300 border-blue-400/25';
      case 'repair': return 'bg-orange-500/12 text-orange-300 border-orange-400/25';
      case 'modification': return 'bg-info-wash text-info border-info-border';
      default: return 'bg-white/8 text-white/50 border-white/12';
    }
  };

  const allSelected = wishlistItems.length > 0 && state.selectedItemIds.size === wishlistItems.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0d1117] border-white/12 p-0">
        <div className="px-4 sm:px-6 pt-6 pb-5 border-b border-white/8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-info-wash border border-info-border flex items-center justify-center">
              <FileText className="h-4 w-4 text-info" />
            </div>
            <DialogTitle className="text-lg font-semibold text-white">Request Quote</DialogTitle>
          </div>
          <div className="flex items-center gap-2 mt-3 ml-11">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  s < state.step ? 'bg-cyan-500 text-white' :
                  s === state.step ? 'bg-cyan-400/10 border border-cyan-400/50 text-cyan-400' :
                  'bg-white/6 border border-white/12 text-white/25'
                }`}>
                  {s < state.step ? <CheckCircle className="h-3 w-3" /> : s}
                </div>
                {s < 3 && <div className={`w-8 h-px ${s < state.step ? 'bg-cyan-500/60' : 'bg-white/10'}`} />}
              </div>
            ))}
            <span className="text-xs text-white/35 ml-1">
              {state.step === 1 ? 'Select Items' : state.step === 2 ? 'Details' : 'Results'}
            </span>
          </div>
        </div>

        {state.error && (
          <div className="mx-6 mt-4 flex items-start gap-2.5 bg-red-500/10 border border-red-400/25 rounded-xl p-3.5">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{state.error}</p>
          </div>
        )}

        <div className="px-4 sm:px-6 py-5 space-y-5">
          {state.step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/45 font-medium uppercase tracking-wide">
                  {state.selectedItemIds.size} of {wishlistItems.length} selected
                </p>
                <button
                  onClick={() => dispatch(allSelected
                    ? { type: 'DESELECT_ALL' }
                    : { type: 'SELECT_ALL', itemIds: wishlistItems.map(i => i.id) }
                  )}
                  className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {wishlistItems.length === 0 ? (
                <div className="text-center py-10 text-sm text-white/40">
                  No items in your wishlist yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {wishlistItems.map((item) => {
                    const selected = state.selectedItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => dispatch({ type: 'TOGGLE_ITEM', itemId: item.id })}
                        className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border transition-all ${
                          selected
                            ? 'bg-cyan-400/10 border-cyan-400/35'
                            : 'bg-white/3 border-white/8 hover:border-white/15 hover:bg-white/5'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border transition-all ${
                          selected ? 'bg-cyan-500 border-cyan-500' : 'border-white/25 bg-white/5'
                        }`}>
                          {selected && <CheckCircle className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium leading-snug transition-colors ${selected ? 'text-white' : 'text-white/70'}`}>
                            {item.description}
                          </p>
                          <span className={`inline-flex items-center gap-1 mt-1.5 text-xs px-2 py-0.5 rounded-md border ${getCategoryColor(item.category)}`}>
                            {getCategoryIcon(item.category)}
                            <span className="capitalize">{item.category}</span>
                          </span>
                        </div>
                        {selected && (
                          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0 mt-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {state.step === 2 && !state.isGenerating && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="zipCode" className="text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Zip Code
                </label>
                <Input
                  id="zipCode"
                  placeholder="Enter 5-digit zip code"
                  value={state.zipCode}
                  onChange={(e) => dispatch({ type: 'SET_ZIP_CODE', zipCode: e.target.value })}
                  maxLength={5}
                />
                <p className="text-xs text-white/30">Used to estimate regional labor rates</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="quoteName" className="text-xs font-semibold text-white/50 uppercase tracking-wide">
                  Quote Name
                  <span className="text-white/25 ml-1 font-normal normal-case tracking-normal">optional</span>
                </label>
                <Input
                  id="quoteName"
                  placeholder="e.g., Summer Maintenance Package"
                  value={state.quoteName}
                  onChange={(e) => dispatch({ type: 'SET_QUOTE_NAME', name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="notes" className="text-xs font-semibold text-white/50 uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Additional Notes
                  <span className="text-white/25 font-normal normal-case tracking-normal">optional</span>
                </label>
                <Textarea
                  id="notes"
                  placeholder="Add specific concerns, timeline preferences, or additional context for shops..."
                  value={state.additionalNotes}
                  onChange={(e) => dispatch({ type: 'SET_ADDITIONAL_NOTES', notes: e.target.value })}
                  rows={5}
                  className="resize-none"
                />
              </div>
            </div>
          )}

          {state.step === 2 && state.isGenerating && (
            <QuoteGenerationProgress
              items={wishlistItems.filter(item => state.selectedItemIds.has(item.id))}
              zipCode={state.zipCode}
            />
          )}

          {state.step === 3 && state.result && (
            <div className="space-y-5">
              <div className="flex items-center gap-2.5 bg-green-500/8 border border-green-400/20 rounded-xl p-3.5">
                <CheckCircle className="h-4.5 w-4.5 text-green-400 flex-shrink-0" />
                <p className="text-sm font-medium text-green-300">Quote generated and saved successfully</p>
              </div>

              <CostBreakdownTable costBreakdown={state.result.costBreakdown} />

              <EmailDraftDisplay emailDraft={state.result.emailDraft} />

              <p className="text-xs text-white/30 text-center leading-relaxed">
                Use the cost breakdown to compare shop quotes and the email draft to request quotes from multiple shops.
              </p>
            </div>
          )}
        </div>

        {!state.isGenerating && (
          <div className="px-4 sm:px-6 pb-6 pt-2 border-t border-white/6 flex items-center justify-between gap-3">
            <div>
              {state.step > 1 && state.step < 3 && (
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1.5 text-sm text-white/45 hover:text-white/75 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {state.step < 3 && (
                <Button
                  onClick={handleNext}
                  disabled={state.step === 1 && state.selectedItemIds.size === 0}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white h-10 px-5 rounded-xl font-semibold text-sm gap-2 disabled:opacity-40"
                >
                  {state.step === 2 ? 'Generate Quote' : 'Next'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}

              {state.step === 3 && (
                <Button
                  onClick={handleClose}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white h-10 px-5 rounded-xl font-semibold text-sm gap-2"
                >
                  <CheckCircle className="h-4 w-4" />
                  Done
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
