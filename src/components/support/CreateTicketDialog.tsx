import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, MessageSquare, Paperclip, X, Receipt } from 'lucide-react';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategory?: string;
  relatedOrderId?: string;
  relatedOrderShortId?: string;
  relatedWalletTransactionId?: string;
  onCreated?: () => void;
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  relatedOrderId,
  relatedOrderShortId,
  relatedWalletTransactionId,
  onCreated,
}: CreateTicketDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      if (relatedOrderShortId) {
        setSubject(`Inquiry on Order #${relatedOrderShortId}`);
      } else if (relatedWalletTransactionId) {
        setSubject('Wallet Top-up Inquiry');
      } else {
        setSubject('');
      }
      setMessage('');
      setAttachment(null);
    }
  }, [open, relatedOrderShortId, relatedWalletTransactionId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Only PNG, JPG, WebP, and PDF files are allowed');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File must be under 5 MB');
      return;
    }
    setAttachment(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !message.trim()) return;

    setSubmitting(true);
    try {
      const customerId = user.id;
      let attachmentUrl: string | null = null;

      if (attachment) {
        const ext = attachment.name.split('.').pop()?.toLowerCase() || 'bin';
        const uploadPath = `${customerId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(uploadPath, attachment);
        if (!uploadErr) {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(uploadPath);
          attachmentUrl = urlData?.publicUrl || null;
        }
      }

      const finalSubject = subject.trim() || (relatedOrderShortId ? `Order #${relatedOrderShortId}` : message.trim().slice(0, 35) + '...');

      const insertData: Record<string, any> = {
        customer_id: customerId,
        subject: finalSubject,
        category: relatedOrderShortId ? 'Order' : 'General',
        message: message.trim(),
        priority: 'medium',
      };

      if (relatedOrderId) insertData.related_order_id = relatedOrderId;
      if (relatedWalletTransactionId) insertData.related_wallet_transaction_id = relatedWalletTransactionId;

      const { data, error } = await supabase
        .from('support_tickets')
        .insert(insertData as any)
        .select('id, short_id')
        .single();
      if (error) throw error;

      if (attachmentUrl && data) {
        await supabase.from('support_messages').insert({
          ticket_id: data.id,
          sender_id: customerId,
          sender_role: 'customer',
          message: '[Attachment]',
          attachment_url: attachmentUrl,
        } as any);
      }

      toast.success('Message sent to Support');
      onOpenChange(false);
      onCreated?.();

      if (data?.id) {
        navigate('/support', { state: { openTicketId: data.id } });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            {relatedOrderShortId ? 'Message Support About Order' : 'Start a Conversation'}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Send a direct message to our support team. We reply as quickly as possible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {relatedOrderShortId && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-muted/60 border border-border/50 text-xs">
              <Receipt className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <span className="text-muted-foreground">Linked Order: </span>
                <span className="font-mono font-bold text-foreground">#{relatedOrderShortId}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-xs font-medium text-muted-foreground">
              Topic / Subject <span className="text-[10px] opacity-60">(Optional)</span>
            </Label>
            <Input
              id="subject"
              placeholder={relatedOrderShortId ? `Inquiry on #${relatedOrderShortId}` : "e.g. Question about delivery"}
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="h-9 text-xs rounded-xl"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message" className="text-xs font-medium">Your Message</Label>
            <Textarea
              id="message"
              placeholder="Type your message here..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              className="text-xs rounded-xl resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
            />
            {attachment ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-muted/50 border text-xs">
                <span className="truncate max-w-[240px] text-muted-foreground">{attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} className="text-destructive hover:opacity-80">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 h-8 text-xs rounded-xl text-muted-foreground"
              >
                <Paperclip className="w-3.5 h-3.5" /> Attach screenshot or file
              </Button>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-9 text-xs">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !message.trim()} size="sm" className="h-9 text-xs gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              Send Message
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
