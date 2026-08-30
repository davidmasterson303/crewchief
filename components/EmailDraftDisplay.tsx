'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { logger } from '@wellkept/core/logger';

interface EmailDraftDisplayProps {
  emailDraft: string;
}

export function EmailDraftDisplay({ emailDraft }: EmailDraftDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(emailDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      logger.error('EMAIL_DRAFT:COPY', error as Error);
    }
  };

  const wordCount = emailDraft.trim().split(/\s+/).length;

  return (
    <div className="bg-[#0d1117] border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-white/3 border-b border-white/8">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-amber-400/60" />
            <div className="w-3 h-3 rounded-full bg-green-400/60" />
          </div>
          <span className="text-xs text-white/50 font-mono ml-1">quote-request-email.txt</span>
        </div>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            copied
              ? 'bg-green-500/20 text-green-300 border border-green-400/30'
              : 'bg-white/6 text-white/55 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="relative overflow-x-auto">
        <pre className="text-sm text-white/80 font-mono leading-relaxed p-5 whitespace-pre-wrap break-words min-h-[200px] max-h-[400px] overflow-y-auto">
          {emailDraft}
        </pre>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/6 bg-white/2">
        <div className="flex items-center gap-4 text-xs text-white/50 font-mono">
          <span>{wordCount} words</span>
          <span>{emailDraft.length} chars</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/50">
          <span>Ready to send to shops</span>
        </div>
      </div>
    </div>
  );
}
