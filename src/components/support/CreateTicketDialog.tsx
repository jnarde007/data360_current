import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Paperclip, Headphones } from 'lucide-react';

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
  
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() && !attachment) {
      toast.error('Please enter a message');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Get customer record
      const { data: custData, error: custErr } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (custErr || !custData) {
        toast.error('Customer profile not found');
        return;
      }

      // 2. Get or create canonical chat
      const { data: ticketId, error: tktErr } = await supabase.rpc(
        'get_or_create_customer_chat',
        { p_customer_id: custData.id }
      );

      if (tktErr || !ticketId) {
        throw new Error('Could not access support conversation');
      }

      // 3. Upload attachment if present
      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const filePath = `${custData.id}/${Date.now()}.${ext}`;
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

      // 4. Construct formatted message
      let formattedMsg = '';
      if (relatedOrderShortId) {
        formattedMsg += `📦 Order Issue: #${relatedOrderShortId}\n`;
      } else if (relatedWalletTransactionId) {
        formattedMsg += `💳 Wallet Top-up Issue\n`;
      }
      formattedMsg += message.trim();

      // 5. Insert message into continuous thread
      const { error: msgErr } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: custData.id,
          sender_role: 'customer',
          message: formattedMsg,
          attachment_url: attachmentUrl,
        });

      if (msgErr) throw msgErr;

      toast.success('Message sent to support team');
      setMessage('');
      setAttachment(null);
      onOpenChange(false);
      onCreated?.();

      navigate('/support');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Headphones className="w-4 h-4" />
            </div>
            <DialogTitle className="text-base">
              {relatedOrderShortId ? `Report Order #${relatedOrderShortId}` : 'Message Live Support'}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Send a note directly to our support team. Your message will appear in your live chat.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Your Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what happened or how we can help..."
              rows={4}
              className="text-xs resize-none rounded-xl"
              required
            />
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => {
                if (e.target.files?.[0]) setAttachment(e.target.files[0]);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs rounded-lg gap-1.5"
            >
              <Paperclip className="w-3.5 h-3.5" />
              {attachment ? attachment.name.substring(0, 16) + '...' : 'Attach screenshot'}
            </Button>

            {attachment && (
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-destructive text-xs hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="text-xs rounded-xl"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Send to Support
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
