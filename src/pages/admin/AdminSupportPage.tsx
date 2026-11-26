import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Loader2, Send, Paperclip, Headphones, RefreshCw, Trash2, ArrowLeft, Search, CheckCheck
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

interface CustomerThread {
  ticket_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  last_message: string;
  last_time: string;
  unread_count: number;
}

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  created_at: string;
}

export default function AdminSupportPage() {
  const { toast } = useToast();
  const [threads, setThreads] = useState<CustomerThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<CustomerThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((instant = false) => {
    const container = chatContainerRef.current;
    if (container) {
      if (instant) {
        container.scrollTop = container.scrollHeight;
      } else {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' });
    }
  }, []);

  const openChat = async (thread: CustomerThread) => {
    setActiveTicketId(thread.ticket_id);
    setActiveCustomer(thread);
    setMessagesLoading(true);

    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', thread.ticket_id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as Message[]);

      try {
        await supabase.rpc('mark_support_messages_read', { p_ticket_id: thread.ticket_id, p_reader_role: 'admin' });
      } catch (_) {}

      setThreads(prev => prev.map(t => t.ticket_id === thread.ticket_id ? { ...t, unread_count: 0 } : t));

      requestAnimationFrame(() => {
        scrollToBottom(true);
        setTimeout(() => scrollToBottom(true), 60);
        setTimeout(() => scrollToBottom(true), 250);
      });
    } catch {
      // silent
    } finally {
      setMessagesLoading(false);
    }
  };

  const loadThreads = useCallback(async () => {
    try {
      const { data: tickets, error: tErr } = await supabase
        .from('support_tickets')
        .select('id, customer_id, updated_at, subject, status')
        .order('updated_at', { ascending: false });

      if (tErr) throw tErr;
      if (!tickets || tickets.length === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }

      const customerMap = new Map<string, any>();
      tickets.forEach(t => {
        if (!customerMap.has(t.customer_id)) {
          customerMap.set(t.customer_id, t);
        }
      });
      const uniqueTickets = Array.from(customerMap.values());
      const customerIds = uniqueTickets.map(t => t.customer_id);

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone')
        .in('id', customerIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const threadList: CustomerThread[] = await Promise.all(
        uniqueTickets.map(async (t) => {
          const prof = profileMap.get(t.customer_id);
          const { data: latestMsg } = await supabase
            .from('support_messages')
            .select('message, created_at')
            .eq('ticket_id', t.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const { count: unread } = await supabase
            .from('support_messages')
            .select('id', { count: 'exact', head: true })
            .eq('ticket_id', t.id)
            .eq('sender_role', 'customer')
            .is('read_at', null);

          return {
            ticket_id: t.id,
            customer_id: t.customer_id,
            customer_name: prof?.full_name || 'Customer',
            customer_email: prof?.email || '',
            customer_phone: prof?.phone || '',
            last_message: latestMsg?.message || 'Started a conversation',
            last_time: latestMsg?.created_at || t.updated_at,
            unread_count: unread || 0,
          };
        })
      );

      threadList.sort((a, b) => new Date(b.last_time).getTime() - new Date(a.last_time).getTime());
      setThreads(threadList);

      if (!activeTicketId && threadList.length > 0 && window.innerWidth >= 1024) {
        openChat(threadList[0]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [activeTicketId]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Realtime subscription
  useEffect(() => {
    if (!activeTicketId) return;
    const channel = supabase
      .channel(`admin-chat-${activeTicketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${activeTicketId}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => scrollToBottom(false), 50);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTicketId, scrollToBottom]);

  const sendReply = async () => {
    if ((!replyText.trim() && !attachment) || !activeTicketId) return;
    setSending(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      let attachmentUrl: string | null = null;

      if (attachment) {
        const ext = attachment.name.split('.').pop()?.toLowerCase() || 'bin';
        const path = `admin/${activeTicketId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('support-attachments').upload(path, attachment);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('support-attachments').getPublicUrl(path);
        attachmentUrl = urlData.publicUrl;
      }

      const { data: newMsg, error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicketId,
          sender_id: user?.id || 'admin',
          sender_role: 'admin',
          message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
          attachment_url: attachmentUrl,
        } as any)
        .select()
        .single();

      if (error) throw error;
      if (newMsg) {
        setMessages(prev => [...prev, newMsg as Message]);
      }
      setReplyText('');
      setAttachment(null);
      setTimeout(() => scrollToBottom(false), 40);
    } catch {
      toast({ title: 'Failed to send', description: 'Could not send reply.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  // CLEAR ENTIRE CHAT
  const handleClearWholeChat = async () => {
    if (!activeTicketId) return;
    setClearingChat(true);

    try {
      const { error } = await supabase
        .from('support_messages')
        .delete()
        .eq('ticket_id', activeTicketId);

      if (error) throw error;

      setMessages([]);
      setThreads(prev => prev.map(t => t.ticket_id === activeTicketId ? { ...t, last_message: 'Chat history cleared', unread_count: 0 } : t));
      toast({ title: 'Chat cleared', description: 'All messages for this customer have been permanently deleted.' });
      setDeleteConfirmOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Could not clear chat history.', variant: 'destructive' });
    } finally {
      setClearingChat(false);
    }
  };

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads.filter(t => {
      if (filter === 'unread' && t.unread_count === 0) return false;
      if (q && !t.customer_name.toLowerCase().includes(q) && !t.customer_phone.includes(q) && !t.customer_email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [threads, filter, search]);

  const formatDividerDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    const now = new Date();
    const diffDays = Math.abs(now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 7) {
      return format(d, 'EEEE');
    }
    return format(d, 'MMM d, yyyy');
  };

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-display text-foreground">Customer Chats</h1>
            <p className="text-xs text-muted-foreground">Live conversations with registered customers</p>
          </div>
          <Button variant="outline" size="sm" onClick={loadThreads} className="gap-1.5 h-8 text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>

        {/* Workspace */}
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr] gap-4 h-[calc(100vh-12rem)] min-h-[500px]">
          
          {/* Threads List */}
          <div className={`${activeTicketId ? 'hidden md:flex' : 'flex'} flex-col bg-card border border-border/60 rounded-2xl overflow-hidden shadow-2xs`}>
            <div className="p-3 border-b border-border/50 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search customer name, phone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-xs rounded-lg"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setFilter('all')}
                  className={`flex-1 py-1 text-xs rounded-md font-medium transition-colors ${filter === 'all' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  All ({threads.length})
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`flex-1 py-1 text-xs rounded-md font-medium transition-colors ${filter === 'unread' ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Unread ({threads.filter(t => t.unread_count > 0).length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-border/40">
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : visibleThreads.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted-foreground">No chats found</div>
              ) : (
                visibleThreads.map(t => {
                  const active = activeTicketId === t.ticket_id;
                  return (
                    <button
                      key={t.ticket_id}
                      onClick={() => openChat(t)}
                      className={`w-full text-left p-3 transition-colors flex items-start gap-2.5 ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                        {t.customer_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-semibold text-foreground truncate">{t.customer_name}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {format(new Date(t.last_time), 'h:mm a')}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{t.last_message}</p>
                      </div>
                      {t.unread_count > 0 && (
                        <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-1">
                          {t.unread_count}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Conversation Screen */}
          <div className={`${activeTicketId ? 'flex' : 'hidden md:flex'} flex-col bg-card border border-border/60 rounded-2xl overflow-hidden shadow-2xs`}>
            {activeTicketId && activeCustomer ? (
              <>
                {/* Header */}
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setActiveTicketId(null)}
                      className="md:hidden h-8 w-8 -ml-1.5 text-muted-foreground"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 font-bold flex items-center justify-center text-xs shrink-0">
                      {activeCustomer.customer_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground truncate">{activeCustomer.customer_name}</h2>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {activeCustomer.customer_phone || activeCustomer.customer_email || 'Customer'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Clear Entire Chat History */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="h-8 px-2.5 text-xs gap-1.5 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10"
                      title="Clear all messages for this customer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Clear Chat</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openChat(activeCustomer)}
                      className="h-8 w-8 text-muted-foreground"
                      title="Refresh"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Messages Container */}
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/5">
                  {messagesLoading ? (
                    <div className="flex justify-center items-center h-full">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                      <Headphones className="w-10 h-10 mb-2 opacity-30 text-primary" />
                      <p className="text-sm font-medium text-foreground">Chat is empty</p>
                      <p className="text-xs max-w-xs mt-1">No messages in this conversation yet.</p>
                    </div>
                  ) : (
                    messages.map((m, idx) => {
                      const isOut = m.sender_role === 'admin';
                      const showDate = idx === 0 || formatDividerDate(m.created_at) !== formatDividerDate(messages[idx - 1].created_at);

                      return (
                        <div key={m.id} className="space-y-3">
                          {showDate && (
                            <div className="flex justify-center my-2">
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border/40 shadow-2xs">
                                {formatDividerDate(m.created_at)}
                              </span>
                            </div>
                          )}

                          <div className={`flex w-full ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <div
                              className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 shadow-2xs text-sm ${
                                isOut
                                  ? 'bg-blue-600 text-white rounded-br-xs'
                                  : 'bg-card border border-border/60 text-foreground rounded-bl-xs'
                              }`}
                            >
                              {!isOut && (
                                <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 mb-0.5">
                                  {activeCustomer.customer_name}
                                </p>
                              )}
                              <p className="whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                              {m.attachment_url && <div className="mt-2"><AttachmentRenderer url={m.attachment_url} /></div>}
                              <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isOut ? 'text-white/70' : 'text-muted-foreground/70'}`}>
                                <span>{format(new Date(m.created_at), 'h:mm a')}</span>
                                {isOut && <CheckCheck className="w-3 h-3 text-white/90" />}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                <div className="p-3 bg-card border-t border-border/50 shrink-0">
                  <div className="flex items-center gap-2">
                    <input type="file" ref={fileInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) setAttachment(f); }} className="hidden" accept="image/*,.pdf" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Input
                      placeholder="Reply to customer..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                      className="h-10 text-sm rounded-full bg-muted/40 border-border/60 px-4 focus-visible:ring-1"
                    />
                    <Button
                      onClick={sendReply}
                      disabled={sending || (!replyText.trim() && !attachment)}
                      size="icon"
                      className="h-10 w-10 rounded-full shrink-0 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                <Headphones className="w-12 h-12 mb-3 opacity-30 text-primary" />
                <p className="text-sm font-medium text-foreground">Select a conversation</p>
                <p className="text-xs max-w-xs mt-1">Choose a customer chat from the list on the left to start replying.</p>
              </div>
            )}
          </div>
        </div>

        {/* Clear Whole Chat Confirmation Modal */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entire Chat History?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all messages exchanged with <strong>{activeCustomer?.customer_name}</strong>. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearingChat}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearWholeChat}
                disabled={clearingChat}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {clearingChat ? 'Deleting...' : 'Delete Entire Chat'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
