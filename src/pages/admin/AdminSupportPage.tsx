import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, Search, MoreVertical, Trash2, Paperclip, Check, CheckCheck, X, User
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { useSearchParams } from 'react-router-dom';

interface CustomerThread {
  ticketId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  created_at: string;
  read_at: string | null;
}

function formatDateDivider(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d, yyyy');
}

function getInitials(name: string): string {
  if (!name || name === 'Customer') return 'CU';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [threads, setThreads] = useState<CustomerThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

  // Bulletproof direct scroll to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (smooth) {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Multi-stage paint anchor
  const forceScrollToBottom = useCallback((smooth = false) => {
    scrollToBottom(smooth);
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom(smooth);
      requestAnimationFrame(() => scrollToBottom(smooth));
    });
    const t1 = setTimeout(() => scrollToBottom(smooth), 60);
    const t2 = setTimeout(() => scrollToBottom(smooth), 180);
    const t3 = setTimeout(() => scrollToBottom(smooth), 350);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scrollToBottom]);

  // Track if admin manually scrolled up
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 120;
  }, []);

  // ResizeObserver: Snap to bottom the instant messages render
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loadingMessages && messages.length > 0 && isNearBottomRef.current) {
      forceScrollToBottom(false);
    }
  }, [activeTicketId, loadingMessages, messages.length, forceScrollToBottom]);

  // Fetch threads with real customer names from customers table
  const fetchThreads = useCallback(async () => {
    try {
      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('id, customer_id, updated_at, admin_cleared_at, message, created_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      if (!tickets || tickets.length === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }

      const customerIds = [...new Set(tickets.map((t) => t.customer_id).filter(Boolean))];

      // Query customers table directly for full_name, email, phone, username
      const [{ data: customersData }, { data: allMessages }] = await Promise.all([
        supabase
          .from('customers')
          .select('id, full_name, email, phone, username')
          .in('id', customerIds),
        supabase
          .from('support_messages')
          .select('id, ticket_id, message, created_at, sender_role, read_at')
          .in('ticket_id', tickets.map((t) => t.id))
          .order('created_at', { ascending: false }),
      ]);

      const customerMap = new Map((customersData || []).map((c) => [c.id, c]));
      const ticketMessagesMap = new Map<string, any[]>();
      (allMessages || []).forEach((m) => {
        const list = ticketMessagesMap.get(m.ticket_id) || [];
        list.push(m);
        ticketMessagesMap.set(m.ticket_id, list);
      });

      const threadList: CustomerThread[] = [];

      tickets.forEach((ticket) => {
        const cust = customerMap.get(ticket.customer_id);
        const ticketMsgs = ticketMessagesMap.get(ticket.id) || [];

        const clearedAt = ticket.admin_cleared_at ? new Date(ticket.admin_cleared_at).getTime() : 0;
        const validMsgs = ticketMsgs.filter((m) => new Date(m.created_at).getTime() > clearedAt);

        // Exclude completely empty tickets
        if (validMsgs.length === 0 && !ticket.message) return;

        const latestMsg = validMsgs[0];
        const unreadCount = validMsgs.filter(
          (m) => m.sender_role === 'customer' && !m.read_at
        ).length;

        const resolvedName = cust?.full_name?.trim() || cust?.username || cust?.email?.split('@')[0] || 'Customer';
        const resolvedEmail = cust?.email || 'No email';
        const resolvedPhone = cust?.phone || undefined;

        threadList.push({
          ticketId: ticket.id,
          customerId: ticket.customer_id,
          customerName: resolvedName,
          customerEmail: resolvedEmail,
          customerPhone: resolvedPhone,
          lastMessage: latestMsg?.message || ticket.message || 'Support inquiry',
          lastMessageTime: latestMsg?.created_at || ticket.updated_at || ticket.created_at,
          unreadCount,
        });
      });

      // Strict descending order: most recent message ALWAYS at top
      threadList.sort(
        (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
      );

      setThreads(threadList);

      if (!activeTicketId && threadList.length > 0 && window.innerWidth >= 768) {
        setActiveTicketId(threadList[0].ticketId);
      }
    } catch (err: any) {
      console.error('Error fetching support threads:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTicketId]);

  const fetchMessages = useCallback(async (ticketId: string, isBackground = false) => {
    if (!isBackground) setLoadingMessages(true);
    try {
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('admin_cleared_at')
        .eq('id', ticketId)
        .maybeSingle();

      let query = supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId);

      // Only show messages after admin's cleared timestamp
      if (ticket?.admin_cleared_at) {
        query = query.gt('created_at', ticket.admin_cleared_at);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);

      if (!isBackground) {
        isNearBottomRef.current = true;
      }

      // Mark read in background
      supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'admin',
      }).then(() => {
        setThreads((prev) =>
          prev.map((t) => (t.ticketId === ticketId ? { ...t, unreadCount: 0 } : t))
        );
      }).catch(() => {});
    } catch (err: any) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (activeTicketId) {
      isNearBottomRef.current = true;
      fetchMessages(activeTicketId, false);
    }
  }, [activeTicketId, fetchMessages]);

  // LIVE REALTIME WEBSOCKET: Active conversation instant streaming (<100ms)
  useEffect(() => {
    if (!activeTicketId) return;

    const channel = supabase
      .channel(`admin-chat-live-${activeTicketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${activeTicketId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;

          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            const hasTemp = prev.some(
              (m) => m.id.startsWith('temp-') && m.message === newMsg.message
            );
            if (hasTemp) {
              return prev.map((m) =>
                m.id.startsWith('temp-') && m.message === newMsg.message ? newMsg : m
              );
            }
            return [...prev, newMsg];
          });

          if (newMsg.sender_role === 'customer') {
            supabase.rpc('mark_support_messages_read', {
              p_ticket_id: activeTicketId,
              p_reader_role: 'admin',
            }).catch(() => {});
          }

          // Bump active thread to top immediately
          setThreads((prev) => {
            const existing = prev.find((t) => t.ticketId === activeTicketId);
            if (!existing) return prev;
            const updated = {
              ...existing,
              lastMessage: newMsg.message || 'Attachment sent',
              lastMessageTime: newMsg.created_at,
              unreadCount: 0,
            };
            return [updated, ...prev.filter((t) => t.ticketId !== activeTicketId)];
          });

          if (isNearBottomRef.current) {
            forceScrollToBottom(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTicketId, forceScrollToBottom]);

  // GLOBAL REALTIME: Any incoming customer message elsewhere immediately pops thread to top
  useEffect(() => {
    const channel = supabase
      .channel('admin-support-global-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          const newMsg = payload.new as Message;
          if (newMsg.ticket_id === activeTicketId) return;

          setThreads((prev) => {
            const existing = prev.find((t) => t.ticketId === newMsg.ticket_id);
            if (!existing) {
              fetchThreads();
              return prev;
            }
            const updated = {
              ...existing,
              lastMessage: newMsg.message || 'Attachment sent',
              lastMessageTime: newMsg.created_at,
              unreadCount:
                newMsg.sender_role === 'customer'
                  ? existing.unreadCount + 1
                  : existing.unreadCount,
            };
            return [updated, ...prev.filter((t) => t.ticketId !== newMsg.ticket_id)];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTicketId, fetchThreads]);

  const handleSelectThread = (thread: CustomerThread) => {
    setActiveTicketId(thread.ticketId);
    setSearchParams({ chat: thread.ticketId });
    isNearBottomRef.current = true;
  };

  // OPTIMISTIC SEND: Instant reply (0ms delay)
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if ((!text && !attachment) || sending || !activeTicketId || !user?.id) return;

    const tempId = 'temp-' + Date.now();
    const optimisticMsg: Message = {
      id: tempId,
      ticket_id: activeTicketId,
      sender_id: user.id,
      sender_role: 'admin',
      message: text || (attachment ? 'Attachment sent' : ''),
      attachment_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
    };

    // 1. Immediately show in chat
    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText('');
    const sentAttachment = attachment;
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = '40px';

    isNearBottomRef.current = true;
    forceScrollToBottom(true);
    setSending(true);

    // Bump this thread immediately to the top of the sidebar
    setThreads((prev) => {
      const current = prev.find((t) => t.ticketId === activeTicketId);
      if (!current) return prev;
      const updatedThread = {
        ...current,
        lastMessage: text || 'Attachment sent',
        lastMessageTime: new Date().toISOString(),
      };
      return [updatedThread, ...prev.filter((t) => t.ticketId !== activeTicketId)];
    });

    try {
      let uploadedUrl: string | null = null;
      if (sentAttachment) {
        const ext = sentAttachment.name.split('.').pop() || 'bin';
        const filePath = `admin/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, sentAttachment);

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(filePath);
          uploadedUrl = urlData?.publicUrl || null;
        }
      }

      const { data: newMsg, error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: user.id,
          sender_role: 'admin',
          message: text || (uploadedUrl ? 'Sent an attachment' : ''),
          attachment_url: uploadedUrl,
        } as any)
        .select()
        .single();

      if (insertErr) throw insertErr;

      if (newMsg) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (newMsg as Message) : m))
        );
      }
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast({
        title: 'Failed to send message',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  // Safe Admin Clear: clears for admin, preserves customer messages
  const handleDeleteConversation = async () => {
    if (!activeTicketId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_clear_chat_history', {
        p_ticket_id: activeTicketId,
      });

      if (error) throw error;

      setMessages([]);
      setDeleteDialogOpen(false);

      setThreads((prev) =>
        prev.map((t) =>
          t.ticketId === activeTicketId
            ? { ...t, lastMessage: 'Chat cleared (Admin view)', unreadCount: 0 }
            : t
        )
      );

      toast({
        title: 'Chat cleared',
        description: 'Conversation messages cleared from admin view. Customer records preserved.',
      });
    } catch (err: any) {
      toast({
        title: 'Error clearing chat',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  };

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const matchesSearch =
        t.customerName.toLowerCase().includes(search.toLowerCase()) ||
        t.customerEmail.toLowerCase().includes(search.toLowerCase()) ||
        (t.customerPhone && t.customerPhone.includes(search));
      const matchesFilter = filter === 'all' || (filter === 'unread' && t.unreadCount > 0);
      return matchesSearch && matchesFilter;
    });
  }, [threads, search, filter]);

  const activeThread = useMemo(
    () => threads.find((t) => t.ticketId === activeTicketId),
    [threads, activeTicketId]
  );

  const groupedMessages = useMemo(() => {
    return messages.reduce((acc, msg) => {
      const dateKey = msg.created_at ? format(new Date(msg.created_at), 'yyyy-MM-dd') : 'unknown';
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(msg);
      return acc;
    }, {} as Record<string, Message[]>);
  }, [messages]);

  return (
    <AdminLayout>
      <div className="flex h-[calc(100dvh-4rem)] bg-background text-foreground overflow-hidden rounded-2xl border border-border/60 shadow-sm">
        {/* LEFT INBOX SIDEBAR */}
        <aside
          className={`w-full md:w-80 lg:w-96 border-r border-border/50 flex flex-col bg-card/60 backdrop-blur-xs shrink-0 ${
            activeTicketId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* Header */}
          <div className="p-3.5 border-b border-border/50 space-y-3 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base text-foreground flex items-center gap-2">
                Support Chats
                {threads.some((t) => t.unreadCount > 0) && (
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
              </h2>
              <div className="flex bg-muted/60 p-0.5 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filter === 'all'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filter === 'unread'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Unread
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search customer name, email, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-muted/50 border border-border/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading ? (
              <div className="p-8 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>Loading conversations...</span>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                {search ? 'No chats match your search.' : 'No active chats found.'}
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isActive = thread.ticketId === activeTicketId;
                const initials = getInitials(thread.customerName);
                return (
                  <div
                    key={thread.ticketId}
                    onClick={() => handleSelectThread(thread)}
                    className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors relative ${
                      isActive ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0 shadow-inner">
                      {initials}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span
                          className={`text-xs truncate font-semibold ${
                            thread.unreadCount > 0
                              ? 'text-foreground font-bold'
                              : 'text-foreground/90'
                          }`}
                        >
                          {thread.customerName}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {thread.lastMessageTime
                            ? format(new Date(thread.lastMessageTime), 'HH:mm')
                            : ''}
                        </span>
                      </div>

                      <p
                        className={`text-xs truncate leading-snug ${
                          thread.unreadCount > 0
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {thread.lastMessage}
                      </p>
                    </div>

                    {thread.unreadCount > 0 && (
                      <span className="shrink-0 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* RIGHT CHAT AREA */}
        <section
          className={`flex-1 flex flex-col bg-muted/10 ${
            activeTicketId ? 'flex' : 'hidden md:flex'
          }`}
        >
          {activeThread ? (
            <>
              {/* WhatsApp-Style Chat Header */}
              <header className="h-14 px-4 bg-card/80 backdrop-blur-xs border-b border-border/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setActiveTicketId(null)}
                    className="md:hidden h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>

                  <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shadow-inner">
                    {getInitials(activeThread.customerName)}
                  </div>

                  <div>
                    <h3 className="font-semibold text-xs md:text-sm text-foreground leading-tight">
                      {activeThread.customerName}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate max-w-xs md:max-w-md">
                      {activeThread.customerEmail}
                      {activeThread.customerPhone && ` • ${activeThread.customerPhone}`}
                    </p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={() => {
                        if (activeThread?.customerId) {
                          window.open(`/admin/customers/${activeThread.customerId}`, '_blank');
                        }
                      }}
                      className="flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <User className="w-4 h-4 text-primary" />
                      <span>View Customer Profile</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteDialogOpen(true)}
                      className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Message</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>

              {/* Messages Container */}
              <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
              >
                {loadingMessages ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <span>Loading messages...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs text-center p-6">
                    <LifeBuoy className="w-8 h-8 mb-2 opacity-30 text-primary" />
                    <p className="font-semibold text-foreground text-sm">No messages to display</p>
                    <p className="text-muted-foreground max-w-xs mt-1">
                      Messages in this conversation are cleared or waiting for input.
                    </p>
                  </div>
                ) : (
                  Object.entries(groupedMessages).map(([dateKey, msgs]) => (
                    <div key={dateKey} className="space-y-3">
                      <div className="flex justify-center my-2 sticky top-2 z-10">
                        <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-card text-muted-foreground shadow-xs border border-border/40">
                          {formatDateDivider(msgs[0]?.created_at || dateKey)}
                        </span>
                      </div>

                      {msgs.map((m) => {
                        const isAdmin = m.sender_role === 'admin';
                        return (
                          <div
                            key={m.id}
                            className={`flex w-full ${isAdmin ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`relative max-w-[85%] sm:max-w-md rounded-2xl px-3.5 py-2.5 shadow-xs text-xs md:text-sm break-words ${
                                isAdmin
                                  ? 'bg-primary text-primary-foreground rounded-br-xs'
                                  : 'bg-card text-foreground border border-border/50 rounded-bl-xs'
                              }`}
                            >
                              {!isAdmin && (
                                <p className="text-[11px] font-semibold text-primary mb-1">
                                  {activeThread.customerName}
                                </p>
                              )}

                              {m.attachment_url && (
                                <div className="mb-2 rounded-lg overflow-hidden">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}

                              <p className="whitespace-pre-wrap leading-relaxed select-text">
                                {m.message}
                              </p>

                              <div
                                className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                                  isAdmin ? 'text-primary-foreground/75' : 'text-muted-foreground'
                                }`}
                              >
                                <span>{m.created_at ? format(new Date(m.created_at), 'HH:mm') : ''}</span>
                                {isAdmin && (
                                  m.read_at ? (
                                    <CheckCheck className="w-3.5 h-3.5 text-sky-200" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5 opacity-80" />
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Admin Composer */}
              <div className="p-2.5 bg-card border-t border-border/50 shrink-0">
                {attachment && (
                  <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 rounded-xl mb-2 text-xs border border-border/40">
                    <span className="truncate text-foreground font-medium flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-primary" />
                      {attachment.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) setAttachment(e.target.files[0]);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                    title="Attach File"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>

                  <Textarea
                    ref={textareaRef}
                    rows={1}
                    value={replyText}
                    onChange={handleTextareaChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Reply as Support Agent..."
                    maxLength={2000}
                    className="min-h-[40px] max-h-[120px] resize-none text-xs md:text-sm rounded-2xl bg-muted/50 border-border/50 focus-visible:ring-1 focus-visible:ring-primary py-2 px-3 leading-relaxed"
                  />

                  <Button
                    type="submit"
                    disabled={(!replyText.trim() && !attachment) || sending}
                    className="h-9 w-9 rounded-full p-0 flex items-center justify-center bg-primary text-primary-foreground shadow-xs shrink-0"
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 ml-0.5" />}
                  </Button>
                </form>
              </div>

              {/* Delete Message Dialog */}
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Message?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will clear the conversation messages from your admin view. Customer records will remain preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteConversation}
                      disabled={deleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleting ? 'Deleting...' : 'Delete Message'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
              <LifeBuoy className="w-10 h-10 mb-2 opacity-30 text-primary" />
              <p className="font-semibold text-foreground text-sm">Select a conversation</p>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Choose a customer from the left list to view and reply to their messages.
              </p>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
