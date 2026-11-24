import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Download, ExternalLink, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    // Not a URL — assume it's already a path
    const segments = url.split('/');
    return decodeURIComponent(segments[segments.length - 1] || 'attachment');
  }
}

function getExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
}

/**
 * Extract the storage object path from either a stored public URL
 * (legacy: .../object/public/support-attachments/<path>) or a signed URL
 * (.../object/sign/support-attachments/<path>?token=...) or a raw path.
 */
function extractStoragePath(input: string): string | null {
  if (!input) return null;
  const marker = `/${BUCKET}/`;
  const idx = input.indexOf(marker);
  if (idx >= 0) {
    const tail = input.substring(idx + marker.length);
    // Strip any query string (token, etc.)
    return tail.split('?')[0];
  }
  // Treat as raw path if it looks like one
  if (!input.startsWith('http')) return input.replace(/^\/+/, '');
  return null;
}

export function AttachmentRenderer({ url }: AttachmentRendererProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const path = extractStoragePath(url);
    if (!path) {
      setError(true);
      return;
    }
    (async () => {
      const { data, error: err } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_TTL);
      if (cancelled) return;
      if (err || !data?.signedUrl) {
        setError(true);
      } else {
        setSignedUrl(data.signedUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const filename = getFilename(url);
  const ext = getExtension(filename);
  const linkUrl = signedUrl || '#';

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/[0.05] border border-destructive/15 text-[11px] text-destructive">
        <File className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Attachment unavailable</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 border border-border/30 text-[11px] text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>Loading attachment…</span>
      </div>
    );
  }

  if (isImage(url)) {
    return (
      <div className="space-y-2">
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="block group">
          <img
            src={signedUrl}
            alt={filename}
            className="rounded-xl max-h-56 max-w-full object-cover border border-border/40 group-hover:shadow-md transition-all duration-200"
          />
        </a>
        <div className="flex items-center gap-2 text-[10px]">
          <ImageIcon className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          <span className="text-muted-foreground/70 truncate">{filename}</span>
          <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5 font-medium">
            <ExternalLink className="w-3 h-3" /> View
          </a>
          <a href={linkUrl} download={filename} className="shrink-0 text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5 font-medium">
            <Download className="w-3 h-3" /> Save
          </a>
        </div>
      </div>
    );
  }

  if (isPdf(url)) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-destructive/[0.04] border border-destructive/10">
        <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
          <FileText className="w-4.5 h-4.5 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{filename}</p>
          <p className="text-[10px] text-muted-foreground/60">{ext} Document</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-primary hover:text-primary" asChild>
            <a href={linkUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3 h-3" /> View
            </a>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] gap-1 text-primary hover:text-primary" asChild>
            <a href={linkUrl} download={filename}>
              <Download className="w-3 h-3" /> Save
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-muted/60 border border-border/30">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
        <File className="w-4.5 h-4.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{filename}</p>
        <p className="text-[10px] text-muted-foreground/60">{ext} File</p>
      </div>
      <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[10px] gap-1 text-primary hover:text-primary shrink-0" asChild>
        <a href={linkUrl} download={filename}>
          <Download className="w-3 h-3" /> Download
        </a>
      </Button>
    </div>
  );
}
