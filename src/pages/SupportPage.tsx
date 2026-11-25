import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams } from 'react-router-dom';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, ArrowLeft, Send, LifeBuoy, Paperclip, FileText, Image as ImageIcon, X, Search, MessageSquare, CheckCheck, Clock } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface Ticket {
  id: string;
  short_id: string;
  subject: string;
  category: string;
  message: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  related_order_id: string | null;
  related_wallet_transaction_id: string | null;
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

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'active' | 'resolved' | 'all'>('active');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [relatedOrderShortId, setRelatedOrderShortId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadTickets = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('customer_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setTickets((data as Ticket[]) || []);
    } catch (err: any) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useRealtimeRefresh(['support_tickets', 'support_messages'], () => {
    loadTickets();
    if (selectedTicket) {
      loadMessages(selectedTicket.id);
    }
  });

  const loadMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data as Message[]) || []);
      setTimeout(scrollToBottom, 100);
    } catch (err: any) {
      console.error('Failed to load messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  };

  const openTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setRelatedOrderShortId(null);
    loadMessages(ticket.id);

    if (ticket.related_order_id) {
      try {
        const { data } = await supabase
          .from('orders')
          .select('short_id')
          .eq('id', ticket.related_order_id)
          .maybeSingle();
        if (data?.short_id) setRelatedOrderShortId(data.short_id);
      } catch (err) {
        console.error('Failed to fetch related order:', err);
      }
    }
  };

  useEffect(() => {
    const ticketId = searchParams.get('ticket');
    if (ticketId && tickets.length > 0 && !selectedTicket) {
      const found = tickets.find(t => t.id === ticketId);
      if (found) {
        openTicket(found);
        setSearchParams({}, { replace: true });
      }
    }
    if (searchParams.get('new') === 'true') {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tickets, selectedTicket]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB', variant: 'destructive' });
      return;
    }
    setAttachment(file);
  };

  const uploadAttachment = async (): Promise<string | null> => {
    if (!attachment || !user) return null;
    setUploading(true);
    try {
      const ext = attachment.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('support-attachments')
        .upload(path, attachment);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('support-attachments')
        .getPublicUrl(path);
      return publicUrl;
    } catch (err: any) {
      console.error('Failed to upload attachment:', err);
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || !selectedTicket || !user || sending) return;

    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        attachmentUrl = await uploadAttachment();
        if (!attachmentUrl && !replyText.trim()) {
          setSending(false);
          return;
        }
      }

      const { error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: selectedTicket.id,
          sender_id: user.id,
          sender_role: 'customer',
          message: replyText.trim() || '[Attachment]',
          attachment_url: attachmentUrl,
        });

      if (error) throw error;

      await supabase
        .from('support_tickets')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', selectedTicket.id);

      setReplyText('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadMessages(selectedTicket.id);
      loadTickets();
    } catch (err: any) {
      toast({ title: 'Error sending message', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const reopenTicket = async () => {
    if (!selectedTicket) return;
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', selectedTicket.id);
      if (error) throw error;
      setSelectedTicket({ ...selectedTicket, status: 'open' });
      loadTickets();
      toast({ title: 'Ticket reopened' });
    } catch (err: any) {
      toast({ title: 'Error reopening ticket', description: err.message, variant: 'destructive' });
    }
  };

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const matchesSearch =
        t.subject.toLowerCase().includes(search.toLowerCase()) ||
        t.short_id.toLowerCase().includes(search.toLowerCase()) ||
        t.message.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;
      if (tab === 'active') return t.status !== 'resolved' && t.status !== 'closed';
      if (tab === 'resolved') return t.status === 'resolved' || t.status === 'closed';
      return true;
    });
  }, [tickets, search, tab]);

  const counts = useMemo(() => {
    const active = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
    const resolved = tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length;
    return { active, resolved };
  }, [tickets]);

  const canReply = selectedTicket?.status !== 'closed';
  const canReopen = selectedTicket?.status === 'resolved' || selectedTicket?.status === 'closed';

  return (
    <CustomerLayout>
      <div className="space-y-4 pb-20 md:pb-0">
        {/* Header (hidden on mobile when thread is open) */}
        <div className={`${selectedTicket ? 'hidden md:flex' : 'flex'} items-center justify-between gap-3`}>
          <div>
            <h1 className="text-xl md:text-2xl font-display font-bold text-foreground">Support Messages</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Chat directly with customer service for help and enquiries</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0 rounded-xl">
            <Plus className="w-4 h-4" /> New Message
          </Button>
        </div>

        {/* Unified Chat Container (Split view down to md screen width) */}
        <div className="md:grid md:grid-cols-[minmax(270px,320px)_1fr] lg:grid-cols-[minmax(310px,360px)_1fr] md:gap-4 md:items-start">
          
          {/* ── LEFT PANE: Inbox list ── */}
          <div className={`${selectedTicket ? 'hidden md:block' : 'block'} space-y-2.5 md:sticky md:top-20`}>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
              <Input
                placeholder="Search chats..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-10 text-xs rounded-xl bg-card border-border/60"
              />
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted/60 border border-border/40">
              {([['active', 'Active', counts.active], ['resolved', 'Resolved', counts.resolved], ['all', 'All', tickets.length]] as const).map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`h-7 rounded-lg text-xs font-medium transition-all ${
                    tab === key
                      ? 'bg-background text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label} <span className="ml-0.5 text-[10px] opacity-70">({n})</span>
                </button>
              ))}
            </div>

            {/* Chat List Items */}
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-border/60 bg-card/40 p-5">
                <LifeBuoy className="w-9 h-9 mx-auto text-muted-foreground/40 mb-2.5" />
                <p className="text-xs font-medium text-muted-foreground">
                  {tickets.length === 0 ? 'No conversations yet' : 'No chats found'}
                </p>
                <Button onClick={() => setCreateOpen(true)} size="sm" variant="outline" className="mt-3 gap-1.5 text-xs rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Start a Chat
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-14rem)] overflow-y-auto pr-0.5">
                {filteredTickets.map(t => {
                  const active = selectedTicket?.id === t.id;
                  const initial = t.subject.trim().charAt(0).toUpperCase() || 'S';
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left rounded-xl p-3 transition-all flex items-start gap-3 border ${
                        active
                          ? 'bg-primary/10 border-primary/40 shadow-sm'
                          : 'bg-card border-border/50 hover:bg-muted/40 hover:border-border'
                      }`}
                    >
                      {/* Avatar initial */}
                      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-primary/15 text-primary border border-primary/20'
                      }`}>
                        {initial}
                      </div>

                      {/* Content preview */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p className="text-xs font-semibold text-foreground truncate">{t.subject}</p>
                          <span className="text-[10px] text-muted-foreground/70 shrink-0 font-medium">
                            {formatDistanceToNow(new Date(t.updated_at), { addSuffix: false })}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 leading-snug">
                          {t.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground">
                            {t.short_id}
                          </span>
                          <span className="text-[10px] capitalize text-muted-foreground/60">{t.category}</span>
                          {t.status === 'resolved' && (
                            <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                              <CheckCheck className="w-3 h-3" /> Resolved
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT PANE: Conversation Thread ── */}
          <div className={`${selectedTicket ? 'block' : 'hidden md:block'} rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm flex flex-col h-[calc(100vh-10rem)] min-h-[500px]`}>
            {selectedTicket ? (
              <>
                {/* Slim Header */}
                <div className="px-4 py-3 border-b border-border/50 bg-muted/20 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => { setSelectedTicket(null); setMessages([]); setRelatedOrderShortId(null); }}
                      className="md:hidden h-8 w-8 rounded-lg shrink-0 -ml-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div className="w-8 h-8 rounded-full bg-primary/15 text-primary border border-primary/20 flex items-center justify-center font-bold text-xs shrink-0">
                      {selectedTicket.subject.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xs md:text-sm font-semibold text-foreground truncate">{selectedTicket.subject}</h2>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{selectedTicket.short_id}</span>
                        {relatedOrderShortId && (
                          <span className="text-primary font-medium">· Order: {relatedOrderShortId}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={selectedTicket.status} />
                    {canReopen && (
                      <Button variant="outline" size="sm" onClick={reopenTicket} className="h-7 text-[11px] px-2.5 rounded-lg">
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>

                {/* Message Scroll Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
                  {/* First Ticket Description Message */}
                  <div className="flex justify-end mb-2">
                    <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-br-sm px-3.5 py-2.5 bg-primary/15 border border-primary/20 text-foreground shadow-sm">
                      <p className="text-xs whitespace-pre-wrap leading-relaxed">{selectedTicket.message}</p>
                      <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-muted-foreground/80 font-medium">
                        <span>{format(new Date(selectedTicket.created_at), 'h:mm a')}</span>
                        <CheckCheck className="w-3 h-3 text-primary" />
                      </div>
                    </div>
                  </div>

                  {/* Replies Thread */}
                  {messagesLoading ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                  ) : (
                    messages.map(m => {
                      const isCustomer = m.sender_role === 'customer';
                      return (
                        <div key={m.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-sm text-xs ${
                              isCustomer
                                ? 'rounded-br-sm bg-primary/15 border border-primary/20 text-foreground'
                                : 'rounded-bl-sm bg-card border border-border/60 text-foreground'
                            }`}
                          >
                            {!isCustomer && (
                              <p className="text-[10px] font-bold text-primary mb-1">Support Team</p>
                            )}
                            {m.attachment_url && (
                              <div className="mb-2">
                                <AttachmentRenderer url={m.attachment_url} />
                              </div>
                            )}
                            {m.message && m.message !== '[Attachment]' && (
                              <p className="whitespace-pre-wrap leading-relaxed">{m.message}</p>
                            )}
                            <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-muted-foreground/80 font-medium">
                              <span>{format(new Date(m.created_at), 'h:mm a')}</span>
                              {isCustomer && <CheckCheck className="w-3 h-3 text-primary" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Modern Pill Composer */}
                {canReply ? (
                  <form onSubmit={handleSend} className="p-2.5 border-t border-border/50 bg-card shrink-0">
                    {attachment && (
                      <div className="flex items-center justify-between gap-2 px-3 py-1.5 mb-2 rounded-lg bg-muted/50 border border-border/40 text-xs text-muted-foreground">
                        <span className="truncate flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5 text-primary" /> {attachment.name}
                        </span>
                        <button type="button" onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,.pdf"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground shrink-0"
                        title="Add attachment"
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <Input
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        placeholder="Type a message..."
                        className="h-10 text-xs rounded-full bg-muted/40 border-border/50 px-4 focus-visible:ring-1"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={sending || (!replyText.trim() && !attachment)}
                        className="h-10 w-10 rounded-full shrink-0 shadow-sm"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="p-3 text-center text-xs text-muted-foreground border-t border-border/40 bg-muted/20">
                    This ticket is closed. Click "Reopen" at the top to continue the chat.
                  </div>
                )}
              </>
            ) : (
              /* Empty state placeholder when no chat is selected on desktop */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
                  <MessageSquare className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Select a conversation</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Choose a chat on the left to read and reply, or start a new enquiry.
                </p>
                <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm" className="mt-4 gap-1.5 text-xs rounded-xl">
                  <Plus className="w-3.5 h-3.5" /> Start New Chat
                </Button>
              </div>
            )}
          </div>

        </div>

        <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadTickets} />
      </div>
    </CustomerLayout>
  );
}
