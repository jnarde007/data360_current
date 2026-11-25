import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import { 
  Loader2, Send, Paperclip, MessageSquare, Trash2, 
  ExternalLink, CheckCheck, RefreshCw, Headphones, Calendar
} from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

interface Message {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
  attachment_url: string | null;
  read_at: string | null;
  created_at: string;
}

function formatChatDateBadge(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 0 && diffDays < 6) return format(date, 'EEEE');
  return format(date, 'MMM d, yyyy');
}

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((instant = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' });
  }, []);

  const initChat = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data: custData } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!custData) return;

      const { data: canonicalTicketId } = await supabase.rpc(
        'get_or_create_customer_chat',
        { p_customer_id: custData.id }
      );

      if (canonicalTicketId) {
        setTicketId(canonicalTicketId);
      } else {
        const { data: tkt } = await supabase
          .from('support_tickets')
          .select('id')
          .eq('customer_id', custData.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (tkt?.id) setTicketId(tkt.id);
      }
    } catch (err: any) {
      console.error('Error initializing support chat:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { initChat(); }, [initChat]);

  const loadMessages = useCallback(async (tId: string) => {
    try {
      setMessagesLoading(true);
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', tId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as Message[]);

      // Snap to bottom immediately on chat open
      setTimeout(() => scrollToBottom(true), 30);
      setTimeout(() => scrollToBottom(true), 150);

      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: tId,
        p_reader_role: 'customer'
      });
    } catch (err: any) {
      console.error('Error loading messages:', err);
    } finally {
      setMessagesLoading(false);
    }
  }, [scrollToBottom]);

  useEffect(() => {
    if (ticketId) loadMessages(ticketId);
  }, [ticketId, loadMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!ticketId) return;

    const channel = supabase
      .channel(`customer-chat-${ticketId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(() => scrollToBottom(false), 50);

          if (newMsg.sender_role === 'admin') {
            supabase.rpc('mark_support_messages_read', {
              p_ticket_id: ticketId,
              p_reader_role: 'customer'
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            setMessages((prev) => prev.filter((m) => m.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId, scrollToBottom]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!replyText.trim() && !attachment) || !ticketId || sending) return;

    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const filePath = `${user?.id || 'cust'}/${Date.now()}.${ext}`;
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

      const { data: custData } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user?.id)
        .maybeSingle();

      const senderId = custData?.id || user?.id || 'customer';

      const { error: insertErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: senderId,
          sender_role: 'customer',
          message: replyText.trim() || (attachmentUrl ? '[Attachment]' : ''),
          attachment_url: attachmentUrl,
        });

      if (insertErr) throw insertErr;

      setReplyText('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err: any) {
      toast({ title: 'Message failed', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      setDeletingId(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));

      const { error: rpcErr } = await supabase.rpc('delete_support_message', {
        p_message_id: messageId
      });

      if (rpcErr) {
        await supabase.from('support_messages').delete().eq('id', messageId);
      }
      toast({ title: 'Message deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Could not delete message', variant: 'destructive' });
      if (ticketId) loadMessages(ticketId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <CustomerLayout>
      <div className="max-w-4xl mx-auto h-[calc(100vh-8.5rem)] min-h-[500px] flex flex-col bg-background rounded-2xl border shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b bg-card/80 backdrop-blur-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                <Headphones className="w-5 h-5" />
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Data360 Live Support</h2>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Support Team • Online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => ticketId && loadMessages(ticketId)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title="Refresh messages"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <a
              href="https://wa.me/233538804961"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
            >
              WhatsApp Support
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Message Container with Auto-Scroll to Bottom */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 p-4 md:p-6 overflow-y-auto bg-muted/20 space-y-3"
        >
          {loading || messagesLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs">Connecting to support chat...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-medium text-foreground mb-1">Welcome to Data360 Support</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Have a question about an order, bundle, or top-up? Send us a message below and our team will assist you shortly.
              </p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.sender_role === 'customer';
              const currentDate = new Date(msg.created_at);
              const prevDate = index > 0 ? new Date(messages[index - 1].created_at) : null;
              const showDateBadge = !prevDate || !isSameDay(currentDate, prevDate);

              return (
                <div key={msg.id} className="space-y-3">
                  {/* SMS / WhatsApp Centered Date Badge */}
                  {showDateBadge && (
                    <div className="flex justify-center my-4 select-none">
                      <div className="px-3.5 py-1 rounded-full bg-slate-200/90 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold shadow-xs border border-border/50 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-primary" />
                        <span>{formatChatDateBadge(currentDate)}</span>
                      </div>
                    </div>
                  )}

                  {/* Message Row with Delete ALWAYS ON THE LEFT of the bubble */}
                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1`}>
                    <div className="flex items-center gap-2 max-w-[85%] sm:max-w-[75%]">
                      {/* Delete Icon on the LEFT */}
                      {isMe && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          disabled={deletingId === msg.id}
                          className="p-1.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-full transition-all shrink-0"
                          title="Delete message"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                          isMe
                            ? 'bg-primary text-primary-foreground rounded-br-xs'
                            : 'bg-card text-card-foreground border border-border/60 rounded-bl-xs'
                        }`}
                      >
                        {/* Blue Sender Name for Incoming Messages */}
                        {!isMe && (
                          <div className="text-xs font-bold text-sky-600 dark:text-sky-400 mb-1">
                            Data360 Support
                          </div>
                        )}

                        <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.message}</p>

                        {msg.attachment_url && (
                          <div className="mt-2">
                            <AttachmentRenderer url={msg.attachment_url} />
                          </div>
                        )}

                        {/* Stamped Date & Time inside bubble */}
                        <div
                          className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] select-none ${
                            isMe ? 'text-primary-foreground/75' : 'text-muted-foreground'
                          }`}
                        >
                          <span>
                            {isToday(currentDate) ? format(currentDate, 'h:mm a') : format(currentDate, 'MMM d, h:mm a')}
                          </span>
                          {isMe && (
                            <CheckCheck
                              className={`w-3.5 h-3.5 ${msg.read_at ? 'text-sky-300' : 'opacity-60'}`}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachment preview */}
        {attachment && (
          <div className="px-4 py-2 bg-muted/40 border-t flex items-center justify-between text-xs">
            <span className="truncate max-w-xs font-medium text-foreground">📎 {attachment.name}</span>
            <button
              onClick={() => {
                setAttachment(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              ✕ Remove
            </button>
          </div>
        )}

        {/* Composer */}
        <form onSubmit={handleSendMessage} className="p-3 bg-card border-t flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,application/pdf"
            onChange={(e) => {
              if (e.target.files?.[0]) setAttachment(e.target.files[0]);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-muted/50 border border-input/60 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-all"
          />

          <button
            type="submit"
            disabled={(!replyText.trim() && !attachment) || sending}
            className="p-2.5 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
            title="Send"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </CustomerLayout>
  );
}
