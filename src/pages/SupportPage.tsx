import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { CreateTicketDialog } from '@/components/support/CreateTicketDialog';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, Headphones, RefreshCw, Paperclip, Flag, CheckCheck } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

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

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const loadMessages = useCallback(async (tId: string) => {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', tId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as Message[]);

      requestAnimationFrame(() => {
        scrollToBottom(true);
        setTimeout(() => scrollToBottom(true), 60);
        setTimeout(() => scrollToBottom(true), 250);
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [scrollToBottom]);

  const loadChat = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: tickets, error: tErr } = await supabase
        .from('support_tickets')
        .select('id, created_at')
        .eq('customer_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1);

      if (tErr) throw tErr;

      if (tickets && tickets.length > 0) {
        const tId = tickets[0].id;
        setTicketId(tId);
        await loadMessages(tId);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [user, loadMessages]);

  useEffect(() => {
    loadChat();
  }, [loadChat]);

  // Realtime messages
  useEffect(() => {
    if (!ticketId) return;
    const channel = supabase
      .channel(`customer-chat-${ticketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${ticketId}`,
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
  }, [ticketId, scrollToBottom]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 5MB.', variant: 'destructive' });
      return;
    }
    setAttachment(file);
  };

  const sendReply = async () => {
    if ((!replyText.trim() && !attachment) || !user) return;
    setSending(true);

    try {
      let activeTId = ticketId;
      if (!activeTId) {
        const { data: newTicket, error: tErr } = await supabase
          .from('support_tickets')
          .insert({
            customer_id: user.id,
            subject: 'Support Chat',
            category: 'Other',
            priority: 'medium',
            status: 'open',
            message: replyText.trim() || 'Started a conversation',
          } as any)
          .select()
          .single();

        if (tErr) throw tErr;
        activeTId = newTicket.id;
        setTicketId(activeTId);
      }

      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop()?.toLowerCase() || 'bin';
        const path = `customer/${activeTId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('support-attachments').upload(path, attachment);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('support-attachments').getPublicUrl(path);
        attachmentUrl = urlData.publicUrl;
      }

      const { data: newMsg, error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTId,
          sender_id: user.id,
          sender_role: 'customer',
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
      toast({ title: 'Failed to send', description: 'Could not send message. Please retry.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

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
    <CustomerLayout>
      <div className="max-w-4xl mx-auto space-y-2">
        {/* Compact Support Header */}
        <div className="flex items-center justify-between px-1 py-1">
          <div>
            <h1 className="text-lg sm:text-xl font-bold font-display text-foreground leading-tight">Live Support</h1>
            <p className="text-[11px] text-muted-foreground">Chat directly with the support team</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-8 px-2.5 text-xs gap-1.5 rounded-lg border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/5 hover:bg-amber-500/10"
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Report Order</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => ticketId && loadMessages(ticketId)}
              className="h-8 w-8 text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Chat Window */}
        <Card className="flex flex-col h-[calc(100dvh-10.5rem)] min-h-[460px] rounded-2xl overflow-hidden border-border/60 shadow-xs">
          {/* Chat Messages */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/5">
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                <Headphones className="w-10 h-10 mb-2 opacity-30 text-primary" />
                <p className="text-sm font-medium text-foreground">Welcome to Live Support</p>
                <p className="text-xs max-w-xs mt-1">Send a message below and our team will assist you immediately.</p>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isOut = m.sender_role === 'customer';
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
                            Data360 Support
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
            {attachment && (
              <div className="mb-2 p-1.5 px-3 bg-muted rounded-lg text-xs flex items-center justify-between text-muted-foreground">
                <span className="truncate max-w-[200px]">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} className="text-destructive text-xs font-semibold hover:underline">Remove</button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*,.pdf" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground"
                title="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Input
                placeholder="Type your message..."
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
        </Card>

        <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => ticketId && loadMessages(ticketId)} />
      </div>
    </CustomerLayout>
  );
}
