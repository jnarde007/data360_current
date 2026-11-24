import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, LifeBuoy, Paperclip, X } from 'lucide-react';

const CATEGORIES = [
  'Order delayed',
  'Order failed',
  'Wrong bundle received',
  'Wallet top-up issue',
  'Payment issue',
  'Refund issue',
  'Account issue',
  'Other',
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
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
  defaultCategory,
  relatedOrderId,
  relatedOrderShortId,
  relatedWalletTransactionId,
  onCreated,
}: CreateTicketDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getInitialSubject = () => {
    if (relatedOrderShortId) return `Issue with order ${relatedOrderShortId}`;
    if (relatedWalletTransactionId) return 'Wallet top-up issue';
    return '';
  };

  const [subject, setSubject] = useState(getInitialSubject);
  const [category, setCategory] = useState(defaultCategory || '');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('medium');
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const CATEGORY_SUBJECTS: Record<string, string> = {
    'Order delayed': 'My order is taking too long',
    'Order failed': 'My order failed to process',
    'Wrong bundle received': 'I received the wrong data bundle',
    'Wallet top-up issue': 'Issue with my wallet top-up',
    'Payment issue': 'Problem with my payment',
    'Refund issue': 'I need a refund',
    'Account issue': 'Issue with my account',
  };

  const handleCategoryChange = (val: string) => {
    setCategory(val);
    if (!subjectTouched && !relatedOrderShortId && !relatedWalletTransactionId) {
      setSubject(CATEGORY_SUBJECTS[val] || '');
    }
  };

  const isFormValid = subject.trim().length >= 3 && category && message.trim();

  const resetForm = () => {
    setSubject(getInitialSubject());
    setCategory(defaultCategory || '');
    setMessage('');
    setPriority('medium');
    setAttachment(null);
    setSubjectTouched(false);
  };

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
    if (!user?.id || !isFormValid) return;

    setSubmitting(true);
    try {
      const customerId = user.role === 'customer' ? user.id : null;
      if (!customerId) {
        toast.error('Customer ID not found');
        return;
      }

      let attachmentUrl: string | null = null;

      // Upload attachment if present
      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const path = `${customerId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('support-attachments')
          .upload(path, attachment);
        if (uploadErr) {
          console.warn('Attachment upload failed, submitting without it:', uploadErr.message);
        } else {
          const { data: urlData } = supabase.storage
            .from('support-attachments')
            .getPublicUrl(path);
          attachmentUrl = urlData?.publicUrl || null;
        }
      }

      const insertData: Record<string, any> = {
        customer_id: customerId,
        subject: subject.trim(),
        category,
        message: message.trim(),
        priority,
      };

      if (relatedOrderId) insertData.related_order_id = relatedOrderId;
      if (relatedWalletTransactionId) insertData.related_wallet_transaction_id = relatedWalletTransactionId;

      const { data, error } = await supabase
        .from('support_tickets')
        .insert(insertData as any)
        .select('id, short_id')
        .single();
      if (error) throw error;

      // If attachment was uploaded, add it as the first message
      if (attachmentUrl && data) {
        await supabase.from('support_messages').insert({
          ticket_id: data.id,
          sender_id: customerId,
          sender_role: 'customer',
          message: '[Attachment]',
          attachment_url: attachmentUrl,
        } as any);
      }

      toast.success('Support ticket created successfully');
      resetForm();
      onOpenChange(false);
      onCreated?.();

      // Navigate to the ticket thread
      if (data?.id) {
        navigate('/support', { state: { openTicketId: data.id } });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" style={{ borderRadius: 'var(--card-radius-lg)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" />
            Report an Issue
          </DialogTitle>
          <DialogDescription>
            Describe your issue and we'll get back to you as soon as possible.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Brief summary of the issue"
              value={subject}
              onChange={e => { setSubject(e.target.value); setSubjectTouched(true); }}
              required
              minLength={3}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {relatedOrderShortId && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              Related Order: <span className="font-semibold text-foreground">{relatedOrderShortId}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              placeholder="Describe the issue in detail..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground/60">
              Include order ID, phone number, network, and what went wrong.
            </p>
          </div>

          {/* Attachment */}
          <div className="space-y-1.5">
            <Label>Attachment <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            {attachment ? (
              <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-lg px-3 py-2">
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 text-foreground">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" />
                Attach screenshot or file
              </Button>
            )}
            <p className="text-[10px] text-muted-foreground/50">PNG, JPG, WebP, or PDF. Max 5 MB.</p>
          </div>

          {/* Expectation note */}
          <p className="text-[11px] text-muted-foreground/60 bg-muted/30 rounded-lg px-3 py-2">
            Our team will review your issue and respond as soon as possible.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !isFormValid}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit Ticket'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
