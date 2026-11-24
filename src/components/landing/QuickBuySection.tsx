import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatGHS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Loader2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import mtnLogo from '@/assets/mtn-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import atLogo from '@/assets/at-logo.png';

const NETWORK_LOGOS: Record<string, string> = { MTN: mtnLogo, Telecel: telecelLogo, AirtelTigo: atLogo };

const NETWORKS = ['MTN', 'Telecel', 'AirtelTigo'] as const;
const MAX_CARDS = 6;

const NETWORK_COLORS: Record<string, { header: string; badge: string; tab: string; tabActive: string }> = {
  MTN: {
    header: 'from-yellow-400 to-amber-500',
    badge: 'bg-yellow-100/80 text-yellow-800',
    tab: 'hover:bg-yellow-400/10 text-white/70',
    tabActive: 'bg-yellow-400 text-yellow-950 shadow-md',
  },
  Telecel: {
    header: 'from-red-500 to-rose-600',
    badge: 'bg-red-100/80 text-red-700',
    tab: 'hover:bg-red-500/10 text-white/70',
    tabActive: 'bg-red-500 text-white shadow-md',
  },
  AirtelTigo: {
    header: 'from-blue-500 to-cyan-500',
    badge: 'bg-primary text-primary-foreground',
    tab: 'hover:bg-blue-500/10 text-white/70',
    tabActive: 'bg-primary text-primary-foreground shadow-md',
  },
};

interface PriceItem {
  size: string;
  price: number;
  network: string;
}

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.05 } } };

function parseSizeGB(size: string): number {
  const match = size.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  return match[2].toUpperCase() === 'MB' ? val / 1024 : val;
}

export default function QuickBuySection({ affiliateCode }: { affiliateCode: string }) {
  const [activeNetwork, setActiveNetwork] = useState<string>('MTN');
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('public_price_items')
      .select('size, price, network')
      .then(({ data }) => {
        if (data) {
          setPrices(data.filter((d) => d.size && d.price != null && d.network) as PriceItem[]);
        }
        setLoading(false);
      });
  }, []);

  const filteredPrices = useMemo(() => {
    return prices
      .filter((p) => p.network === activeNetwork)
      .sort((a, b) => parseSizeGB(a.size) - parseSizeGB(b.size))
      .slice(0, MAX_CARDS);
  }, [prices, activeNetwork]);

  const buildBuyLink = (item: PriceItem) => {
    const params = new URLSearchParams({
      network: item.network,
      bundle: item.size,
    });
    if (affiliateCode) params.set('ref', affiliateCode);
    return `/guest-buy?${params.toString()}`;
  };

  const viewAllLink = affiliateCode ? `/guest-buy?ref=${encodeURIComponent(affiliateCode)}` : '/guest-buy';

  const colors = NETWORK_COLORS[activeNetwork] || NETWORK_COLORS.MTN;
  const fmtSize = (s: string) => {
    const up = s.toUpperCase();
    return /GB|MB/i.test(up) ? up : `${up}GB`;
  };

  return (
    <section className="pt-0 pb-8 lg:pt-0 lg:pb-14 relative">
      {/* OR separator */}
      <div className="flex items-center justify-center gap-4 w-full max-w-[240px] mx-auto pb-6 sm:pb-8 relative z-10">
        <div className="flex-1 h-px bg-white/20" />
        <span className="text-sm sm:text-base text-white/50 tracking-widest font-semibold uppercase">or</span>
        <div className="flex-1 h-px bg-white/20" />
      </div>
      {/* Dark overlay for contrast */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      <div className="container mx-auto px-4 max-w-5xl relative z-10">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger} className="text-center mb-5">
          <motion.h2 variants={fadeUp} className="text-lg sm:text-2xl lg:text-3xl font-display font-bold text-white">
            Choose a Bundle
          </motion.h2>
        </motion.div>

        {/* Network tabs */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {NETWORKS.map((net) => {
            const c = NETWORK_COLORS[net];
            const isActive = activeNetwork === net;
            return (
              <button
                key={net}
                onClick={() => setActiveNetwork(net)}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${isActive ? c.tabActive : c.tab}`}
              >
                {net}
              </button>
            );
          })}
        </div>

        {/* Cards */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-white/60" />
          </div>
        ) : filteredPrices.length === 0 ? (
          <p className="text-center text-white/50 py-12 text-sm">No bundles available for {activeNetwork} right now.</p>
        ) : (
          <motion.div
            key={activeNetwork}
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4"
          >
            {filteredPrices.map((item) => (
              <motion.div
                key={`${item.network}-${item.size}`}
                variants={fadeUp}
                className="rounded-2xl overflow-hidden bg-white shadow-lg shadow-black/25 ring-1 ring-black/5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
              >
                {/* Header band */}
                <div className={`bg-gradient-to-r ${colors.header} px-4 py-3 flex items-center gap-3`}>
                  <div className="w-9 h-9 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center shrink-0">
                    <img src={NETWORK_LOGOS[activeNetwork]} alt={activeNetwork} className="w-5 h-5 rounded-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/80 block leading-none mb-0.5">
                      {activeNetwork}
                    </span>
                    <p className="text-xl sm:text-2xl font-display font-extrabold leading-none text-white drop-shadow-sm">
                      {fmtSize(item.size)}
                    </p>
                  </div>
                </div>

                {/* Body */}
                <div className="p-4 flex flex-col items-start gap-2">
                  <span className={`text-[8px] font-bold uppercase tracking-[0.15em] rounded-full px-2.5 py-0.5 opacity-75 ${colors.badge}`}>
                    {activeNetwork === 'MTN' ? 'EXPIRES IN 90 DAYS' : 'NEVER EXPIRES'}
                  </span>
                  <p className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                    {formatGHS(item.price)}
                  </p>
                  <Link to={buildBuyLink(item)} className="w-full mt-0.5">
                    <Button
                      size="sm"
                      className={`w-full h-9 text-xs font-bold rounded-lg bg-gray-900 hover:bg-gray-800 text-white shadow-md hover:shadow-lg transition-all ${
                        activeNetwork === 'MTN' ? 'hover:ring-2 hover:ring-yellow-400/30' :
                        activeNetwork === 'Telecel' ? 'hover:ring-2 hover:ring-red-400/30' :
                        'hover:ring-2 hover:ring-blue-400/30'
                      }`}
                    >
                      <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                      Buy Now
                    </Button>
                  </Link>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* View All CTA */}
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} className="text-center mt-6">
          <Link to={viewAllLink}>
            <Button
              size="default"
              className="h-10 px-6 text-xs sm:text-sm font-semibold bg-white/15 backdrop-blur-sm text-white border border-white/30 hover:bg-white/25 transition-all"
            >
              View More Bundles <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
