import React, { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Download, ExternalLink, File, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface AttachmentRendererProps {
  url: string;
  compact?: boolean;
}

const BUCKET = 'support-attachments';
const SIGNED_TTL = 60 * 60; // 1 hour

const isImage = (url: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

function getFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/');
    return decodeURIComponent(segments[segments.length - 1] || 'attachment');
  } catch {
    const segments = url.split('/');
    return decodeURIComponent(segments[segments.length - 1] || 'attachment');
  }
}

function getExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
}

function extractStoragePath(input: string): string | null {
  if (!input) return null;
  const markers = ['/support-attachments/', '/attachments/'];
  for (const marker of markers) {
    const idx = input.indexOf(marker);
    if (idx >= 0) {
      const tail = input.substring(idx + marker.length);
      return tail.split('?')[0];
    }
  }
  if (!input.startsWith('http')) return input.replace(/^\/+/, '');
  return null;
}

export function AttachmentRenderer({ url }: AttachmentRendererProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const filePath = extractStoragePath(url);
    if (!filePath) {
      setError(true);
      return;
    }
    (async () => {
      try {
        const { data, error: err } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(filePath, SIGNED_TTL);
        if (cancelled) return;
        if (err || !data?.signedUrl) {
          setError(true);
        } else {
          setSignedUrl(data.signedUrl);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const filename = getFilename(url);
  const ext = getExtension(filename);
  const linkUrl = signedUrl || '#';

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!signedUrl || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(signedUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(signedUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400 my-1">
        <File className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Attachment unavailable</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-[11px] opacity-75 my-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>Loading attachment…</span>
      </div>
    );
  }

  if (isImage(url)) {
    return (
      <div className="space-y-1.5 my-1 max-w-[280px] sm:max-w-[340px]">
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Click to view full image"
          className="block group overflow-hidden rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 cursor-pointer shadow-xs"
        >
          <img
            src={signedUrl}
            alt={filename}
            className="rounded-xl max-h-60 w-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        </a>
        <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] opacity-90">
          <span className="truncate max-w-[140px] font-medium" title={filename}>
            {filename}
          </span>
          <div className="flex items-center gap-2.5 shrink-0 font-semibold">
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" /> View
            </a>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1 hover:underline cursor-pointer disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isPdf(url)) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white text-slate-800 border border-slate-200 shadow-xs my-1 max-w-[320px]">
        <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-semibold text-slate-900 truncate" title={filename}>
            {filename}
          </p>
          <p className="text-[10px] text-slate-500 font-medium">{ext} Document</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 font-medium">
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-1.5 py-1 rounded"
          >
            View
          </a>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-1.5 py-1 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-0.5"
          >
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white text-slate-800 border border-slate-200 shadow-xs my-1 max-w-[320px]">
      <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
        <File className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-xs font-semibold text-slate-900 truncate" title={filename}>
          {filename}
        </p>
        <p className="text-[10px] text-slate-500 font-medium">{ext} File</p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
      >
        {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        Download
      </button>
    </div>
  );
}
