import { Badge } from '@/components/ui/badge';
import { User, UserX, Zap, Hand, Share2, Globe, Store } from 'lucide-react';

/* ─── Store source ─── */
export const StoreBadge = ({ name, slug }: { name?: string | null; slug?: string | null }) => (
  <Badge
    variant="outline"
    className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold"
    style={{ background: '#F0FDF4', color: '#166534', borderColor: '#22C55E' }}
    title={slug ? `Store: ${name || slug} (/${slug})` : undefined}
  >
    <Store className="w-2.5 h-2.5" /> {name || slug || 'Store'}
  </Badge>
);

/* ─── Buyer Type ─── */
export const BuyerTypeBadge = ({
  buyerType,
  affiliateCode,
  storeSlug,
  storeName,
}: {
  buyerType: string;
  affiliateCode?: string;
  storeSlug?: string | null;
  storeName?: string | null;
}) => {
  // Mutually exclusive source: Store > Guest > Customer
  const source = storeSlug
    ? <StoreBadge name={storeName} slug={storeSlug} />
    : buyerType === 'guest'
      ? (
        <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: '#FFF7ED', color: '#9A3412', borderColor: '#F97316' }}>
          <UserX className="w-2.5 h-2.5" /> Guest
        </Badge>
      )
      : (
        <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: '#1E293B', color: '#F8FAFC', borderColor: '#334155' }}>
          <User className="w-2.5 h-2.5" /> Customer
        </Badge>
      );
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {source}
      {affiliateCode && <AffiliateBadge code={affiliateCode} />}
    </div>
  );
};

/* ─── Fulfillment Mode ─── */
export const FulfillmentModeBadge = ({ mode }: { mode: string }) => {
  if (mode === 'api') {
    return (
      <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: '#0891B2', color: '#FFFFFF', borderColor: '#0891B2' }}>
        <Zap className="w-2.5 h-2.5" /> API
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: '#FAF5EF', color: '#7C2D12', borderColor: '#C2410C' }}>
      <Hand className="w-2.5 h-2.5" /> Manual
    </Badge>
  );
};

/* ─── Source / Affiliate ─── */
export const AffiliateBadge = ({ code }: { code: string }) => (
  <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: '#FCE7F3', color: '#9D174D', borderColor: '#EC4899' }}>
    <Share2 className="w-2.5 h-2.5" /> {code}
  </Badge>
);

export const DirectBadge = () => (
  <Badge variant="outline" className="text-[9px] gap-0.5 px-1.5 py-0.5 font-semibold" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', borderColor: 'hsl(var(--primary))' }}>
    <Globe className="w-2.5 h-2.5" /> Direct
  </Badge>
);
