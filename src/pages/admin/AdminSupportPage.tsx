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

  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const fetchThreads = useCallback(async () => {
    try {
      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('id, customer_id, updated_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      if (!tickets || tickets.length === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }

      const customerMap = new Map<string, string>();
      tickets.forEach(t => {
        if (!customerMap.has(t.customer_id)) {
          customerMap.set(t.customer_id, t.id);
        }
      });

      const customerIds = Array.from(customerMap.keys());
      const { data: profiles } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')
        .in('id', customerIds);

      const profileLookup = new Map((profiles || []).map(p => [p.id, p]));

      const threadResults: CustomerThread[] = await Promise.all(
        customerIds.map(async (cid) => {
          const tid = customerMap.get(cid)!;
          const profile = profileLookup.get(cid);

          const { data: msgs } = await supabase
            .from('support_messages')
            .select('message, created_at, sender_role, read_at')
            .eq('ticket_id', tid)
            .order('created_at', { ascending: false })
            .limit(15);

          const lastMsg = msgs && msgs[0];
          const unread = (msgs || []).filter(
            m => m.sender_role === 'customer' && !m.read_at
          ).length;

          return {
            ticketId: tid,
            customerId: cid,
            customerName: profile?.full_name || 'Customer',
            customerEmail: profile?.email || 'No email',
            customerPhone: profile?.phone || '',
            lastMessage: lastMsg?.message || 'Started a conversation',
            lastMessageTime: lastMsg?.created_at || new Date().toISOString(),
            unreadCount: unread,
          };
        })
      );

      setThreads(threadResults);

      const targetTicket = searchParams.get('chat') || threadResults[0]?.ticketId;
      if (targetTicket && !activeTicketId) {
        setActiveTicketId(targetTicket);
      }
    } catch (err: any) {
      console.error('Error fetching admin threads:', err);
    } finally {
      setLoading(false);
    }
  }, [searchParams, activeTicketId]);

  const fetchMessages = useCallback(async (ticketId: string, smoothScroll = false) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);

      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'admin'
      });

      setThreads(prev => prev.map(t => t.ticketId === ticketId ? { ...t, unreadCount: 0 } : t));
      setTimeout(() => scrollToBottom(smoothScroll), 60);
    } catch (err: any) {
      console.error('Error loading messages:', err);
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
        fetchMessages(activeTicketId, true);
      }
      fetchThreads();
    },
    'admin-support-chat'
  );

  const handleSelectThread = (ticketId: string) => {
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

    try {
      if (attachment) {
        const ext = attachment.name.split('.').pop() || 'bin';
        const filePath = `admin/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, attachment);

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

      setMessages(prev => [...prev, newMsg as Message]);
      setReplyText('');
      setAttachment(null);
      if (textareaRef.current) textareaRef.current.style.height = '40px';
      setTimeout(() => scrollToBottom(true), 50);

      setThreads(prev => prev.map(t => {
        if (t.ticketId === activeTicketId) {
          return {
            ...t,
            lastMessage: text || 'Attachment sent',
            lastMessageTime: new Date().toISOString()
          };
        }
        return t;
      }));
    } catch (err: any) {
      toast({
        title: 'Failed to send reply',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!activeTicketId) return;
    setClearing(true);
    try {
      const { error } = await supabase.rpc('admin_clear_chat_history', {
        p_ticket_id: activeTicketId
      });
      if (error) throw error;

      setMessages([]);
      setClearDialogOpen(false);
      toast({ title: 'Chat cleared', description: 'Customer conversation history removed.' });
      fetchThreads();
    } catch (err: any) {
      toast({ title: 'Clear failed', description: err.message, variant: 'destructive' });
    } finally {
      setClearing(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
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
      <div className="w-full h-[calc(100dvh-5rem)] flex bg-background rounded-2xl border border-border/50 overflow-hidden shadow-sm">
        {/* Left: Customer List */}
        <aside
          className={`${
            activeTicketId ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r border-border/50 bg-card/60 shrink-0`}
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
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === 'all' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('unread')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filter === 'unread' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                  }`}
                >
                  Unread
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customers..."
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted/40 border border-border/40 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/30">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-xs flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading chats...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No customer conversations found.
              </div>
            ) : (
              filteredThreads.map((t) => {
                const isSelected = t.ticketId === activeTicketId;
                return (
                  <button
                    key={t.ticketId}
                    type="button"
                    onClick={() => handleSelectThread(t.ticketId)}
                    className={`w-full text-left p-3 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0 uppercase">
                      {t.customerName.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-foreground text-xs truncate">
                          {t.customerName}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                          {t.lastMessageTime ? format(new Date(t.lastMessageTime), 'HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{t.lastMessage}</p>
                    </div>
                    {t.unreadCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                        {t.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right: Active Chat */}
        <section
          className={`${
            activeTicketId ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col h-full bg-muted/10 overflow-hidden`}
        >
          {activeThread ? (
            <>
              {/* Header */}
              <div className="h-14 px-4 bg-card border-b border-border/50 flex items-center justify-between shrink-0 shadow-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBackToList}
                    className="md:hidden h-8 w-8 rounded-full"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
                    {activeThread.customerName.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground text-xs truncate">
                      {activeThread.customerName}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {activeThread.customerEmail} {activeThread.customerPhone && (' • ' + activeThread.customerPhone)}
                    </p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setClearDialogOpen(true)}
                      className="text-destructive focus:text-destructive gap-2 text-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Clear Chat History
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Messages Container */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-xs gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                    No messages yet.
                  </div>
                ) : (
                  Object.entries(groupedMessages).map(([dateKey, msgs]) => (
                    <div key={dateKey} className="space-y-3">
                      <div className="flex justify-center my-2">
                        <span className="px-3 py-1 rounded-full text-[10px] font-medium bg-card text-muted-foreground shadow-xs border border-border/40">
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
                              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs break-words ${
                                isAdmin
                                  ? 'bg-primary text-primary-foreground rounded-br-xs'
                                  : 'bg-card text-foreground border border-border/50 rounded-bl-xs'
                              }`}
                            >
                              {!isAdmin && (
                                <p className="text-[10px] font-semibold text-primary mb-1">
                                  {activeThread.customerName}
                                </p>
                              )}
                              {m.attachment_url && (
                                <div className="mb-2 rounded-lg overflow-hidden">
                                  <AttachmentRenderer url={m.attachment_url} />
                                </div>
                              )}
                              <p className="whitespace-pre-wrap leading-relaxed select-text">{m.message}</p>
                              <div
                                className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                                  isAdmin ? 'text-primary-foreground/75' : 'text-muted-foreground'
                                }`}
                              >
                                <span>{m.created_at ? format(new Date(m.created_at), 'HH:mm') : ''}</span>
                                {isAdmin && (
                                  m.read_at ? (
                                    <CheckCheck className="w-3 h-3 text-sky-200" />
                                  ) : (
                                    <Check className="w-3 h-3 opacity-80" />
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
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div className="p-2.5 bg-card border-t border-border/50 shrink-0">
                {attachment && (
                  <div className="flex items-center justify-between bg-muted/70 px-3 py-1 rounded-lg mb-2 text-xs">
                    <span className="truncate flex items-center gap-1.5 text-foreground font-medium">
                      <Paperclip className="w-3.5 h-3.5 text-primary" /> {attachment.name}
                    </span>
                    <button type="button" onClick={() => setAttachment(null)}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <form onSubmit={handleSendMessage} className="flex items-end gap-2 max-w-4xl mx-auto">
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
                    className="h-9 w-9 rounded-full text-muted-foreground"
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
                    placeholder="Type an admin reply..."
                    className="min-h-[38px] max-h-[120px] resize-none rounded-2xl bg-muted/40 border-border/50 text-xs py-2 px-3 leading-relaxed"
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

              {/* Clear History Dialog */}
              <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear Chat History?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove all messages for this customer conversation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearHistory}
                      disabled={clearing}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {clearing ? 'Clearing...' : 'Clear History'}
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
