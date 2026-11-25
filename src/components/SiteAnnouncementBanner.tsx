import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AnnouncementData {
  enabled: boolean;
  title: string;
  message: string;
  type: "warning" | "destructive" | "info";
}

export function SiteAnnouncementBanner() {
  const location = useLocation();
  const [data, setData] = useState<AnnouncementData>({
    enabled: false,
    title: "",
    message: "",
    type: "warning",
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    fetchAnnouncement();
  }, [location.pathname]);

  const fetchAnnouncement = async () => {
    try {
      const { data: rows, error } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", [
          "announcement_enabled",
          "announcement_title",
          "announcement_message",
          "announcement_type",
        ]);

      if (error || !rows) return;

      const map: Record<string, string> = {};
      rows.forEach((r: { key: string; value: string }) => {
        map[r.key] = r.value;
      });

      setData({
        enabled: map.announcement_enabled === "true",
        title: map.announcement_title || "Notice",
        message: map.announcement_message || "",
        type: (map.announcement_type as any) || "warning",
      });
    } catch {
      // fail silent
    }
  };

  if (!data.enabled || !data.message.trim() || location.pathname.startsWith("/admin")) {
    return null;
  }

  const themeStyles = {
    warning: {
      bar: "bg-amber-400 dark:bg-amber-500 text-slate-950 border-amber-600/30",
      badge: "bg-slate-950 text-amber-300 border-amber-400/40",
      dot: "bg-amber-300",
      tapBadge: "bg-slate-950/15 text-slate-950 border-slate-950/20",
      dialogBorder: "border-amber-500/30",
    },
    destructive: {
      bar: "bg-rose-600 text-white border-rose-700/40",
      badge: "bg-black/50 text-white border-white/30",
      dot: "bg-rose-300",
      tapBadge: "bg-black/20 text-white border-white/20",
      dialogBorder: "border-rose-500/30",
    },
    info: {
      bar: "bg-blue-600 text-white border-blue-700/40",
      badge: "bg-black/40 text-white border-white/30",
      dot: "bg-blue-200",
      tapBadge: "bg-black/20 text-white border-white/20",
      dialogBorder: "border-blue-500/30",
    },
  }[data.type] || {
    bar: "bg-amber-400 dark:bg-amber-500 text-slate-950 border-amber-600/30",
    badge: "bg-slate-950 text-amber-300 border-amber-400/40",
    dot: "bg-amber-300",
    tapBadge: "bg-slate-950/15 text-slate-950 border-slate-950/20",
    dialogBorder: "border-amber-500/30",
  };

  return (
    <>
      <aside
        role="region"
        aria-label="Site announcement"
        onClick={() => setIsDialogOpen(true)}
        className={`w-full h-11 sm:h-12 px-3 sm:px-5 flex items-center justify-between overflow-hidden cursor-pointer select-none border-b shadow-sm sticky top-0 z-50 transition-colors antialiased ${themeStyles.bar}`}
        title="Tap to read full announcement"
      >
        {/* Left pinned pill badge */}
        <div className="flex items-center gap-2 shrink-0 z-10 pr-3 mr-2 sm:mr-3 border-r border-black/15">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${themeStyles.dot}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${themeStyles.dot}`}></span>
          </span>
          <span className={`px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-black tracking-wider uppercase border shadow-xs ${themeStyles.badge}`}>
            {data.title || "NOTICE"}
          </span>
        </div>

        {/* Marquee scrolling track with clear typography */}
        <div className="flex-1 overflow-hidden relative h-full flex items-center">
          <div className="animate-ticker-marquee text-[13px] sm:text-sm font-bold tracking-normal leading-normal">
            <span className="inline-block px-6">{data.message}</span>
            <span className="inline-block px-6 opacity-40 font-normal">◆</span>
            <span className="inline-block px-6">{data.message}</span>
          </div>
        </div>

        {/* Right indicator */}
        <div className={`shrink-0 z-10 ml-2 hidden sm:flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${themeStyles.tapBadge}`}>
          <Eye className="w-3 h-3" />
          <span>Tap to read</span>
        </div>
      </aside>

      {/* Tap-to-read Modal Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={`max-w-md border ${themeStyles.dialogBorder} p-6`}>
          <DialogHeader className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wider ${themeStyles.badge}`}>
                {data.title || "ANNOUNCEMENT"}
              </span>
            </div>
            <DialogTitle className="text-xl font-bold text-foreground">
              {data.title}
            </DialogTitle>
            <DialogDescription className="text-sm sm:text-base leading-relaxed text-foreground/90 whitespace-pre-wrap pt-2">
              {data.message}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
