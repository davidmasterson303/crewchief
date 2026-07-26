'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Receipt, Image, FileIcon, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ConsultantDocument, InvoiceLineItem } from '@/lib/types';
import { getClientSupabase } from '@/lib/supabase';

interface DocumentLibraryProps {
  vehicleId: string;
}

export default function DocumentLibrary({ vehicleId }: DocumentLibraryProps) {
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', vehicleId],
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const supabase = getClientSupabase();
      const [docsResult, itemsResult] = await Promise.all([
        supabase
          .from('vehicle_documents')
          .select('*')
          .eq('vehicle_id', vehicleId),
        supabase
          .from('invoice_line_items')
          .select('*')
          .eq('vehicle_id', vehicleId)
      ]);

      if (docsResult.error) throw docsResult.error;
      if (itemsResult.error) throw itemsResult.error;

      return {
        documents: (docsResult.data || []) as ConsultantDocument[],
        lineItems: (itemsResult.data || []) as InvoiceLineItem[]
      };
    }
  });

  const documents = data?.documents || [];
  const lineItems = data?.lineItems || [];

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case 'invoice':
        return <Receipt className="h-5 w-5 text-cyan-600" />;
      case 'photo':
        return <Image className="h-5 w-5 text-green-600" />;
      case 'manual':
        return <FileText className="h-5 w-5 text-purple-600" />;
      default:
        return <FileIcon className="h-5 w-5 text-slate-600" />;
    }
  };

  const getDocumentLineItems = (docId: string): InvoiceLineItem[] => {
    return lineItems
      .filter((item) => item.invoice_id === docId)
      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Document Library</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Library</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <FileText className="h-16 w-16 mx-auto mb-4 text-slate-300" />
            <p>No documents uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => {
              const docLineItems = getDocumentLineItems(doc.id);
              const isExpanded = expandedDocId === doc.id;

              return (
                <div key={doc.id} className="border border-info-border rounded-lg overflow-hidden hover:shadow-md transition-shadow bg-white/5">
                  <button
                    onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                    className="w-full p-4 text-left hover:bg-white/10 transition-colors flex items-start gap-3"
                  >
                    <div className="mt-1">{getDocumentIcon(doc.file_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="capitalize bg-info-wash border-info-border text-cyan-300">
                          {doc.file_type}
                        </Badge>
                        {docLineItems.length > 0 && (
                          <Badge variant="secondary" className="text-xs bg-info-wash border-info-border text-cyan-300">
                            {docLineItems.length} items
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-white/60 mb-1">
                        Uploaded: {new Date(doc.uploaded_at || '').toLocaleDateString()}
                      </p>
                      <p className="text-xs text-white/50 mt-1">{doc.file_name}</p>
                    </div>
                    {docLineItems.length > 0 && (
                      <div className="ml-2 text-white/50">
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5" />
                        ) : (
                          <ChevronRight className="h-5 w-5" />
                        )}
                      </div>
                    )}
                  </button>

                  {isExpanded && docLineItems.length > 0 && (
                    <div className="border-t border-info-border bg-white/5 p-4 space-y-2">
                      <h4 className="font-semibold text-sm text-white mb-3">Line Items</h4>
                      <div className="space-y-2">
                        {docLineItems.map((item) => (
                          <div key={item.id} className="bg-white/5 rounded p-3 border border-info-border">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-sm font-medium text-white">{item.description}</p>
                              <Badge variant="outline" className="text-xs capitalize flex-shrink-0 bg-info-wash border-info-border text-cyan-300">
                                {item.type}
                              </Badge>
                            </div>
                            <div className="flex items-center justify-between text-xs text-white/60">
                              <span>
                                {item.quantity > 0 && `${item.quantity} × $${item.unit_price.toFixed(2)}`}
                              </span>
                              <span className="font-semibold text-white">
                                ${item.total_price.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}