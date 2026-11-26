import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, Search, Paperclip, X,
  MoreVertical, Trash2, CheckCheck, Check, MessageSquare
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
  sender_role: 'customer' | 'admin';
  message: string;
  attachment_url: string | null;
  read_at: string | null;
  created_at: string;
}

function formatDateDivider(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d, yyyy');
}

export default function AdminSupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<CustomerThread[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const [activeTicketId, setActiveTicketId] = useState<string | null>(searchParams.get('chat'));
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = messagesContainerRef.current;
    if (container) {
      if (smooth) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(false);
      const t1 = setTimeout(() => scrollToBottom(false), 50);
      const t2 = setTimeout(() => scrollToBottom(false), 200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [messages.length, activeTicketId, scrollToBottom]);

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

      // Group latest ticket per customer
      const customerMap = new Map<string, { tid: string; clearedAt: string | null; updatedAt: string; ticketMsg: string }>();
      tickets.forEach(t => {
        if (!customerMap.has(t.customer_id)) {
          customerMap.set(t.customer_id, {
            tid: t.id,
            clearedAt: (t as any).admin_cleared_at || null,
            updatedAt: t.updated_at,
            ticketMsg: t.message
          });
        }
      });

      const customerIds = Array.from(customerMap.keys());
      const { data: profiles } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')
        .in('id', customerIds);

      const profileLookup = new Map((profiles || []).map(p => [p.id, p]));

      const threadResults: (CustomerThread | null)[] = await Promise.all(
        customerIds.map(async (cid) => {
          const entry = customerMap.get(cid)!;
          const profile = profileLookup.get(cid);

          let query = supabase
            .from('support_messages')
            .select('message, created_at, sender_role, read_at')
            .eq('ticket_id', entry.tid);

          if (entry.clearedAt) {
            query = query.gt('created_at', entry.clearedAt);
          }

          const { data: msgs } = await query
            .order('created_at', { ascending: false })
            .limit(10);

          const hasRealMessages = msgs && msgs.length > 0;
          const lastMsg = hasRealMessages ? msgs[0] : null;

          // If no messages exist at all after clearing, filter out this thread
          if (!hasRealMessages) {
            return null;
          }

          const unread = (msgs || []).filter(
            m => m.sender_role === 'customer' && !m.read_at
          ).length;

          return {
            ticketId: entry.tid,
            customerId: cid,
            customerName: profile?.full_name || 'Customer',
            customerEmail: profile?.email || 'No email',
            customerPhone: profile?.phone || '',
            lastMessage: lastMsg?.message || '',
            lastMessageTime: lastMsg?.created_at || entry.updatedAt || new Date().toISOString(),
            unreadCount: unread,
          };
        })
      );

      // Filter out nulls (customers who have no messages)
      const validThreads = threadResults.filter((t): t is CustomerThread => t !== null);

      // Sort recent messages strictly to the top (descending)
      validThreads.sort((a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime());

      setThreads(validThreads);

      const currentSelected = searchParams.get('chat');
      const targetTicket = currentSelected || validThreads[0]?.ticketId;
      if (targetTicket && !activeTicketId) {
        setActiveTicketId(targetTicket);
      }
    } catch (err: any) {
      console.error('Error fetching admin threads:', err);
    } finally {
      setLoading(false);
    }
  }, [searchParams, activeTicketId]);

  const fetchMessages = useCallback(async (ticketId: string, isBackground = false) => {
    // Only show the spinner on manual navigation when switching tickets, not on background live sync
    if (!isBackground) {
      setLoadingMessages(true);
    }

    try {
      const { data: ticketData } = await supabase
        .from('support_tickets')
        .select('admin_cleared_at')
        .eq('id', ticketId)
        .maybeSingle();

      let query = supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId);

      if ((ticketData as any)?.admin_cleared_at) {
        query = query.gt('created_at', (ticketData as any).admin_cleared_at);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);

      // Non-blocking read receipt update in background
      supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'admin'
      }).then(() => {
        setThreads(prev =>
          prev.map(t => (t.ticketId === ticketId ? { ...t, unreadCount: 0 } : t))
        );
      }).catch(() => {});

      setTimeout(() => scrollToBottom(isBackground), 40);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    if (activeTicketId) {
      fetchMessages(activeTicketId, false);
    }
  }, [activeTicketId, fetchMessages]);

  useRealtimeRefresh(
    ['support_messages', 'support_tickets'],
    () => {
      if (activeTicketId) {
        fetchMessages(activeTicketId, true); // true = silent background refresh
      }
      fetchThreads();
    },
    'admin-support-chat'
  );

  const handleSelectThread = (ticketId: string) => {
    if (ticketId === activeTicketId) return;
    setActiveTicketId(ticketId);
    setSearchParams({ chat: ticketId });
  };

  const handleBackToList = () => {
    setActiveTicketId(null);
    setSearchParams({});
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if ((!text && !attachment) || sending || !activeTicketId || !user?.id) return;

    setSending(true);
    let uploadedUrl: string | null = null;

    // Optimistic UI update: instantly show message
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
    setMessages(prev => [...prev, optimisticMsg]);
    setReplyText('');
    const sentAttachment = attachment;
    setAttachment(null);
    if (textareaRef.current) textareaRef.current.style.height = '40px';
    setTimeout(() => scrollToBottom(true), 40);

    // Bump this thread immediately to the very top
    setThreads(prev => {
      const current = prev.find(t => t.ticketId === activeTicketId);
      if (!current) return prev;
      const updatedThread = {
        ...current,
        lastMessage: text || 'Attachment sent',
        lastMessageTime: new Date().toISOString()
      };
      return [updatedThread, ...prev.filter(t => t.ticketId !== activeTicketId)];
    });

    try {
      if (sentAttachment) {
        const ext = sentAttachment.name.split('.').pop() || 'bin';
        const filePath = 'admin/' + Date.now() + '.' + ext;
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
          message: text || (uploadedUrl ? 'Attachment sent' : ''),
          attachment_url: uploadedUrl,
        } as any)
        .select()
        .single();

      if (insertErr) throw insertErr;

      // Replace temp message with confirmed db row
      setMessages(prev => prev.map(m => m.id === tempId ? (newMsg as Message) : m));
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      toast({
        title: 'Failed to send reply',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteConversation = async () => {
    if (!activeTicketId) return;
    setDeleting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_clear_chat_history', {
        p_ticket_id: activeTicketId
      });

      if (rpcErr) throw rpcErr;

      setMessages([]);
      setDeleteDialogOpen(false);
      toast({ title: 'Deleted', description: 'Messages cleared for admin. Customer messages preserved.' });
      fetchThreads();
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message || 'Could not clear messages', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSingleMessage = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('support_messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;

      setMessages(prev => prev.filter(m => m.id !== messageId));
      toast({ title: 'Message deleted' });
      fetchThreads();
    } catch (err: any) {
      toast({ title: 'Failed to delete message', description: err.message, variant: 'destructive' });
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const activeThread = useMemo(
    () => threads.find(t => t.ticketId === activeTicketId),
    [threads, activeTicketId]
  );

  const filteredThreads = useMemo(() => {
    return threads.filter(t => {
      const matchSearch =
        t.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.customerPhone && t.customerPhone.includes(searchQuery));
      const matchFilter = filter === 'all' || (filter === 'unread' && t.unreadCount > 0);
      return matchSearch && matchFilter;
    });
  }, [threads, searchQuery, filter]);

  const groupedMessages = useMemo(() => {
    return messages.reduce((acc, msg) => {
      const key = msg.created_at ? format(new Date(msg.created_at), 'yyyy-MM-dd') : 'today';
      if (!acc[key]) acc[key] = [];
      acc[key].push(msg);
      return acc;
    }, {} as Record<string, Message[]>);
  }, [messages]);

  return (
    <AdminLayout>
      <div className="w-full h-[calc(100dvh-5rem)] flex bg-background rounded-2xl border border-border/50 overflow-hidden shadow-xs">
        {/* Left Sidebar: Customer Conversations */}
        <aside
          className={
            (activeTicketId ? 'hidden md:flex' : 'flex') +
            ' w-full md:w-80 lg:w-96 flex-col border-r border-border/50 bg-card/60 shrink-0'
          }
        >
          <div className="p-3.5 border-b border-border/50 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" /> Support Chats
              </h2>
              <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={
                    'px-2.5 py-1 rounded-md font-medium transition-colors ' +
                    (filter === 'all' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground')
                  }
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('unread')}
                  className={
                    'px-2.5 py-1 rounded-md font-medium transition-colors ' +
                    (filter === 'unread' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground')
                  }
                >
                  Unread
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, phone..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/40 border border-border/50 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading ? (
              <div className="p-8 flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span>Loading chats...</span>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                {searchQuery ? 'No matching chats found' : 'No active support conversations'}
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isActive = thread.ticketId === activeTicketId;
                return (
                  <button
                    key={thread.ticketId}
                    type="button"
                    onClick={() => handleSelectThread(thread.ticketId)}
                    className={
                      'w-full text-left p-3.5 transition-colors flex items-start gap-3 hover:bg-muted/40 ' +
                      (isActive ? 'bg-muted/60 border-l-2 border-primary' : '')
                    }
                  >
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs border border-primary/20">
                        {thread.customerName.slice(0, 2).toUpperCase()}
                      </div>
                      {thread.unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={'text-xs truncate ' + (thread.unreadCount > 0 ? 'font-bold text-foreground' : 'font-medium text-foreground')}>
                          {thread.customerName}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {format(new Date(thread.lastMessageTime), 'h:mm a')}
                        </span>
                      </div>
                      <p className={'text-xs truncate ' + (thread.unreadCount > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                        {thread.lastMessage}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Pane: WhatsApp-style Active Conversation */}
        <section
          className={
            (!activeTicketId ? 'hidden md:flex' : 'flex') +
            ' flex-1 flex-col h-full bg-muted/10 relative min-w-0'
          }
        >
          {activeTicketId && activeThread ? (
            <>
              {/* Chat Header */}
              <div className="h-14 px-4 bg-card border-b border-border/50 flex items-center justify-between shrink-0 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBackToList}
                    className="md:hidden h-8 w-8 -ml-1 text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
                    {activeThread.customerName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-xs md:text-sm text-foreground truncate">
                      {activeThread.customerName}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {activeThread.customerEmail} {activeThread.customerPhone && (' • ' + activeThread.customerPhone)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() => setDeleteDialogOpen(true)}
                        className="text-destructive focus:text-destructive cursor-pointer flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete Message</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Messages Container */}
              <div
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4"
              >
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                    <p className="text-xs">No messages yet. Send a message to start the conversation.</p>
                  </div>
                ) : (
                  Object.entries(groupedMessages).map(([dateKey, msgs]) => (
                    <div key={dateKey} className="space-y-2">
                      <div className="flex justify-center my-2">
                        <span className="text-[10px] font-medium bg-muted/80 text-muted-foreground px-2.5 py-0.5 rounded-full shadow-2xs">
                          {formatDateDivider(msgs[0]?.created_at || dateKey)}
                        </span>
                      </div>

                      {msgs.map((m) => {
                        const isAdmin = m.sender_role === 'admin';
                        return (
                          <div
                            key={m.id}
                            className={'flex items-end gap-1.5 group ' + (isAdmin ? 'justify-end' : 'justify-start')}
                          >
                            <div
                              className={
                                'max-w-[78%] md:max-w-[65%] rounded-2xl px-3.5 py-2 text-xs shadow-2xs relative leading-relaxed ' +
                                (isAdmin
                                  ? 'bg-primary text-primary-foreground rounded-br-xs'
                                  : 'bg-card text-foreground border border-border/50 rounded-bl-xs')
                              }
                            >
                              {!isAdmin && (
                                <p className="text-[10px] font-bold text-primary mb-0.5">
                                  {activeThread.customerName}
                                </p>
                              )}

                              {m.attachment_url && (
                                <div className="mb-1.5">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}

                              {m.message && <p className="whitespace-pre-wrap break-words">{m.message}</p>}

                              <div
                                className={
                                  'flex items-center justify-end gap-1 mt-1 text-[9px] ' +
                                  (isAdmin ? 'text-primary-foreground/75' : 'text-muted-foreground')
                                }
                              >
                                <span>{format(new Date(m.created_at), 'h:mm a')}</span>
                                {isAdmin && (
                                  m.read_at ? (
                                    <CheckCheck className="w-3 h-3 text-sky-200" />
                                  ) : (
                                    <Check className="w-3 h-3 text-primary-foreground/60" />
                                  )
                                )}
                              </div>
                            </div>

                            {!isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleMessage(m.id)}
                                title="Delete message"
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-destructive rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Bottom Composer */}
              <div className="p-3 border-t border-border/50 bg-card shrink-0">
                {attachment && (
                  <div className="flex items-center justify-between bg-muted/60 px-3 py-1 rounded-xl mb-2 text-xs">
                    <span className="truncate text-foreground font-medium flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-primary" /> {attachment.name}
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
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
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
                    placeholder="Type a reply as DATA360 Support..."
                    className="min-h-[40px] max-h-[120px] resize-none rounded-xl bg-muted/40 border-border/50 text-xs py-2 px-3 leading-relaxed"
                  />
                  <Button
                    type="submit"
                    disabled={(!replyText.trim() && !attachment) || sending}
                    className="h-9 w-9 rounded-full p-0 flex items-center justify-center bg-primary text-primary-foreground shadow-xs"
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
