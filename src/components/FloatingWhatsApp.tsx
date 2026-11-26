import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Headphones, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useToast } from '@/hooks/use-toast';

function useScrollDirection() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const ticking = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const down = y > lastY.current && y > 80;
        lastY.current = y;
        if (down) {
          setVisible(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setVisible(true), 1200);
        } else {
          setVisible(true);
          clearTimeout(timer.current);
        }
        ticking.current = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer.current);
    };
  }, []);

  return visible;
}

export function FloatingWhatsApp() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState({ support: '', channel: '' });
  const [loading, setLoading] = useState(true);
  const scrollVisible = useScrollDirection();
  const { toast } = useToast();

  const fetchUrls = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', ['whatsapp_support_url', 'whatsapp_channel_url']);

      if (data) {
        const map = Object.fromEntries(data.map(r => [r.key, r.value]));
        setUrls({
          support: map.whatsapp_support_url || '',
          channel: map.whatsapp_channel_url || '',
        });
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUrls();
  }, [fetchUrls]);

  useRealtimeRefresh(['platform_settings'], fetchUrls, 'whatsapp-settings');

  // Completely hide on support and admin support pages so it never blocks the chat screen
  if (location.pathname.startsWith('/support') || location.pathname.startsWith('/admin/support')) {
    return null;
  }

  const hasAny = urls.support || urls.channel;
  if (loading || !hasAny) return null;

  const handleClick = (url: string, label: string) => {
    if (!url) {
      toast({ title: 'Not Available', description: `${label} link is not configured yet.`, variant: 'destructive' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {scrollVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-20 lg:bottom-6 right-4 z-40 flex flex-col items-end gap-2"
        >
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.18 }}
                className="bg-card border border-border/60 rounded-2xl p-2 shadow-xl flex flex-col gap-1 min-w-[180px] backdrop-blur-md"
              >
                {urls.support && (
                  <button
                    onClick={() => handleClick(urls.support, 'WhatsApp Support')}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Headphones className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Support Chat</p>
                      <p className="text-[10px] text-muted-foreground">Talk to our team</p>
                    </div>
                  </button>
                )}
                {urls.channel && (
                  <button
                    onClick={() => handleClick(urls.channel, 'WhatsApp Channel')}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Users className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Join Channel</p>
                      <p className="text-[10px] text-muted-foreground">Updates & offers</p>
                    </div>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setOpen(o => !o)}
            className="w-11 h-11 lg:w-12 lg:h-12 rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
            aria-label="WhatsApp"
          >
            {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
