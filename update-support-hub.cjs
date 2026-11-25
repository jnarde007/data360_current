const fs = require('fs');
const path = require('path');

// 1. UPDATE FLOATING WHATSAPP / HELP BUTTON (src/components/FloatingWhatsApp.tsx)
const floatingPath = path.join(__dirname, 'src', 'components', 'FloatingWhatsApp.tsx');
let floatingCode = fs.readFileSync(floatingPath, 'utf8');

if (!floatingCode.includes('useNavigate')) {
  floatingCode = floatingCode.replace(
    "import { MessageCircle, X, Headphones, Users } from 'lucide-react';",
    "import { MessageCircle, X, Headphones, Users, MessageSquare } from 'lucide-react';\nimport { useNavigate } from 'react-router-dom';"
  );
}

if (!floatingCode.includes('const navigate = useNavigate();')) {
  floatingCode = floatingCode.replace(
    'export function FloatingWhatsApp() {\n  const [open, setOpen] = useState(false);',
    'export function FloatingWhatsApp() {\n  const navigate = useNavigate();\n  const [open, setOpen] = useState(false);'
  );
}

const liveChatButton = `                {/* Live On-Site Chat */}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('/support?new=true');
                  }}
                  className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] group min-w-[200px] text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Live Support Chat</p>
                    <p className="text-[10px] text-muted-foreground">Chat with us on-site</p>
                  </div>
                </button>
`;

if (!floatingCode.includes('Live Support Chat')) {
  floatingCode = floatingCode.replace(
    '{open && (\n              <motion.div\n                initial={{ opacity: 0, y: 12, scale: 0.9 }}\n                animate={{ opacity: 1, y: 0, scale: 1 }}\n                exit={{ opacity: 0, y: 12, scale: 0.9 }}\n                transition={{ duration: 0.2 }}\n                className="flex flex-col gap-2 mb-2"\n              >',
    `{open && (\n              <motion.div\n                initial={{ opacity: 0, y: 12, scale: 0.9 }}\n                animate={{ opacity: 1, y: 0, scale: 1 }}\n                exit={{ opacity: 0, y: 12, scale: 0.9 }}\n                transition={{ duration: 0.2 }}\n                className="flex flex-col gap-2 mb-2"\n              >\n${liveChatButton}`
  );
}

fs.writeFileSync(floatingPath, floatingCode, 'utf8');
console.log('SUCCESS: src/components/FloatingWhatsApp.tsx updated with Live Support Chat option.');


// 2. UPDATE CREATE TICKET DIALOG (src/components/support/CreateTicketDialog.tsx)
const dialogPath = path.join(__dirname, 'src', 'components', 'support', 'CreateTicketDialog.tsx');

const newDialogCode = `import { useState, useRef } from 'react';
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
import { Loader2, MessageSquare, Paperclip, X, Send } from 'lucide-react';

const CATEGORIES = [
  'General Enquiry',
  'Order assistance',
  'Wallet top-up issue',
  'Payment issue',
  'Agent / Super Agent enquiry',
  'Feedback & Suggestions',
  'Report an Issue',
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
    if (relatedOrderShortId) return \`Issue with order \${relatedOrderShortId}\`;
    if (relatedWalletTransactionId) return 'Wallet top-up issue';
    return '';
  };

  const [subject, setSubject] = useState(getInitialSubject);
  const [category, setCategory] = useState(defaultCategory || 'General Enquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);

  const isFormValid = message.trim().length >= 2;

  const resetForm = () => {
    setSubject(getInitialSubject());
    setCategory(defaultCategory || 'General Enquiry');
    setMessage('');
    setAttachment(null);
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

      if (attachment) {
        const ext = attachment.name.split('.').pop();
        const path = \`\${customerId}/\${Date.now()}.\${ext}\`;
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

      const finalSubject = subject.trim() || (category ? \`\${category}: \${message.trim().slice(0, 35)}...\` : 'Support Enquiry');

      const insertData: Record<string, any> = {
        customer_id: customerId,
        subject: finalSubject,
        category: category || 'General Enquiry',
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

      toast.success('Message sent! Our support team will reply shortly.');
      resetForm();
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
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="w-5 h-5" />
            </div>
            Chat with Support
          </DialogTitle>
          <DialogDescription>
            Have a question, need help with an order, or want to make an enquiry? Send us a message and we'll reply right here in your chat.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">What can we help you with?</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-10 text-sm rounded-xl">
                <SelectValue placeholder="Select a topic" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-xs font-semibold">
              Subject <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="subject"
              placeholder="e.g. Question about bundles or delivery"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={200}
              className="h-10 text-sm rounded-xl"
            />
          </div>

          {relatedOrderShortId && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              Related Order: <span className="font-semibold text-foreground">{relatedOrderShortId}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message" className="text-xs font-semibold">Message</Label>
            <Textarea
              id="message"
              placeholder="Type your message or enquiry here..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              required
              rows={4}
              maxLength={2000}
              className="text-sm rounded-xl resize-none"
            />
          </div>

          {/* Attachment */}
          <div className="space-y-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            {attachment ? (
              <div className="flex items-center gap-2 text-xs bg-muted/50 rounded-lg px-3 py-2 border border-border/50">
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
                className="gap-1.5 text-xs rounded-lg h-8"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-3.5 h-3.5" />
                Attach screenshot or file (optional)
              </Button>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !isFormValid} className="rounded-xl gap-2 px-5 bg-blue-600 hover:bg-blue-700 text-white">
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Start Chat
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
`;

fs.writeFileSync(dialogPath, newDialogCode, 'utf8');
console.log('SUCCESS: src/components/support/CreateTicketDialog.tsx updated.');


// 3. UPDATE SUPPORT PAGE TO AUTO-OPEN FROM FLOATING BUTTON (src/pages/SupportPage.tsx)
const supportPagePath = path.join(__dirname, 'src', 'pages', 'SupportPage.tsx');
let supportPageCode = fs.readFileSync(supportPagePath, 'utf8');

if (!supportPageCode.includes("searchParams.get('new') === 'true'")) {
  const targetHook = "  // Deep-link: auto-open ticket from ?ticket= param";
  const newAutoOpenHook = `  // Auto-open new chat dialog if ?new=true
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Deep-link: auto-open ticket from ?ticket= param`;

  supportPageCode = supportPageCode.replace(targetHook, newAutoOpenHook);
  fs.writeFileSync(supportPagePath, supportPageCode, 'utf8');
  console.log('SUCCESS: src/pages/SupportPage.tsx updated with ?new=true trigger.');
}
