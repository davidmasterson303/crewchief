'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  Search, Calendar, DollarSign, Upload, Trash2, Wrench, Droplets, Cog,
  Zap, TriangleAlert, ShieldCheck, Gauge, Wind, Disc, FileText,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { logger } from '@crewchief/core/logger';
import MaintenanceItemDetailsDialog from './MaintenanceItemDetailsDialog';
import DocumentUploadDialog from './DocumentUploadDialog';
import type {
  ConsultantDocument,
  InvoiceLineItem,
  ServiceItem,
  MaintenanceLineItem as MaintenanceLineItemType,
  MaintenanceRecord,
  MaintenanceItemToDelete,
  DeleteMaintenanceItemResult,
  MaintenanceItemDetails
} from '@crewchief/core/types';

interface MaintenanceHistoryProps {
  vehicleId: string;
  documents: ConsultantDocument[];
  lineItems?: InvoiceLineItem[];
  completedServiceItems?: ServiceItem[];
  maintenanceLineItems?: MaintenanceLineItemType[];
  onUploadComplete?: () => void;
  onItemDeleted?: () => void;
}

function getCategoryIcon(desc: string, category?: string) {
  const d = (desc || '').toLowerCase();
  const c = (category || '').toLowerCase();
  if (d.includes('oil') || c.includes('oil')) return { Icon: Droplets, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/20' };
  if (d.includes('transmission') || d.includes('trans') || c.includes('transmission')) return { Icon: Cog, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/20' };
  if (d.includes('brake') || d.includes('rotor') || d.includes('pad') || c.includes('brake')) return { Icon: Disc, color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20' };
  if (d.includes('tire') || d.includes('wheel') || d.includes('alignment') || c.includes('tire')) return { Icon: Gauge, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20' };
  if (d.includes('battery') || d.includes('spark') || d.includes('ignition') || d.includes('alternator') || c.includes('electrical')) return { Icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20' };
  if (d.includes('air') || d.includes('filter') || d.includes('intake') || c.includes('filter')) return { Icon: Wind, color: 'text-info', bg: 'bg-info-wash border-info-border' };
  if (d.includes('inspect') || d.includes('diagnos') || d.includes('check') || c.includes('inspect')) return { Icon: ShieldCheck, color: 'text-teal-400', bg: 'bg-teal-400/10 border-teal-400/20' };
  if (d.includes('warn') || d.includes('recall') || c.includes('recall')) return { Icon: TriangleAlert, color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20' };
  return { Icon: Wrench, color: 'text-info', bg: 'bg-info-wash border-info-border' };
}

export default function MaintenanceHistory({ vehicleId, documents, lineItems = [], completedServiceItems = [], maintenanceLineItems = [], onUploadComplete, onItemDeleted }: MaintenanceHistoryProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MaintenanceItemDetails | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<MaintenanceItemToDelete | null>(null);
  const [deleteAllFromInvoice, setDeleteAllFromInvoice] = useState(false);
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());

  const deleteMaintenanceLineItem = async (
    itemId: string,
    itemType: 'invoice_line_item' | 'service_item' | 'maintenance_line_item' | 'document'
  ): Promise<DeleteMaintenanceItemResult> => {
    try {
      const response = await fetch('/api/v1/delete-maintenance-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, itemType }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        logger.warn('CLIENT:DELETE_ERROR', 'Delete API error', { itemType, itemId, error: data.error });
        return { success: false, error: data.error || 'Failed to delete item' };
      }
      return { success: true };
    } catch (error) {
      logger.error('CLIENT:DELETE_EXCEPTION', error as Error, { itemType, itemId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  };

  const allRecords = useMemo(() => {
    const records: MaintenanceRecord[] = [];
    maintenanceLineItems.forEach(item => {
      if (!deletedItemIds.has(item.id)) {
        records.push({
          ...item,
          _type: 'maintenance_line_item' as const,
          display_description: item.item_description,
          display_date: item.service_date,
          display_cost: item.total_cost || 0,
          display_shop: item.shop_name || null,
        });
      }
    });
    completedServiceItems.forEach(item => {
      if (!deletedItemIds.has(item.id)) {
        records.push({
          ...item,
          _type: 'service_item' as const,
          display_description: item.description,
          display_date: item.date_completed || null,
          display_cost: (item.cost_parts || 0) + (item.cost_labor || 0),
          display_shop: item.shop_name || null,
        });
      }
    });
    return records;
  }, [maintenanceLineItems, completedServiceItems, deletedItemIds]);

  const filteredRecords = useMemo(() => {
    return allRecords.filter((record) => {
      const matchesType = !filterType ||
        (filterType === 'combined' && record.is_combined) ||
        (filterType === 'labor' && record.original_category === 'labor') ||
        (filterType === 'parts' && record.original_category === 'parts') ||
        (filterType === 'service' && record._type === 'service_item');
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        record.display_description?.toLowerCase().includes(searchLower) ||
        record.display_shop?.toLowerCase().includes(searchLower) ||
        record.part_number?.toLowerCase().includes(searchLower) ||
        record.category?.toLowerCase().includes(searchLower);
      return matchesType && matchesSearch;
    });
  }, [searchQuery, filterType, allRecords]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      const dateA = new Date(a.display_date || a.created_at || 0).getTime();
      const dateB = new Date(b.display_date || b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [filteredRecords]);

  const totalCost = useMemo(() => filteredRecords.reduce((sum, r) => sum + (r.display_cost || 0), 0), [filteredRecords]);

  const availableFilters = useMemo(() => {
    const filters = new Set<string>();
    if (maintenanceLineItems.some(item => item.is_combined)) filters.add('combined');
    if (maintenanceLineItems.some(item => item.original_category === 'labor')) filters.add('labor');
    if (maintenanceLineItems.some(item => item.original_category === 'parts')) filters.add('parts');
    if (completedServiceItems.length > 0) filters.add('service');
    return Array.from(filters);
  }, [maintenanceLineItems, completedServiceItems]);

  const handleItemClick = (record: MaintenanceRecord) => {
    const detailsItem: MaintenanceItemDetails = {
      id: record.id,
      description: record.display_description || '',
      date_completed: record.display_date || '',
      shop_name: record.display_shop || undefined,
      cost_labor: record.labor_cost || record.cost_labor,
      cost_parts: record.parts_cost || record.cost_parts,
      total_cost: record.total_cost,
      part_number: record.part_number,
      quantity: record.quantity,
      unit_cost: record.unit_cost,
      is_combined: record.is_combined,
      category: record.category,
      notes: record.notes,
      invoice_url: record.invoice_url,
    };
    setSelectedItem(detailsItem);
    setDetailsDialogOpen(true);
  };

  const handleDeleteClick = (record: MaintenanceRecord) => {
    setItemToDelete({ id: record.id, sourceDocId: record.source_document_id, description: record.display_description });
    setDeleteAllFromInvoice(false);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    setLoading(true);
    const idsToDelete = new Set<string>();
    try {
      if (deleteAllFromInvoice && itemToDelete.sourceDocId) {
        const itemsToDelete = maintenanceLineItems.filter(item => item.source_document_id === itemToDelete.sourceDocId);
        itemsToDelete.forEach(item => idsToDelete.add(item.id));
        idsToDelete.add(itemToDelete.sourceDocId);
        for (const item of itemsToDelete) {
          const r = await deleteMaintenanceLineItem(item.id, 'maintenance_line_item');
          if (!r.success) idsToDelete.delete(item.id);
        }
        const result = await deleteMaintenanceLineItem(itemToDelete.sourceDocId, 'document');
        if (result.success) {
          toast.success(`Deleted ${itemsToDelete.length} items from invoice`);
        } else {
          toast.error(result.error || 'Failed to delete invoice');
          idsToDelete.delete(itemToDelete.sourceDocId);
        }
      } else {
        idsToDelete.add(itemToDelete.id);
        const result = await deleteMaintenanceLineItem(itemToDelete.id, 'maintenance_line_item');
        if (result.success) {
          toast.success('Item deleted');
        } else {
          toast.error(result.error || 'Failed to delete item');
          idsToDelete.delete(itemToDelete.id);
        }
      }
      setDeletedItemIds(prev => { const s = new Set(prev); idsToDelete.forEach(id => s.add(id)); return s; });
      onItemDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      setDeleteAllFromInvoice(false);
    }
  };

  const getCategoryBadge = (record: MaintenanceRecord) => {
    if (record.is_combined) return <Badge variant="outline" className="bg-blue-400/10 text-blue-300 border-blue-400/25 text-xs font-medium">Combined</Badge>;
    if (record.original_category === 'labor') return <Badge variant="outline" className="bg-info-wash text-info border-info-border text-xs font-medium">Labor</Badge>;
    if (record.original_category === 'parts') return <Badge variant="outline" className="bg-green-400/10 text-green-300 border-green-400/25 text-xs font-medium">Parts</Badge>;
    if (record._type === 'service_item') return <Badge variant="outline" className="bg-amber-400/10 text-amber-300 border-amber-400/25 text-xs font-medium">Service</Badge>;
    if (record.category) return <Badge variant="outline" className="bg-white/6 text-white/50 border-white/12 text-xs font-medium capitalize">{record.category}</Badge>;
    return null;
  };

  return (
    <Card className="bg-[#0d1117] border-white/8 overflow-hidden">
      <CardHeader className="border-b border-white/8 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Wrench className="h-5 w-5 text-info" />
              Maintenance History
            </CardTitle>
            <p className="text-sm text-white/40 mt-0.5">
              {sortedRecords.length} record{sortedRecords.length !== 1 ? 's' : ''}
              {totalCost > 0 && <span className="ml-2 text-white/60 font-medium">&middot; ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</span>}
            </p>
          </div>
          <Button
            onClick={() => setUploadDialogOpen(true)}
            className="bg-cyan-600 hover:bg-cyan-500 text-white border-0 h-9 px-4 text-sm gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload Invoice
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/*
            `.field-group` owns the icon's position, colour and the field's
            padding compensation (v7 C3). This carried its own absolute
            positioning plus `pl-9` welded to a full colour theme — the padding
            was real, the theme was working around a broken primitive. The glyph
            also now lifts on `:focus-within` instead of sitting at a fixed
            `text-white/30`.
          */}
          <div className="flex-1 field-group">
            <Search className="h-4 w-4" />
            <Input
              fieldSize="sm"
              placeholder="Search description, shop, part number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {availableFilters.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterType(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all h-9 ${filterType === null ? 'bg-white/8 text-white border border-cyan-400/40' : 'bg-white/4 text-white/50 border border-white/10 hover:border-white/20 hover:text-white/70'}`}
              >
                All
              </button>
              {availableFilters.map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(filterType === type ? null : type)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all h-9 capitalize ${filterType === type ? 'bg-white/8 text-white border border-cyan-400/40' : 'bg-white/4 text-white/50 border border-white/10 hover:border-white/20 hover:text-white/70'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {allRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 sm:px-6 text-center">
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                <FileText className="h-8 w-8 text-white/20" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-info-wash border border-info-border flex items-center justify-center">
                <Upload className="h-3 w-3 text-info" />
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white/70 mb-1">No maintenance records yet</h3>
            <p className="text-xs text-white/35 mb-5 max-w-xs leading-relaxed">
              Upload service invoices to automatically track your vehicle&apos;s maintenance history and build a service timeline.
            </p>
            <Button
              onClick={() => setUploadDialogOpen(true)}
              size="sm"
              className="bg-cyan-600 hover:bg-cyan-500 text-white h-9 px-4 gap-2 text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Your First Invoice
            </Button>
          </div>
        ) : sortedRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-10 w-10 text-white/15 mb-3" />
            <p className="text-sm text-white/50">No records match your search</p>
            <button onClick={() => { setSearchQuery(''); setFilterType(null); }} className="text-xs text-cyan-400/70 hover:text-cyan-400 mt-2 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {sortedRecords.map((record, idx) => {
              const { Icon, color, bg } = getCategoryIcon(record.display_description || '', record.category);
              return (
                <div
                  key={record.id}
                  className={`group flex items-center hover:bg-white/[0.055] transition-colors cursor-pointer ${idx % 2 === 0 ? '' : 'bg-white/[0.018]'}`}
                >
                  <button
                    onClick={() => handleItemClick(record)}
                    className="flex-1 flex items-center gap-3 px-5 py-3.5 text-left min-w-0"
                    aria-label={`View details for ${record.display_description}`}
                  >
                    <div className={`w-8 h-8 rounded-lg ${bg} border flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-medium text-white truncate max-w-xs">{record.display_description}</span>
                        {getCategoryBadge(record)}
                        {record.part_number && (
                          <span className="text-xs text-white/30 font-mono hidden sm:inline">{record.part_number}</span>
                        )}
                      </div>
                      {record.display_shop && (
                        <p className="text-xs text-white/40 truncate">{record.display_shop}</p>
                      )}
                    </div>

                    <div className="flex-shrink-0 flex items-center gap-6 ml-2">
                      {record.display_date && (
                        <div className="hidden sm:flex items-center gap-1.5 text-right">
                          <Calendar className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
                          <span className="text-xs text-white/45 tabular-nums whitespace-nowrap">
                            {new Date(record.display_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {record.display_cost > 0 && (
                        <div className="text-right min-w-[64px]">
                          <span className="text-sm font-semibold text-white tabular-nums">
                            ${record.display_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                      <ChevronRight className="h-4 w-4 text-white/15 group-hover:text-white/40 transition-colors flex-shrink-0" />
                    </div>
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(record); }}
                    disabled={loading}
                    className="tap-target-44 flex-shrink-0 w-9 h-9 mx-2 flex items-center justify-center rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors reveal-on-hover disabled:opacity-30"
                    aria-label="Delete record"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {selectedItem && (
        <MaintenanceItemDetailsDialog
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          item={selectedItem}
          invoiceUrl={selectedItem.invoice_url}
        />
      )}

      <DocumentUploadDialog
        vehicleId={vehicleId}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUploadComplete={onUploadComplete}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-[#0f1318] border-white/10 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete Maintenance Record</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="text-white/60 text-sm">You are about to delete: <span className="text-white font-medium">&quot;{itemToDelete?.description}&quot;</span></div>
                {itemToDelete?.sourceDocId && (
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3 space-y-2">
                    <div className="text-xs font-semibold text-amber-300">This item is from an uploaded invoice</div>
                    {/*
                      These carried no shared `name`, so the browser treated
                      them as two unrelated radios rather than one group: arrow
                      keys did not move between them and assistive tech read
                      them as separate controls. They only appeared to work
                      because `checked` is driven from state.

                      `accent-color` themes the native control from the design
                      token, which is the correct mechanism for radios — the
                      shared Input component is for text fields and does not
                      apply here.
                    */}
                    <div
                      className="space-y-2"
                      role="radiogroup"
                      aria-label="How much to delete"
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer tap-target-44">
                        <input
                          type="radio"
                          name="delete-scope"
                          checked={!deleteAllFromInvoice}
                          onChange={() => setDeleteAllFromInvoice(false)}
                          style={{ accentColor: 'hsl(var(--accent))' }}
                        />
                        <span className="text-sm text-white/80">Delete only this item</span>
                      </label>
                      <label className="flex items-center gap-2.5 cursor-pointer tap-target-44">
                        <input
                          type="radio"
                          name="delete-scope"
                          checked={deleteAllFromInvoice}
                          onChange={() => setDeleteAllFromInvoice(true)}
                          style={{ accentColor: 'hsl(var(--accent))' }}
                        />
                        <span className="text-sm text-white/80">Delete all items from this invoice</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading} className="bg-white/6 border-white/12 text-white/70 hover:bg-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} disabled={loading} className="bg-red-600 hover:bg-red-500 text-white">
              {loading ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
