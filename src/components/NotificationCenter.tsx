import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bell, Check, CheckCheck, ShoppingCart, CreditCard, Wallet, AlertTriangle, Shield, Info, X, MailOpen, Mail, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface Notification {
  id: string;
  target_type: string;
  target_id: string | null;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata: Record<string, any>;
  created_at: string;
}

const TYPE_ICONS: Record<string, typeof ShoppingCart> = {
  order_update: ShoppingCart,
  topup_update: CreditCard,
  wallet: Wallet,
  failure: AlertTriangle,
  refund: Wallet,
  security: Shield,
  system: Info,
  info: Info,
  support: Info,
};

const TYPE_COLORS: Record<string, string> = {
  order_update: 'text-primary bg-primary/10',
  topup_update: 'text-primary bg-primary/10',
  wallet: 'text-emerald-600 bg-emerald-500/10',
  failure: 'text-destructive bg-destructive/10',
  refund: 'text-amber-600 bg-amber-500/10',
  security: 'text-destructive bg-destructive/10',
  system: 'text-muted-foreground bg-muted',
  info: 'text-muted-foreground bg-muted',
  support: 'text-primary bg-primary/10',
};

type NotifTab = 'all' | 'orders' | 'wallet' | 'support';

const TAB_CONFIG: { key: NotifTab; label: string; types: string[] }[] = [
  { key: 'all', label: 'All', types: [] },
  { key: 'orders', label: 'Orders', types: ['order_update', 'failure', 'refund'] },
  { key: 'wallet', label: 'Wallet', types: ['wallet', 'topup_update'] },
  { key: 'support', label: 'Support', types: ['support'] },
];

interface NotificationCenterProps {
  targetType: 'customer' | 'admin';
  collapsed?: boolean;
}

let channelCounter = 0;

export function NotificationCenter({ targetType, collapsed = false }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<NotifTab>('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const channelId = useRef(`notifications-${targetType}-${++channelCounter}`);
  const { user } = useAuth();
  const navigate = useNavigate();

  const customerId = targetType === 'customer' ? user?.customer_id : null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const tabCounts = useMemo(() => {
    const counts: Record<NotifTab, number> = { all: 0, orders: 0, wallet: 0, support: 0 };
    notifications.filter(n => !n.read).forEach(n => {
      counts.all++;
      for (const tab of TAB_CONFIG) {
        if (tab.key !== 'all' && tab.types.includes(n.type)) {
          counts[tab.key]++;
        }
      }
    });
    return counts;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    const types = TAB_CONFIG.find(t => t.key === activeTab)?.types || [];
    return notifications.filter(n => types.includes(n.type));
  }, [notifications, activeTab]);

  const loadNotifications = useCallback(async () => {
    if (targetType === 'customer' && !customerId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('target_type', targetType)
        .order('created_at', { ascending: false })
        .limit(50);
      if (targetType === 'customer' && customerId) {
        query = query.eq('target_id', customerId);
      }
      const { data, error } = await query;
      if (error) throw error;
      if (mountedRef.current) {
        setNotifications((data || []) as unknown as Notification[]);
      }
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [targetType, customerId]);

  useEffect(() => {
    mountedRef.current = true;
    loadNotifications();

    const channel = supabase
      .channel(channelId.current)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `target_type=eq.${targetType}`,
      }, (payload) => {
        if (!mountedRef.current) return;
        const newNotif = payload.new as unknown as Notification;
        if (targetType === 'customer' && newNotif.target_id !== customerId) return;
        setNotifications(prev => {
          if (prev.some(n => n.id === newNotif.id)) return prev;
          return [newNotif, ...prev].slice(0, 50);
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `target_type=eq.${targetType}`,
      }, (payload) => {
        if (!mountedRef.current) return;
        const updated = payload.new as unknown as Notification;
        if (targetType === 'customer' && updated.target_id !== customerId) return;
        setNotifications(prev => prev.map(n => n.id === updated.id ? updated : n));
      })
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [targetType, customerId, loadNotifications]);

  // Reset selection when popover closes or tab changes
  useEffect(() => {
    if (!open) {
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const updateReadState = async (ids: string[], read: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setNotifications(prev => prev.map(n => idSet.has(n.id) ? { ...n, read } : n));
    await supabase.from('notifications').update({ read } as any).in('id', ids);
  };

  const markAsRead = (id: string) => updateReadState([id], true);

  const getNotificationRoute = useCallback((n: Notification): string | null => {
    const meta = n.metadata || {};
    const prefix = targetType === 'admin' ? '/admin' : '';

    switch (n.type) {
      case 'support': {
        const ticketId = meta.ticket_id || meta.entity_id;
        if (ticketId) return `${prefix}/support?ticket=${ticketId}`;
        return `${prefix}/support`;
      }
      case 'order_update':
      case 'failure': {
        const orderId = meta.order_id || meta.short_id || meta.reference || meta.entity_id;
        if (prefix === '') {
          return orderId ? `/orders?order=${orderId}` : '/orders';
        }
        return orderId ? `/admin/orders?order=${orderId}` : '/admin/orders';
      }
      case 'wallet':
      case 'topup_update': {
        const txnId = meta.transaction_id || meta.reference || meta.entity_id;
        if (prefix === '') {
          return txnId ? `/wallet?txn=${txnId}` : '/wallet';
        }
        return txnId ? `/admin/wallet-ledger?txn=${txnId}` : '/admin/wallet-ledger';
      }
      case 'refund': {
        const refundTxnId = meta.transaction_id || meta.reference || meta.entity_id;
        if (prefix === '') {
          return refundTxnId ? `/wallet?txn=${refundTxnId}` : '/wallet';
        }
        return refundTxnId ? `/admin/wallet-ledger?txn=${refundTxnId}` : '/admin/wallet-ledger';
      }
      case 'security':
        return prefix === '' ? '/account' : '/admin';
      default:
        return prefix === '' ? '/dashboard' : '/admin';
    }
  }, [targetType]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleNotificationClick = useCallback(async (n: Notification) => {
    if (selectionMode) {
      toggleSelected(n.id);
      return;
    }
    if (!n.read) {
      markAsRead(n.id);
    }
    const route = getNotificationRoute(n);
    if (route) {
      setOpen(false);
      navigate(route);
    }
  }, [selectionMode, getNotificationRoute, navigate]);

  const markAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    await updateReadState(unreadIds, true);
  };

  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const allFilteredSelected = filteredNotifications.length > 0 && filteredNotifications.every(n => selectedIds.has(n.id));
  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredNotifications.forEach(n => next.delete(n.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredNotifications.forEach(n => next.add(n.id));
        return next;
      });
    }
  };

  const bulkMarkRead = async () => {
    await updateReadState(selectedArray, true);
    setSelectedIds(new Set());
  };
  const bulkMarkUnread = async () => {
    await updateReadState(selectedArray, false);
    setSelectedIds(new Set());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button aria-label="Notifications" className="relative flex items-center justify-center w-9 h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-200">
          <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} />
          <AnimatePresence>
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute top-0.5 right-0.5 min-w-[16px] h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1 ring-2 ring-background"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        className="w-[calc(100vw-24px)] max-w-[400px] p-0 rounded-2xl overflow-hidden shadow-xl border-border/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <h3 className="text-base font-display font-semibold text-foreground">Notifications</h3>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
            </p>
          </div>
          <div className="flex items-center gap-0.5">
            {!selectionMode && unreadCount > 0 && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={markAllRead} aria-label="Mark all read" title="Mark all read">
                <CheckCheck className="w-4 h-4" />
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant={selectionMode ? 'secondary' : 'ghost'}
                size={selectionMode ? 'sm' : 'icon'}
                className={selectionMode ? 'h-8 text-xs' : 'h-8 w-8 text-muted-foreground'}
                onClick={() => {
                  setSelectionMode(s => !s);
                  setSelectedIds(new Set());
                }}
                aria-label="Select notifications"
                title="Select"
              >
                {selectionMode ? 'Done' : <ListChecks className="w-4 h-4" />}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setOpen(false)} aria-label="Close">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Selection action bar */}
        {selectionMode && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/30">
            <button
              onClick={toggleSelectAllFiltered}
              className="flex items-center gap-2 text-xs font-medium text-foreground hover:text-primary"
            >
              <Checkbox checked={allFilteredSelected} className="pointer-events-none" />
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
            </button>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={selectedIds.size === 0}
                onClick={bulkMarkRead}
              >
                <MailOpen className="w-3.5 h-3.5" /> Read
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={selectedIds.size === 0}
                onClick={bulkMarkUnread}
              >
                <Mail className="w-3.5 h-3.5" /> Unread
              </Button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="grid grid-cols-4 gap-1 mx-4 mb-2 p-1 rounded-xl bg-muted/50">
          {TAB_CONFIG.map(tab => {
            const count = tabCounts[tab.key];
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-all duration-150 flex items-center justify-center gap-1 ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`min-w-[16px] h-4 rounded-full text-[10px] font-bold flex items-center justify-center px-1 ${
                    'bg-primary/15 text-primary'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        <ScrollArea className="max-h-[min(400px,60dvh)]" viewportClassName="max-h-[inherit]">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Bell className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {activeTab === 'all' ? 'No notifications yet' : `No ${activeTab} notifications`}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {targetType === 'customer'
                  ? "You'll be notified about orders, top-ups, and account activity."
                  : "System alerts and operational events will appear here."}
              </p>
            </div>
          ) : (
            <div className="border-t border-border/40 divide-y divide-border/30">
              {filteredNotifications.map(n => {
                const Icon = TYPE_ICONS[n.type] || Info;
                const colorClass = TYPE_COLORS[n.type] || TYPE_COLORS.info;
                const isSelected = selectedIds.has(n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-muted/40 cursor-pointer ${
                      !n.read ? 'bg-primary/[0.04]' : ''
                    } ${isSelected ? 'bg-primary/[0.06]' : ''}`}
                  >
                    {selectionMode ? (
                      <div className="flex items-center shrink-0 mt-1.5">
                        <Checkbox checked={isSelected} className="pointer-events-none" />
                      </div>
                    ) : (
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`text-[13px] leading-snug truncate ${!n.read ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                          {n.title}
                        </p>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true }).replace('about ', '')}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                    </div>
                    {!n.read && !selectionMode && (
                      <span className="w-2 h-2 rounded-full bg-primary shrink-0 self-center" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
