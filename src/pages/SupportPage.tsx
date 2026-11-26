import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerLayout } from '@/components/CustomerLayout';
import { supabase } from '@/integrations/supabase/client';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentRenderer } from '@/components/support/AttachmentRenderer';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Send, LifeBuoy, Paperclip, X,
  MessageSquare, CheckCheck, Check, Clock
} from 'lucide-react';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

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

interface ChatThread {
  id: string;
  short_id: string;
  subject: string;
  created_at: string;
  updated_at: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

function formatDateDivider(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d, yyyy');
}

export default function SupportPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Fetch threads (consolidated)
  const fetchThreads = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: ticketData, error } = await supabase
        .from('support_tickets')
        .select('id, short_id, subject, created_at, updated_at')
        .eq('customer_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      if (!ticketData || ticketData.length === 0) {
        // Create initial default chat for this customer if none exists
        const { data: newTicket, error: createErr } = await supabase
          .from('support_tickets')
          .insert({
            customer_id: user.id,
            subject: 'Customer Support',
            category: 'Other',
            message: 'Hello, how can we help you today?',
            priority: 'medium',
          } as any)
          .select('id, short_id, subject, created_at, updated_at')
          .single();

        if (!createErr && newTicket) {
          setThreads([{
            id: newTicket.id,
            short_id: newTicket.short_id,
            subject: newTicket.subject || 'Support Conversation',
            created_at: newTicket.created_at,
            updated_at: newTicket.updated_at,
            unreadCount: 0,
            lastMessage: 'Hello, how can we help you today?',
            lastMessageTime: newTicket.created_at,
          }]);
          setActiveTicketId(newTicket.id);
          setSearchParams({ chat: newTicket.id }, { replace: true });
        }
        setLoading(false);
        return;
      }

      // Fetch unread count & last message for each ticket
      const threadsWithInfo: ChatThread[] = await Promise.all(
        ticketData.map(async (t) => {
          const { data: lastMsgs } = await supabase
            .from('support_messages')
            .select('message, created_at, sender_role, read_at')
            .eq('ticket_id', t.id)
            .order('created_at', { ascending: false })
            .limit(10);

          const lastMsg = lastMsgs && lastMsgs[0];
          const unread = (lastMsgs || []).filter(
            m => m.sender_role === 'admin' && !m.read_at
          ).length;

          return {
            id: t.id,
            short_id: t.short_id,
            subject: t.subject || 'Support Conversation',
            created_at: t.created_at,
            updated_at: t.updated_at,
            lastMessage: lastMsg?.message || 'Chat started',
            lastMessageTime: lastMsg?.created_at || t.updated_at,
            unreadCount: unread,
          };
        })
      );

      setThreads(threadsWithInfo);

      const targetId = searchParams.get('chat') || threadsWithInfo[0]?.id;
      if (targetId) {
        setActiveTicketId(targetId);
        if (!searchParams.has('chat')) {
          setSearchParams({ chat: targetId }, { replace: true });
        }
      }
    } catch (err: any) {
      console.error('Error fetching threads:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, searchParams, setSearchParams]);

  // Fetch messages in active ticket & mark read
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

      // Mark unread messages as read in DB
      await supabase.rpc('mark_support_messages_read', {
        p_ticket_id: ticketId,
        p_reader_role: 'customer'
      });

      // Update local thread unread badge
      setThreads(prev => prev.map(t => t.id === ticketId ? { ...t, unreadCount: 0 } : t));

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

  const handleSelectThread = (threadId: string) => {
    setActiveTicketId(threadId);
    setSearchParams({ chat: threadId });
  };

  const handleBackToList = () => {
    setActiveTicketId(null);
    setSearchParams({});
  };

  // Auto-grow textarea up to max 120px
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
        const filePath = `${user.id}/${Date.now()}.${ext}`;
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
          sender_role: 'customer',
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

      // Update thread last message
      setThreads(prev => prev.map(t => t.id === activeTicketId ? {
        ...t,
        lastMessage: replyText.trim() || '[Attachment]',
        lastMessageTime: new Date().toISOString()
      } : t));

      setTimeout(() => scrollToBottom(true), 60);
    } catch (err: any) {
      toast({
        title: 'Failed to send message',
        description: err.message || 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  // Group messages by date
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

  const activeThread = threads.find(t => t.id === activeTicketId);

  return (
    <CustomerLayout>
      {/* Outer container: fills available height without extra page margins */}
      <div className="w-full h-[calc(100dvh-64px)] lg:h-[calc(100dvh-96px)] flex bg-background rounded-2xl border border-border/40 overflow-hidden shadow-sm">
        
        {/* Left Side: Conversation List (Desktop always visible, Mobile hidden if active chat) */}
        <aside
          className={`${
            activeTicketId ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r border-border/40 bg-card/60 shrink-0`}
        >
          {/* List Header */}
          <div className="p-4 border-b border-border/40 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground text-base">Live Support</h2>
              <p className="text-xs text-muted-foreground">Conversations with our team</p>
            </div>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" title="Support Online" />
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/20">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading chat...
              </div>
            ) : threads.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No conversations yet. Send a message to start!
              </div>
            ) : (
              threads.map((t) => {
                const isSelected = t.id === activeTicketId;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelectThread(t.id)}
                    className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                      D360
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-medium text-foreground text-sm truncate">
                          {t.subject}
                        </span>
                        {t.lastMessageTime && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {format(new Date(t.lastMessageTime), 'p')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate leading-relaxed">
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

        {/* Right Side: Active Conversation (WhatsApp Style) */}
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
                  {/* Back button (Mobile only) */}
                  <button
                    onClick={handleBackToList}
                    className="md:hidden p-1.5 -ml-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                    D360
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate leading-tight">
                      DATA360 Support
                    </h3>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Customer Service • Online
                    </p>
                  </div>
                </div>
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
                    <p className="text-sm font-medium">Your chat history is clear</p>
                    <p className="text-xs mt-1">Send a message below and our support team will reply promptly.</p>
                  </div>
                ) : (
                  groupedMessages.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-3">
                      {/* WhatsApp Date Divider */}
                      <div className="flex justify-center my-2">
                        <span className="text-[11px] font-medium text-muted-foreground bg-card/90 border border-border/40 px-3 py-1 rounded-full shadow-2xs">
                          {formatDateDivider(group.date)}
                        </span>
                      </div>

                      {/* Bubbles */}
                      {group.items.map((msg) => {
                        const isMe = msg.sender_role === 'customer';
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
                              {/* Incoming Header */}
                              {!isMe && (
                                <p className="text-[11px] font-semibold text-primary mb-1">
                                  DATA360 Support
                                </p>
                              )}

                              {/* Message Text */}
                              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                {msg.message}
                              </p>

                              {/* Attachment */}
                              {msg.attachment_url && (
                                <div className="mt-2">
                                  <AttachmentRenderer url={msg.attachment_url} />
                                </div>
                              )}

                              {/* Timestamp + Status Tick */}
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

              {/* Bottom WhatsApp-Style Composer */}
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
                    placeholder="Type a message..."
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
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
              <LifeBuoy className="w-12 h-12 mb-3 opacity-30 text-primary" />
              <p className="font-semibold text-foreground">Select a conversation</p>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Choose a chat from the left panel to message support.
              </p>
            </div>
          )}
        </section>
      </div>
    </CustomerLayout>
  );
}
