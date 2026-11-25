import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info, AlertCircle } from "lucide-react";
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
      bar: "bg-amber-500 text-amber-950 border-amber-600/30",
      badge: "bg-amber-950 text-amber-100 border-amber-900",
      dot: "bg-amber-300",
      icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-950" />,
      dialogBorder: "border-amber-500/30",
    },
    destructive: {
      bar: "bg-rose-600 text-white border-rose-700/40",
      badge: "bg-black/40 text-white border-white/20",
      dot: "bg-rose-300",
      icon: <AlertCircle className="w-3.5 h-3.5 shrink-0 text-white" />,
      dialogBorder: "border-rose-500/30",
    },
    info: {
      bar: "bg-blue-600 text-white border-blue-700/40",
      badge: "bg-black/30 text-white border-white/20",
      dot: "bg-blue-200",
      icon: <Info className="w-3.5 h-3.5 shrink-0 text-white" />,
      dialogBorder: "border-blue-500/30",
    },
  }[data.type] || {
    bar: "bg-amber-500 text-amber-950 border-amber-600/30",
    badge: "bg-amber-950 text-amber-100 border-amber-900",
    dot: "bg-amber-300",
    icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-950" />,
    dialogBorder: "border-amber-500/30",
  };

  return (
    <>
      <aside
        role="region"
        aria-label="Site announcement"
        onClick={() => setIsDialogOpen(true)}
        className={`w-full h-9 px-2 sm:px-4 flex items-center justify-between overflow-hidden cursor-pointer select-none text-xs font-medium border-b shadow-sm relative z-40 transition-colors ${themeStyles.bar}`}
        title="Click to view full message"
      >
        <div className="flex items-center gap-1.5 shrink-0 z-10 pr-2.5 mr-2 border-r border-black/10">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${themeStyles.dot}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${themeStyles.dot}`}></span>
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border shadow-xs ${themeStyles.badge}`}>
            {data.title || "NOTICE"}
          </span>
        </div>

        <div className="flex-1 overflow-hidden relative h-full flex items-center">
          <div className="animate-ticker-marquee text-xs font-semibold tracking-wide">
            <span className="inline-block px-4">{data.message}</span>
            <span className="inline-block px-4 opacity-50">★</span>
            <span className="inline-block px-4">{data.message}</span>
          </div>
        </div>

        <div className="shrink-0 z-10 pl-2 hidden sm:flex items-center text-[10px] font-bold uppercase tracking-wider opacity-80">
          Tap to view
        </div>
      </aside>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={`max-w-md border ${themeStyles.dialogBorder} p-6`}>
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${themeStyles.badge}`}>
                {data.title || "ANNOUNCEMENT"}
              </span>
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
              {data.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap pt-2">
              {data.message}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
