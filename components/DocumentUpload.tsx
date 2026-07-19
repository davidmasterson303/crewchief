'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Loader as Loader2, FileText, Camera, X } from 'lucide-react';
import { invalidateDashboardCache } from '@/lib/query-invalidation';

interface DocumentUploadProps {
  vehicleId: string;
}

export default function DocumentUpload({ vehicleId }: DocumentUploadProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB');
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      setError('');
      e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError('');

    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('vehicleId', vehicleId);

        const response = await fetch('/api/upload-document', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (!result.success) {
          setError(result.error || 'Upload failed');
          return;
        }
      }

      setSelectedFiles([]);
      invalidateDashboardCache(vehicleId);
      router.refresh();
    } catch (err) {
      setError('An error occurred during upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Invoices or Documents</CardTitle>
        <CardDescription>
          Upload service invoices and we&apos;ll automatically extract details including line items
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            {selectedFiles.length === 0 ? (
              <div className="space-y-3">
                <Upload className="h-12 w-12 mx-auto text-slate-400" />
                <div>
                  <Label htmlFor="file-upload" className="cursor-pointer">
                    <span className="text-cyan-600 hover:text-cyan-700 font-medium">
                      Choose files
                    </span>
                    {' or drag and drop'}
                  </Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
                <p className="text-sm text-slate-500">PNG, JPG, PDF up to 10MB each. Upload multiple files at once.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="font-medium text-slate-700">{selectedFiles.length} file(s) selected</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-cyan-50 p-3 rounded-lg">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-cyan-600 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-slate-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(idx)}
                        className="ml-2 p-1 hover:bg-red-100 rounded transition-colors"
                        disabled={uploading}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedFiles([])} disabled={uploading}>
                    Clear All
                  </Button>
                  <Button onClick={handleUpload} disabled={uploading} className="flex-1">
                    {uploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Label htmlFor="camera-upload" className="flex-1">
              <div className="border-2 rounded-lg p-4 text-center cursor-pointer hover:bg-slate-50 transition-colors">
                <Camera className="h-6 w-6 mx-auto mb-2 text-slate-600" />
                <span className="text-sm font-medium">Take Photo</span>
              </div>
              <Input
                id="camera-upload"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
              />
            </Label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 text-sm">
            <p className="font-medium text-cyan-900 mb-1">AI Invoice Processing</p>
            <p className="text-cyan-800">
              Our AI will automatically extract service details, costs, line items, and dates from your invoices.
              You can review and edit the extracted data before saving.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}