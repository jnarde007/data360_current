import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Search, GraduationCap, UserPlus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import mtnLogo from '@/assets/mtn-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import atLogo from '@/assets/at-logo.png';

const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.05 } } };

type Provider = {
  key: 'MTN' | 'Telecel' | 'AirtelTigo';
  name: string;
  tagline: string;
  logo: string;
  accentBg: string;
  borderHover: string;
  tagColor: string;
};

const PROVIDERS: Provider[] = [
  {
    key: 'MTN',
    name: 'MTN',
    tagline: 'Instant UP2U Delivery',
    logo: mtnLogo,
    accentBg: 'bg-yellow-400/90',
    borderHover: 'hover:border-yellow-400/50',
    tagColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  },
  {
    key: 'Telecel',
    name: 'Telecel',
    tagline: 'Direct Super-Fast Bundles',
    logo: telecelLogo,
    accentBg: 'bg-red-500',
    borderHover: 'hover:border-red-500/50',
    tagColor: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
  },
  {
    key: 'AirtelTigo',
    name: 'AirtelTigo',
    tagline: 'Big Time & Direct Bundles',
    logo: atLogo,
    accentBg: 'bg-primary',
    borderHover: 'hover:border-primary/50',
    tagColor: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
  },
];

export default function GuestNetworkPicker({ affiliateCode = '' }: { affiliateCode?: string }) {
  const buildLink = (network: string) => {
    const params = new URLSearchParams({ network });
    if (affiliateCode) params.set('ref', affiliateCode);
    return `/guest-buy?${params.toString()}`;
  };

  return (
    <section className="px-2 py-4 sm:py-6">
      <div className="container mx-auto max-w-md sm:max-w-2xl">
        {/* Section heading */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="text-center mb-5"
        >
          <h2 className="text-base sm:text-lg font-display font-bold text-foreground tracking-tight">
            Buy Without Creating an Account
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Select your preferred telecom network below.</p>
        </motion.div>

        {/* Network cards */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {PROVIDERS.map((p) => (
            <motion.div key={p.key} variants={fadeUp}>
              <Link to={buildLink(p.key)} className="block group h-full">
                <div className={`h-full flex sm:flex-col items-center sm:items-start justify-between gap-3 p-4 rounded-2xl bg-card border border-border ${p.borderHover} hover:shadow-md hover:-translate-y-0.5 transition-all`}>
                  <div className="flex items-center sm:flex-col sm:items-start gap-3 w-full">
                    <div className={`w-12 h-12 rounded-xl ${p.accentBg} flex items-center justify-center shrink-0 shadow-xs`}>
                      <img src={p.logo} alt={p.name} className="w-8 h-8 rounded-lg object-cover" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-bold text-foreground flex items-center gap-1.5">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {p.tagline}
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto pt-1 sm:pt-2 w-full flex items-center justify-end sm:justify-between text-xs font-semibold text-primary">
                    <span className="hidden sm:inline-block text-[11px] text-muted-foreground">Select network</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-primary group-hover:translate-x-0.5 transition-transform">
                      Buy Data <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* Track Transaction Bar */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="mt-5"
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 p-3.5 rounded-2xl bg-card/60 backdrop-blur-xs border border-border">
            <div className="text-left text-xs">
              <span className="font-semibold text-foreground">Already placed an order?</span>{' '}
              <span className="text-muted-foreground">Check your delivery and payment status.</span>
            </div>
            <Link to="/guest/track" className="w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto h-8 px-3.5 text-xs font-semibold bg-background hover:bg-muted border-border rounded-xl shadow-2xs gap-1.5"
              >
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Track Transaction</span>
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* Other Services */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="mt-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="h-px flex-1 bg-border" />
            <h3 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              Other Services
            </h3>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                to: '/guest/checker',
                icon: GraduationCap,
                title: 'Result Checker',
                desc: 'BECE & WASSCE Checkers',
                cta: 'Buy Checker',
                tone: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300',
              },
              {
                to: affiliateCode ? `/guest/afa?ref=${encodeURIComponent(affiliateCode)}` : '/guest/afa',
                icon: UserPlus,
                title: 'MTN AFA',
                desc: 'Quick registration for lines',
                cta: 'Register Line',
                tone: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-300',
              },
            ].map(({ to, icon: Icon, title, desc, cta, tone }) => (
              <Link key={title} to={to} className="block group">
                <div className="h-full flex flex-col gap-2.5 p-3.5 sm:p-4 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <div className={`w-10 h-10 rounded-xl ${tone} flex items-center justify-center`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-foreground leading-tight">{title}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                  <div className="mt-auto pt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-primary">
                    {cta} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
