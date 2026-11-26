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
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
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
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unread'>('all');

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

  // Fetch threads aggregated per customer
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

      // Group tickets by customer (one continuous thread per customer)
      const customerMap = new Map<string, string>(); // customerId -> primaryTicketId
      tickets.forEach(t => {
        if (!customerMap.has(t.customer_id)) {
          customerMap.set(t.customer_id, t.id);
        }
      });

      const customerIds = Array.from(customerMap.keys());

      // Fetch customer details
      const { data: profiles } = await supabase
        .from('customers')
        .select('id, full_name, email, phone')
        .in('id', customerIds);

      const profileLookup = new Map((profiles || []).map(p => [p.id, p]));

      const threadResults: CustomerThread[] = await Promise.all(
        customerIds.map(async (cid) => {
          const tid = customerMap.get(cid)!;
          const profile = profileLookup.get(cid);

          // Get last 15 messages for preview & unread count
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
      if (targetTicket) {
        setActiveTicketId(targetTicket);
        if (!searchParams.has('chat')) {
          setSearchParams({ chat: targetTicket }, { replace: true });
        }
      }
    } catch (err: any) {
      console.error('Error fetching admin threads:', err);
    } finally {
      setLoading(false);
    }
  }, [searchParams, setSearchParams]);

  // Fetch messages for active ticket & mark customer messages read
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

      // Mark unread messages as read in database
      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'admin'
      });

      // Clear local unread badge
      setThreads(prev => prev.map(t => t.ticketId === ticketId ? { ...t, unreadCount: 0 } : t));

      setTimeout(() => scrollToBottom(smoothScroll), 60);
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

  useRealtimeRefresh(() => {
    if (activeTicketId) {
      fetchMessages(activeTicketId, true);
    }
  }, 'support_messages');

  const handleSelectThread = (ticketId: string) => {
    setActiveTicketId(ticketId);
    setSearchParams({ chat: ticketId });
  };

  const handleBackToList = () => {
    setActiveTicketId(null);
    setSearchParams({});
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || !activeTicketId || !user?.id || sending) return;

    setSending(true);
    try {
      let attachmentUrl: string | null = null;

      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const filePath = `admin/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(filePath, attachment);

        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(filePath);
          attachmentUrl = urlData?.publicUrl || null;
        }
      }

      const { data: newMsg, error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: user.id,
          sender_role: 'admin',
          message: replyText.trim() || (attachment ? '[Attachment]' : ''),
          attachment_url: attachmentUrl,
        } as any)
        .select()
        .single();

      if (error) throw error;

      setMessages(prev => [...prev, newMsg as Message]);
      setReplyText('');
      setAttachment(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      // Update local thread preview
      setThreads(prev => prev.map(t => t.ticketId === activeTicketId ? {
        ...t,
        lastMessage: replyText.trim() || '[Attachment]',
        lastMessageTime: new Date().toISOString()
      } : t));

      setTimeout(() => scrollToBottom(true), 60);
    } catch (err: any) {
      toast({
        title: 'Failed to send reply',
        description: err.message,
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
      setThreads(prev => prev.map(t => t.ticketId === activeTicketId ? {
        ...t,
        lastMessage: 'Chat history cleared',
        unreadCount: 0
      } : t));

      toast({ title: 'Chat history cleared' });
      setClearDialogOpen(false);
    } catch (err: any) {
      toast({
        title: 'Failed to clear chat',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setClearing(false);
    }
  };

  const filteredThreads = useMemo(() => {
    return threads.filter(t => {
      const matchesSearch =
        t.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.customerPhone && t.customerPhone.includes(searchQuery));
      if (!matchesSearch) return false;
      if (filterMode === 'unread') return t.unreadCount > 0;
      return true;
    });
  }, [threads, searchQuery, filterMode]);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; items: Message[] }[] = [];
    messages.forEach((msg) => {
      const dateStr = msg.created_at;
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && isSameDay(new Date(lastGroup.items[0].created_at), new Date(dateStr))) {
        lastGroup.items.push(msg);
      } else {
        groups.push({ date: dateStr, items: [msg] });
      }
    });
    return groups;
  }, [messages]);

  const activeThread = threads.find(t => t.ticketId === activeTicketId);

  return (
    <AdminLayout>
      <div className="w-full h-[calc(100dvh-64px)] lg:h-[calc(100dvh-96px)] flex bg-background rounded-2xl border border-border/40 overflow-hidden shadow-sm">
        
        {/* Left Sidebar: Customer List */}
        <aside
          className={`${
            activeTicketId ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r border-border/40 bg-card/60 shrink-0`}
        >
          {/* Header & Search */}
          <div className="p-3.5 border-b border-border/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-base">Customer Chats</h2>
              <div className="flex rounded-lg bg-muted/60 p-0.5 text-xs">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filterMode === 'all' ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterMode('unread')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    filterMode === 'unread' ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground'
                  }`}
                >
                  Unread
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, phone..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-muted/40 border border-border/40 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/20">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading chats...
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No chats found
              </div>
            ) : (
              filteredThreads.map((t) => {
                const isSelected = t.ticketId === activeTicketId;
                const initials = t.customerName
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'CU';

                return (
                  <button
                    key={t.ticketId}
                    onClick={() => handleSelectThread(t.ticketId)}
                    className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-foreground text-sm truncate">
                          {t.customerName}
                        </span>
                        {t.lastMessageTime && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {format(new Date(t.lastMessageTime), 'p')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/75 truncate mb-0.5">
                        {t.customerEmail}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.lastMessage}
                      </p>
                    </div>
                    {t.unreadCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {t.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Area: Conversation Pane */}
        <section
          className={`${
            !activeTicketId ? 'hidden md:flex' : 'flex'
          } flex-1 flex-col h-full bg-muted/10 min-w-0 relative`}
        >
          {activeTicketId && activeThread ? (
            <>
              {/* WhatsApp-Style Top Header */}
              <div className="h-14 px-3 md:px-4 border-b border-border/40 bg-card/80 backdrop-blur flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={handleBackToList}
                    className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                    {activeThread.customerName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate leading-tight">
                      {activeThread.customerName}
                    </h3>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {activeThread.customerEmail} {activeThread.customerPhone && • activeThread.customerPhone}
                    </p>
                  </div>
                </div>

                {/* Options Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setClearDialogOpen(true)}
                      className="text-destructive focus:text-destructive flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Clear Chat History
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Scrollable Message Area */}
              <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4">
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 mb-2 opacity-40 text-primary" />
                    <p className="text-sm font-medium">No messages in this chat</p>
                    <p className="text-xs mt-1">Send a message below to reach this customer.</p>
                  </div>
                ) : (
                  groupedMessages.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-3">
                      {/* Date Divider */}
                      <div className="flex justify-center my-2">
                        <span className="text-[11px] font-medium text-muted-foreground bg-card/90 border border-border/40 px-3 py-1 rounded-full shadow-2xs">
                          {formatDateDivider(group.date)}
                        </span>
                      </div>

                      {/* Bubbles */}
                      {group.items.map((msg) => {
                        const isMe = msg.sender_role === 'admin';
                        return (
                          <div
                            key={msg.id}
                            className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3.5 py-2.5 shadow-2xs relative ${
                                isMe
                                  ? 'bg-primary text-primary-foreground rounded-br-xs'
                                  : 'bg-card text-card-foreground border border-border/40 rounded-bl-xs'
                              }`}
                            >
                              {!isMe && (
                                <p className="text-[11px] font-semibold text-primary mb-1">
                                  {activeThread.customerName}
                                </p>
                              )}

                              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                {msg.message}
                              </p>

                              {msg.attachment_url && (
                                <div className="mt-2">
                                  <AttachmentRenderer url={msg.attachment_url} />
                                </div>
                              )}

                              <div
                                className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                                  isMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
                                }`}
                              >
                                <span>{format(new Date(msg.created_at), 'p')}</span>
                                {isMe && (
                                  msg.read_at ? (
                                    <CheckCheck className="w-3.5 h-3.5 text-emerald-300" />
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
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div className="p-2 md:p-3 bg-card border-t border-border/40 shrink-0">
                {attachment && (
                  <div className="flex items-center justify-between bg-muted/60 px-3 py-1.5 rounded-lg mb-2 text-xs">
                    <span className="truncate text-foreground font-medium flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-primary" />
                      {attachment.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleSendMessage}
                  className="flex items-end gap-1.5 md:gap-2 max-w-4xl mx-auto"
                >
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
                    className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Paperclip className="w-5 h-5" />
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
                    className="min-h-[40px] max-h-[120px] resize-none rounded-2xl bg-muted/40 border-border/50 text-sm py-2 px-3.5 focus-visible:ring-1 leading-relaxed"
                  />

                  <Button
                    type="submit"
                    disabled={(!replyText.trim() && !attachment) || sending}
                    className="h-10 w-10 shrink-0 rounded-full p-0 flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 ml-0.5" />
                    )}
                  </Button>
                </form>
              </div>

              {/* Clear History Confirmation Dialog */}
              <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear Chat History?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove all messages for this customer conversation. This action cannot be undone.
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
              <LifeBuoy className="w-12 h-12 mb-3 opacity-30 text-primary" />
              <p className="font-semibold text-foreground">Select a customer</p>
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
