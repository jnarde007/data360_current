import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle, ChevronRight, X } from "lucide-react";
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

  // Hide on support chat routes
  const isChatPage = location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support');
  if (isChatPage) return null;

  const [data, setData] = useState<AnnouncementData>({
    enabled: false,
    title: "",
    message: "",
    type: "warning",
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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

      if (error) throw error;

      if (rows) {
        const rowMap = new Map(rows.map((r) => [r.key, r.value]));
        setData({
          enabled: rowMap.get("announcement_enabled") === "true",
          title: rowMap.get("announcement_title") || "NOTICE",
          message: rowMap.get("announcement_message") || "",
          type: (rowMap.get("announcement_type") as any) || "warning",
        });
      }
    } catch (err) {
      console.error("Failed to fetch announcement:", err);
    }
  };

  if (!data.enabled || !data.message || dismissed) {
    return null;
  }

  const getTheme = () => {
    switch (data.type) {
      case "destructive":
        return {
          banner: "bg-rose-500/15 dark:bg-rose-950/40 text-rose-950 dark:text-rose-200 border-b border-rose-500/30 backdrop-blur-xs",
          badge: "bg-rose-500 text-white font-bold",
          icon: <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 dark:text-rose-400" />,
          action: "text-rose-700 dark:text-rose-300 hover:text-rose-900",
        };
      case "info":
        return {
          banner: "bg-sky-500/15 dark:bg-sky-950/40 text-sky-950 dark:text-sky-200 border-b border-sky-500/30 backdrop-blur-xs",
          badge: "bg-sky-600 text-white font-bold",
          icon: <Info className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />,
          action: "text-sky-700 dark:text-sky-300 hover:text-sky-900",
        };
      case "warning":
      default:
        return {
          banner: "bg-amber-500/15 dark:bg-amber-950/40 text-amber-950 dark:text-amber-200 border-b border-amber-500/30 backdrop-blur-xs",
          badge: "bg-amber-500 text-amber-950 font-bold",
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />,
          action: "text-amber-800 dark:text-amber-300 hover:text-amber-950",
        };
    }
  };

  const theme = getTheme();

  return (
    <>
      <div
        className={"sticky top-0 z-50 flex items-center h-9 sm:h-10 px-3 text-xs select-none transition-all duration-200 shadow-2xs " + theme.banner}
      >
        <div className="container mx-auto flex items-center justify-between gap-3 w-full max-w-6xl">
          
          {/* MOBILE VIEW (Below sm): Starts immediately on screen, seamless loop */}
          <div 
            onClick={() => setIsDialogOpen(true)}
            className="sm:hidden flex items-center gap-2 flex-1 overflow-hidden cursor-pointer"
          >
            <div className="flex items-center gap-1 shrink-0 font-bold">
              {theme.icon}
              <span className={"text-[10px] tracking-wide px-1.5 py-0.5 rounded-full " + theme.badge}>
                {data.title || "UPDATE"}
              </span>
            </div>
            <div className="flex-1 overflow-hidden relative whitespace-nowrap">
              <div className="animate-ticker-marquee font-medium text-xs">
                <span>{data.message}</span>
                <span className="mx-6 opacity-40">•</span>
                <span>{data.message}</span>
                <span className="mx-6 opacity-40">•</span>
              </div>
            </div>
          </div>

          {/* DESKTOP / PC VIEW (sm and above): Centered, static, zero delay, immediately readable */}
          <div 
            onClick={() => setIsDialogOpen(true)}
            className="hidden sm:flex items-center justify-center gap-2.5 flex-1 cursor-pointer mx-auto py-1"
          >
            <div className="flex items-center gap-1.5 shrink-0">
              {theme.icon}
              <span className={"text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md " + theme.badge}>
                {data.title || "UPDATE"}
              </span>
            </div>
            <p className="font-medium text-xs sm:text-[13px] truncate max-w-2xl text-center">
              {data.message}
            </p>
            <span className={"inline-flex items-center gap-0.5 text-[11px] font-semibold underline underline-offset-2 shrink-0 " + theme.action}>
              Details <ChevronRight className="w-3 h-3" />
            </span>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
            }}
            className="shrink-0 p-1 -mr-1 rounded-md opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss banner"
            title="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {theme.icon}
              <span>{data.title || "Announcement"}</span>
            </DialogTitle>
            <DialogDescription className="text-foreground whitespace-pre-wrap leading-relaxed pt-2 text-sm">
              {data.message}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
