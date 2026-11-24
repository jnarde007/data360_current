import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Search, GraduationCap, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import mtnLogo from '@/assets/mtn-logo.png';
import telecelLogo from '@/assets/telecel-logo.png';
import atLogo from '@/assets/at-logo.png';

const fadeUp = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.05 } } };

type Provider = {
  key: 'MTN' | 'Telecel' | 'AirtelTigo';
  name: string;
  logo: string;
  accent: string;
};

const PROVIDERS: Provider[] = [
  { key: 'MTN', name: 'MTN', logo: mtnLogo, accent: 'bg-yellow-400' },
  { key: 'Telecel', name: 'Telecel', logo: telecelLogo, accent: 'bg-red-500' },
  { key: 'AirtelTigo', name: 'AirtelTigo', logo: atLogo, accent: 'bg-primary' },
];

export default function GuestNetworkPicker({ affiliateCode }: { affiliateCode: string }) {
  const buildLink = (network: string) => {
    const params = new URLSearchParams({ network });
    if (affiliateCode) params.set('ref', affiliateCode);
    return `/guest-buy?${params.toString()}`;
  };

  return (
    <section className="px-4 py-4 sm:py-6">
      <div className="container mx-auto max-w-md sm:max-w-3xl">
        {/* Section heading */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="text-center mb-4"
        >
          <h2 className="text-base sm:text-lg font-display font-semibold text-foreground">
            Buy Without Creating an Account
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Select a service below to continue.</p>
        </motion.div>

        {/* Network cards */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3"
        >
          {PROVIDERS.map((p) => (
            <motion.div key={p.key} variants={fadeUp}>
              <Link to={buildLink(p.key)} className="block group">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border hover:border-primary/40 hover:shadow-sm transition-all">
                  <div className={`w-10 h-10 rounded-lg ${p.accent} flex items-center justify-center shrink-0`}>
                    <img src={p.logo} alt={p.name} className="w-7 h-7 rounded-md object-cover" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-semibold text-foreground">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Data Packages</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* Track Transaction — moved here, between data cards and Other Services */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
          className="text-center mt-5"
        >
          <Link to="/guest/track">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-4 text-xs font-medium bg-card text-foreground border border-border hover:bg-muted hover:border-primary/40 rounded-lg"
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              Track Transaction
            </Button>
          </Link>
        </motion.div>

        {/* Other Services — placeholder routes (Phase 2 will wire) */}
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
                desc: 'BECE & WASSCE',
                cta: 'Buy now',
                tone: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300',
              },
              {
                to: affiliateCode ? `/guest/afa?ref=${encodeURIComponent(affiliateCode)}` : '/guest/afa',
                icon: UserPlus,
                title: 'MTN AFA',
                desc: 'Quick registration',
                cta: 'Register',
                tone: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-300',
              },
            ].map(({ to, icon: Icon, title, desc, cta, tone }) => (
              <Link key={title} to={to} className="block group">
                <div className="h-full flex flex-col gap-3 p-4 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <div className={`w-11 h-11 rounded-xl ${tone} flex items-center justify-center`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-foreground leading-tight">{title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                  <div className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    {cta} <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
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
