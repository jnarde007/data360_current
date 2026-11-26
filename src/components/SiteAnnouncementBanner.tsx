import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle, Eye, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AnnouncementData {
  enabled: boolean;
  title: string;
  message: string;
  type: "warning" | "destructive" | "info";
}

export function SiteAnnouncementBanner() {
  const location = useLocation();
  const isChatPage = location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support');
  if (isChatPage) return null;
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

  const cleanTitle = data.title.replace(/:+$/, "").trim();

  const themeStyles = {
    warning: {
      bar: "bg-amber-400 dark:bg-amber-500 text-slate-950 border-amber-600/30",
      badge: "bg-slate-950 text-amber-300 border-amber-400/40",
      dot: "bg-amber-300",
      tapBadge: "bg-slate-950/15 text-slate-950 border-slate-950/20",
      modalHeaderBg: "bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-500 text-slate-950",
      modalIconBg: "bg-slate-950/15 text-slate-950",
      modalIcon: <AlertTriangle className="w-6 h-6 text-slate-950" />,
      modalMessageBg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-slate-900 dark:text-amber-100",
      modalBtn: "!bg-none !bg-amber-500 hover:!bg-amber-500/90 text-slate-950 font-bold",
      modalBorder: "border-amber-500/40",
    },
    destructive: {
      bar: "bg-rose-600 text-white border-rose-700/40",
      badge: "bg-black/50 text-white border-white/30",
      dot: "bg-rose-300",
      tapBadge: "bg-black/20 text-white border-white/20",
      modalHeaderBg: "bg-gradient-to-br from-rose-500 via-red-600 to-rose-700 text-white",
      modalIconBg: "bg-white/20 text-white",
      modalIcon: <AlertCircle className="w-6 h-6 text-white" />,
      modalMessageBg: "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20 text-slate-900 dark:text-rose-100",
      modalBtn: "!bg-none !bg-rose-600 hover:!bg-rose-600/90 text-white font-bold",
      modalBorder: "border-rose-500/40",
    },
    info: {
      bar: "bg-blue-600 text-white border-blue-700/40",
      badge: "bg-black/40 text-white border-white/30",
      dot: "bg-blue-200",
      tapBadge: "bg-black/20 text-white border-white/20",
      modalHeaderBg: "bg-gradient-to-br from-blue-600 via-indigo-600 to-blue-700 text-white",
      modalIconBg: "bg-white/20 text-white",
      modalIcon: <Info className="w-6 h-6 text-white" />,
      modalMessageBg: "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-slate-900 dark:text-blue-100",
      modalBtn: "!bg-none !bg-blue-600 hover:!bg-blue-600/90 text-white font-bold",
      modalBorder: "border-blue-500/40",
    },
  }[data.type] || {
    bar: "bg-amber-400 dark:bg-amber-500 text-slate-950 border-amber-600/30",
    badge: "bg-slate-950 text-amber-300 border-amber-400/40",
    dot: "bg-amber-300",
    tapBadge: "bg-slate-950/15 text-slate-950 border-slate-950/20",
    modalHeaderBg: "bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-500 text-slate-950",
    modalIconBg: "bg-slate-950/15 text-slate-950",
    modalIcon: <AlertTriangle className="w-6 h-6 text-slate-950" />,
    modalMessageBg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-slate-900 dark:text-amber-100",
    modalBtn: "!bg-none !bg-amber-500 hover:!bg-amber-500/90 text-slate-950 font-bold",
    modalBorder: "border-amber-500/40",
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
        <div className="flex items-center gap-2 shrink-0 z-10 pr-3 mr-2 sm:mr-3 border-r border-black/15">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${themeStyles.dot}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${themeStyles.dot}`}></span>
          </span>
          <span className={`px-2 py-0.5 rounded-md text-[11px] sm:text-xs font-black tracking-wider uppercase border shadow-xs ${themeStyles.badge}`}>
            {cleanTitle || "NOTICE"}
          </span>
        </div>

        <div className="flex-1 overflow-hidden relative h-full flex items-center">
          <div className="animate-ticker-marquee text-[13px] sm:text-sm font-bold tracking-normal leading-normal">
            <span className="inline-block px-6">{data.message}</span>
            <span className="inline-block px-6 opacity-40 font-normal">◆</span>
            <span className="inline-block px-6">{data.message}</span>
          </div>
        </div>

        <div className={`shrink-0 z-10 ml-2 hidden sm:flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${themeStyles.tapBadge}`}>
          <Eye className="w-3 h-3" />
          <span>Tap to read</span>
        </div>
      </aside>

      {/* Styled Colorful Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={`max-w-md p-0 overflow-hidden rounded-3xl border ${themeStyles.modalBorder} shadow-2xl`}>
          {/* Top Hero Gradient Banner */}
          <div className={`p-6 pb-5 flex flex-col items-center text-center relative ${themeStyles.modalHeaderBg}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-md ${themeStyles.modalIconBg}`}>
              {themeStyles.modalIcon}
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-black/15 border border-black/10 mb-1">
              {cleanTitle || "ANNOUNCEMENT"}
            </span>
            <DialogTitle className="text-xl sm:text-2xl font-black tracking-tight leading-snug">
              {cleanTitle.toUpperCase() === "ANNOUNCEMENT" || cleanTitle.toUpperCase() === "NOTICE" ? "Important Update" : cleanTitle}
            </DialogTitle>
          </div>

          {/* Body Content */}
          <div className="p-6 pt-4 space-y-5 bg-background">
            <div className={`rounded-2xl p-4 border text-sm sm:text-base leading-relaxed font-medium ${themeStyles.modalMessageBg}`}>
              <DialogDescription className="text-inherit whitespace-pre-wrap">
                {data.message}
              </DialogDescription>
            </div>

            <Button
              type="button"
              onClick={() => setIsDialogOpen(false)}
              className={`w-full h-12 rounded-xl text-sm font-bold shadow-md transition-all active:scale-[0.98] ${themeStyles.modalBtn}`}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Understood
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
