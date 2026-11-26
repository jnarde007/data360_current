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
  Loader2, ArrowLeft, Send, LifeBuoy, Search, MoreVertical, Trash2, Paperclip, Check, CheckCheck, X, User, Package
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

  const forceScrollToBottom = useCallback((smooth = false) => {
    scrollToBottom(smooth);
    const raf = requestAnimationFrame(() => {
      scrollToBottom(smooth);
      requestAnimationFrame(() => scrollToBottom(smooth));
    });
    const t1 = setTimeout(() => scrollToBottom(smooth), 60);
    const t2 = setTimeout(() => scrollToBottom(smooth), 180);
    const t3 = setTimeout(() => scrollToBottom(smooth), 350);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 120;
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) el.scrollTop = el.scrollHeight;
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

        if (validMsgs.length === 0 && !ticket.message) return;

        const latestMsg = validMsgs[0];
        const unreadCount = validMsgs.filter(
          (m) => m.sender_role === 'customer' && !m.read_at
        ).length;

        const resolvedName =
          cust?.full_name?.trim() || cust?.username || cust?.email?.split('@')[0] || 'Customer';
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

      // Strict descending: most recent message at top
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

      if (ticket?.admin_cleared_at) {
        query = query.gt('created_at', ticket.admin_cleared_at);
      }

      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw error;

      setMessages((data as Message[]) || []);
      if (!isBackground) isNearBottomRef.current = true;

      // Clear admin notifications for support
      supabase
        .from('notifications')
        .update({ read: true } as any)
        .eq('target_type', 'admin')
        .eq('type', 'support')
        .eq('read', false)
        .then(() => {})
        .catch(() => {});

      // Mark messages read in background
      supabase
        .rpc('mark_support_messages_read', {
          p_ticket_id: ticketId,
          p_reader_role: 'admin',
        })
        .then(() => {
          setThreads((prev) =>
            prev.map((t) => (t.ticketId === ticketId ? { ...t, unreadCount: 0 } : t))
          );
        })
        .catch(() => {});
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

  // Realtime listener for active ticket
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
            supabase
              .rpc('mark_support_messages_read', {
                p_ticket_id: activeTicketId,
                p_reader_role: 'admin',
              })
              .catch(() => {});

            supabase
              .from('notifications')
              .update({ read: true } as any)
              .eq('target_type', 'admin')
              .eq('type', 'support')
              .eq('read', false)
              .then(() => {})
              .catch(() => {});
          }

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

          if (isNearBottomRef.current) forceScrollToBottom(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTicketId, forceScrollToBottom]);

  // Global listener to bump threads
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

    setMessages((prev) => [...prev, optimisticMsg]);
    setReplyText('');
    const sentAttachment = attachment;
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = '42px';

    forceScrollToBottom(true);
    setSending(true);

    try {
      let attachmentUrl: string | null = null;
      if (sentAttachment) {
        const fileExt = sentAttachment.name.split('.').pop();
        const filePath = `support/${activeTicketId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(filePath, sentAttachment);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('attachments')
          .getPublicUrl(filePath);
        attachmentUrl = urlData.publicUrl;
      }

      const { data: insertedMsg, error: sendErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: user.id,
          sender_role: 'admin',
          message: text || (attachmentUrl ? 'Attachment sent' : ''),
          attachment_url: attachmentUrl,
        })
        .select()
        .single();

      if (sendErr) throw sendErr;

      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? (insertedMsg as Message) : m))
      );

      setThreads((prev) => {
        const existing = prev.find((t) => t.ticketId === activeTicketId);
        if (!existing) return prev;
        const updated = {
          ...existing,
          lastMessage: text || (attachmentUrl ? 'Attachment sent' : ''),
          lastMessageTime: new Date().toISOString(),
        };
        return [updated, ...prev.filter((t) => t.ticketId !== activeTicketId)];
      });
    } catch (err: any) {
      console.error('Send message error:', err);
      toast({
        title: 'Error sending message',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!activeTicketId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_clear_chat_history', {
        p_ticket_id: activeTicketId,
      });
      if (error) throw error;

      setMessages([]);
      setThreads((prev) =>
        prev.map((t) =>
          t.ticketId === activeTicketId
            ? { ...t, lastMessage: 'Chat cleared by admin', unreadCount: 0 }
            : t
        )
      );

      toast({
        title: 'Chat cleared',
        description: 'Customer chat history has been cleared from your view.',
      });
      setDeleteDialogOpen(false);
    } catch (err: any) {
      console.error('Error clearing chat history:', err);
      toast({
        title: 'Failed to clear chat',
        description: err.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    e.target.style.height = '42px';
    const newHeight = Math.min(e.target.scrollHeight, 120);
    e.target.style.height = `${newHeight}px`;
  };

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const matchSearch =
        t.customerName.toLowerCase().includes(search.toLowerCase()) ||
        t.customerEmail.toLowerCase().includes(search.toLowerCase()) ||
        (t.customerPhone && t.customerPhone.includes(search));
      const matchFilter = filter === 'all' || (filter === 'unread' && t.unreadCount > 0);
      return matchSearch && matchFilter;
    });
  }, [threads, search, filter]);

  const activeThread = useMemo(
    () => threads.find((t) => t.ticketId === activeTicketId),
    [threads, activeTicketId]
  );

  const groupedMessages = useMemo(() => {
    const groups: { date: string; items: Message[] }[] = [];
    messages.forEach((msg) => {
      const dateKey = msg.created_at ? msg.created_at.split('T')[0] : 'unknown';
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === dateKey) {
        lastGroup.items.push(msg);
      } else {
        groups.push({ date: dateKey, items: [msg] });
      }
    });
    return groups;
  }, [messages]);

  return (
    <AdminLayout>
      <div className="h-[calc(100vh-4.25rem)] -m-4 sm:-m-6 flex bg-background overflow-hidden select-none">
        {/* ── Left Sidebar (Inbox) ── */}
        <aside
          className={`${
            activeTicketId ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r border-border/40 bg-card/60 backdrop-blur-xs shrink-0`}
        >
          {/* Search & Filter Header */}
          <div className="p-3 border-b border-border/40 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search customers or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted/50 border border-border/40 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex gap-1.5 text-xs">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-full font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={`px-3 py-1 rounded-full font-medium transition-colors flex items-center gap-1.5 ${
                  filter === 'unread'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                }`}
              >
                <span>Unread</span>
                {threads.some((t) => t.unreadCount > 0) && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
            </div>
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/20">
            {loading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No conversations found
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isActive = thread.ticketId === activeTicketId;
                return (
                  <div
                    key={thread.ticketId}
                    onClick={() => handleSelectThread(thread)}
                    className={`p-3 flex items-start gap-3 cursor-pointer transition-colors relative ${
                      isActive ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs">
                        {getInitials(thread.customerName)}
                      </div>
                      {thread.unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <p
                          className={`text-xs truncate ${
                            thread.unreadCount > 0
                              ? 'font-bold text-foreground'
                              : 'font-medium text-foreground'
                          }`}
                        >
                          {thread.customerName}
                        </p>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {thread.lastMessageTime
                            ? format(new Date(thread.lastMessageTime), 'h:mm a')
                            : ''}
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground truncate leading-tight">
                        {thread.lastMessage}
                      </p>

                      {thread.customerPhone && (
                        <span className="inline-block mt-1 text-[10px] text-muted-foreground/75 font-mono">
                          {thread.customerPhone}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Right Message Pane ── */}
        <section
          className={`${
            activeTicketId ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col bg-background relative overflow-hidden`}
        >
          {activeThread ? (
            <>
              {/* Header */}
              <header className="h-14 shrink-0 bg-card border-b border-border/40 px-3 sm:px-4 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full md:hidden -ml-1 text-muted-foreground"
                    onClick={() => setActiveTicketId(null)}
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </Button>

                  <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                    {getInitials(activeThread.customerName)}
                  </div>

                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground truncate leading-tight">
                      {activeThread.customerName}
                    </h2>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {activeThread.customerEmail}
                      {activeThread.customerPhone ? ` • ${activeThread.customerPhone}` : ''}
                    </p>
                  </div>
                </div>

                {/* 3-Dot Dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full text-muted-foreground"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {activeThread.customerId && (
                      <>
                        <DropdownMenuItem
                          className="gap-2 cursor-pointer text-xs"
                          onClick={() =>
                            window.open(`/admin/customers/${activeThread.customerId}`, '_blank')
                          }
                        >
                          <User className="w-4 h-4 text-primary" />
                          View Customer Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive gap-2 cursor-pointer text-xs"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Message
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </header>

              {/* Messages Container */}
              <main
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 overscroll-contain bg-[#F4F7FB]"
              >
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                    <LifeBuoy className="w-10 h-10 mb-2 opacity-30 text-primary" />
                    <p className="text-sm font-medium text-foreground">No messages in this chat</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Type below to send a reply to {activeThread.customerName}.
                    </p>
                  </div>
                ) : (
                  groupedMessages.map((group) => (
                    <div key={group.date} className="space-y-3">
                      <div className="flex justify-center my-2">
                        <span className="text-[11px] font-medium bg-muted/80 backdrop-blur-xs text-muted-foreground px-2.5 py-0.5 rounded-full border border-border/30">
                          {formatDateDivider(group.items[0]?.created_at)}
                        </span>
                      </div>

                      {group.items.map((msg) => {
                        const isAdmin = msg.sender_role === 'admin';

                        let orderCardData: {
                          shortId: string;
                          network: string;
                          volume: string;
                          phone: string;
                          status: string;
                        } | null = null;
                        let cleanText = msg.message;

                        if (cleanText && cleanText.startsWith('[ORDER_REF:')) {
                          const endIdx = cleanText.indexOf(']');
                          if (endIdx !== -1) {
                            const raw = cleanText.substring(11, endIdx).split('|');
                            orderCardData = {
                              shortId: raw[0] || '',
                              network: raw[1] || '',
                              volume: raw[2] || '',
                              phone: raw[3] || '',
                              status: raw[4] || '',
                            };
                            cleanText = cleanText.substring(endIdx + 1).trim();
                          }
                        }

                        return (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${isAdmin ? '!bg-[#4E89E8] !text-white rounded-br-xs shadow-xs' : '!bg-[#E8F0FA] !text-slate-900 !border-0 rounded-bl-xs shadow-xs'}`}
                          >
                            <div
                              className={`relative max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 shadow-xs text-xs sm:text-[13px] leading-relaxed break-words ${
                                isAdmin ? '!bg-[#4E89E8] !text-white rounded-br-xs shadow-xs' : '!bg-[#E8F0FA] !text-slate-900 !border-0 rounded-bl-xs shadow-xs'
                              }`}
                            >
                              {orderCardData && (
                                <div
                                  className={`mb-2 p-2 rounded-xl border text-xs ${
                                    isAdmin ? '!bg-[#4E89E8] !text-white rounded-br-xs shadow-xs' : '!bg-[#E8F0FA] !text-slate-900 !border-0 rounded-bl-xs shadow-xs'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 font-semibold pb-1 border-b border-current/15 mb-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <Package className="w-3.5 h-3.5" />
                                      <span>Order: {orderCardData.shortId}</span>
                                    </div>
                                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded-md bg-current/15">
                                      {orderCardData.status || 'Active'}
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] opacity-90">
                                    {orderCardData.network && (
                                      <span>
                                        <strong>Network:</strong> {orderCardData.network}
                                      </span>
                                    )}
                                    {orderCardData.volume && (
                                      <span>
                                        <strong>Bundle:</strong> {orderCardData.volume}
                                      </span>
                                    )}
                                    {orderCardData.phone && (
                                      <span className="col-span-2 font-mono">
                                        <strong>Recipient:</strong> {orderCardData.phone}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {cleanText && <p className="whitespace-pre-wrap">{cleanText}</p>}

                              {msg.attachment_url && (
                                <div className="mt-2">
                                  <AttachmentRenderer url={msg.attachment_url} />
                                </div>
                              )}

                              <div
                                className={`mt-1 flex items-center justify-end gap-1 text-[10px] select-none ${
                                  isAdmin ? '!bg-[#4E89E8] !text-white rounded-br-xs shadow-xs' : '!bg-[#E8F0FA] !text-slate-900 !border-0 rounded-bl-xs shadow-xs'
                                }`}
                              >
                                <span>
                                  {msg.created_at
                                    ? format(new Date(msg.created_at), 'h:mm a')
                                    : ''}
                                </span>
                                {isAdmin && (
                                  <span>
                                    {msg.id.startsWith('temp-') ? (
                                      <span className="opacity-50">⋯</span>
                                    ) : msg.read_at ? (
                                      <CheckCheck className="w-3.5 h-3.5 text-sky-300" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </main>

              {/* Composer */}
              <footer className="shrink-0 bg-card border-t border-border/40 p-2 sm:p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {attachment && (
                  <div className="mb-2 px-2 py-1 bg-muted rounded-lg flex items-center justify-between text-xs">
                    <span className="truncate max-w-[200px] text-muted-foreground font-mono">
                      {attachment.name}
                    </span>
                    <button
                      onClick={() => setAttachment(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex items-end gap-1.5">
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => {
                      if (e.target.files?.[0]) setAttachment(e.target.files[0]);
                    }}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-5 h-5" />
                  </Button>

                  <Textarea
                    ref={textareaRef}
                    value={replyText}
                    onChange={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    placeholder={`Reply to ${activeThread.customerName}...`}
                    rows={1}
                    className="min-h-[42px] max-h-[120px] resize-none py-2.5 px-3.5 rounded-2xl bg-muted/40 border-border/50 text-xs sm:text-[13px] focus-visible:ring-1 focus-visible:ring-primary leading-relaxed"
                  />

                  <Button
                    type="submit"
                    disabled={(!replyText.trim() && !attachment) || sending}
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs disabled:opacity-40"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </form>
              </footer>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
              <LifeBuoy className="w-12 h-12 mb-3 opacity-20 text-primary" />
              <p className="text-sm font-semibold text-foreground">Select a conversation</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Pick a customer thread from the left sidebar to read messages and reply.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Clear Chat Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-semibold">
              Delete Message History?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This will clear this customer's messages from your admin view. The customer will
              still see their own chat history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-end">
            <AlertDialogCancel disabled={deleting} className="text-xs h-9 mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearHistory}
              disabled={deleting}
              className="text-xs h-9 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
