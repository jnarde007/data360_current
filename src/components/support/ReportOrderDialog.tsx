import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/StatusBadge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, LifeBuoy, Paperclip, X, Smartphone, Package, Hash, CircleDollarSign } from 'lucide-react';
import { formatPhoneSpaced, getNetworkAccent } from '@/lib/network-colors';
import { formatGHS } from '@/lib/mock-data';

export interface ReportableOrder {
  id: string;
  short_id: string;
  network: string;
  bundle_size: string;
  recipient_phone: string;
  total_amount: number | string;
  status: string;
}

interface ReportOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: ReportableOrder | null;
  onSubmitted?: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export function ReportOrderDialog({
  open,
  onOpenChange,
  order,
  onSubmitted,
}: ReportOrderDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  if (!order) return null;

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
      const customerId = user.role === 'customer' ? user.id : null;
      if (!customerId) {
        toast.error('Customer ID not found. Please log in.');
        return;
      }

      let attachmentUrl: string | null = null;
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const path = `${customerId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(path, attachment);
        if (uploadErr) {
          console.warn('Attachment upload failed:', uploadErr.message);
        } else {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(path);
          attachmentUrl = urlData?.publicUrl || null;
        }
      }

      const subject = `Issue with Order ${order.short_id} (${order.network} ${order.bundle_size})`;
      const formattedMessage = `Order: ${order.short_id}\nNetwork: ${order.network}\nBundle: ${order.bundle_size}\nRecipient: ${order.recipient_phone}\nStatus: ${order.status}\n\nCustomer Note:\n${message.trim()}`;

      // Insert support ticket
      const { data, error } = await supabase
        .from('support_tickets')
        .insert({
          customer_id: customerId,
          subject,
          category: 'Order delayed',
          priority: 'medium',
          message: formattedMessage,
          related_order_id: order.id,
        } as any)
        .select('id, short_id')
        .single();

      if (error) throw error;

      // Also insert into support_messages so it is immediately visible in chat thread
      if (data?.id) {
        await supabase.from('support_messages').insert({
          ticket_id: data.id,
          sender_id: customerId,
          sender_role: 'customer',
          message: formattedMessage,
          attachment_url: attachmentUrl,
        } as any);
      }

      toast.success('Report submitted successfully! Opening chat...');
      setMessage('');
      setAttachment(null);
      onOpenChange(false);
      onSubmitted?.();

      if (data?.id) {
        navigate(`/support?ticket=${data.id}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  const accent = getNetworkAccent(order.network);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-5 sm:p-6" style={{ borderRadius: 'var(--card-radius-lg, 1rem)' }}>
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-display">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <LifeBuoy className="w-4 h-4" />
            </div>
            Report an Order Issue
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
            Tell us what happened with this order and we'll resolve it right away.
          </DialogDescription>
        </DialogHeader>

        {/* Order Details Card */}
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 space-y-2.5 my-1">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
              {order.network} · {order.bundle_size}
            </span>
            <StatusBadge status={order.status} />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Hash className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
              <span className="font-mono text-foreground font-medium">{order.short_id}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CircleDollarSign className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
              <span className="text-foreground font-semibold tabular-nums">{formatGHS(Number(order.total_amount))}</span>
            </div>
            <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
              <Smartphone className="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
              <span className="font-mono text-foreground">{formatPhoneSpaced(order.recipient_phone)}</span>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="report-msg" className="text-xs font-medium text-foreground">
              What is the issue? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="report-msg"
              placeholder="e.g. Recipient has not received data, or bundle delivery failed..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              required
              className="resize-none text-xs sm:text-sm"
              autoFocus
            />
          </div>

          {/* Attachment Preview / Button */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />

            {attachment ? (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/60 text-xs">
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 font-medium">{attachment.name}</span>
                <span className="text-muted-foreground text-[10px]">
                  ({(attachment.size / 1024).toFixed(0)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground -ml-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" />
                Attach screenshot / receipt (optional)
              </Button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-9 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !message.trim()}
              className="h-9 text-xs gap-1.5 gradient-primary text-primary-foreground border-0"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <LifeBuoy className="w-3.5 h-3.5" />
                  Submit Report & Open Chat
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
