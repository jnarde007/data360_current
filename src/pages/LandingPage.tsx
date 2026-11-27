import { Link, useSearchParams } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sun, Moon, ArrowRight, MessageCircle, LifeBuoy, Tag, Mail, Zap, ShieldCheck, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import logo from '@/assets/logo.png';
import InstallBanner from '@/components/InstallBanner';
import GuestNetworkPicker from '@/components/landing/GuestNetworkPicker';

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };
const stagger = { visible: { transition: { staggerChildren: 0.06 } } };

const WHATSAPP_NUMBER = '+233543761951';
const WHATSAPP_DIGITS = '233543761951';

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const affiliateCode = searchParams.get('ref') || searchParams.get('affiliate') || '';

  return (
    <div className="min-h-screen font-body premium-app-shell text-foreground flex flex-col justify-between">
      {/* Hero Section */}
      <section className="px-4 pt-12 pb-6 sm:pt-16 sm:pb-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="max-w-2xl mx-auto text-center"
        >
          {/* Logo + Brand Name Centerpiece */}
          <motion.div variants={fadeUp} className="flex items-center justify-center gap-3 sm:gap-4 mb-3">
            <img
              src={logo}
              alt="DATA360"
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl shadow-md border border-border/80 object-cover"
            />
            <h1 className="text-4xl sm:text-6xl font-display font-extrabold tracking-tight leading-none">
              <span className="text-foreground">DATA</span>
              <span className="text-primary">360</span>
            </h1>
          </motion.div>

          <motion.p
            variants={fadeUp}
            className="text-sm sm:text-base text-muted-foreground mb-6 max-w-xl mx-auto px-2"
          >
            Affordable data bundles, AFA registration, and result checkers at your fingertips.
          </motion.p>

          {/* Action CTAs */}
          <motion.div variants={fadeUp} className="flex items-center justify-center gap-2.5">
            {user ? (
              <Link to="/dashboard">
                <Button
                  size="sm"
                  className="h-10 px-6 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-xl shadow-sm hover:opacity-95"
                >
                  Go to Dashboard <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </Link>
            ) : (
              <>
                <Link
                  to={
                    affiliateCode
                      ? `/auth?tab=signup&ref=${encodeURIComponent(affiliateCode)}`
                      : '/auth?tab=signup'
                  }
                >
                  <Button
                    size="sm"
                    className="h-10 px-5 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-xl shadow-sm hover:opacity-95"
                  >
                    Create Account <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
                <Link to={affiliateCode ? `/auth?ref=${encodeURIComponent(affiliateCode)}` : '/auth'}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 px-5 text-sm font-semibold border-border bg-card text-foreground hover:bg-muted rounded-xl"
                  >
                    Sign In
                  </Button>
                </Link>
              </>
            )}
          </motion.div>

          {/* Trust Badges */}
          <motion.ul
            variants={fadeUp}
            className="mt-6 flex flex-wrap items-center justify-center gap-2"
          >
            {[
              { icon: Zap, label: 'Instant delivery' },
              { icon: ShieldCheck, label: 'Secure Paystack payment' },
              { icon: RotateCcw, label: 'Automatic refunds' },
            ].map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] sm:text-xs font-medium text-muted-foreground shadow-2xs"
              >
                <Icon className="w-3 h-3 text-primary" />
                {label}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Guest Purchase Section */}
        <div className="max-w-2xl mx-auto mt-8">
          <GuestNetworkPicker />
        </div>
      </section>

      {/* Footer & Contacts */}
      <footer className="mt-8 border-t border-border bg-card/40 py-8 px-4">
        <div className="container max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Contact & Support
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                href: `https://wa.me/${WHATSAPP_DIGITS}`,
                external: true,
                icon: MessageCircle,
                title: 'WhatsApp',
                value: WHATSAPP_NUMBER,
                desc: 'Quick support',
                iconClass: 'text-green-600 dark:text-green-400',
              },
              {
                href: 'mailto:support@buy-data360.com',
                icon: LifeBuoy,
                title: 'Support',
                value: 'support@buy-data360.com',
                desc: 'Help & refunds',
                iconClass: 'text-blue-600 dark:text-blue-400',
              },
              {
                href: 'mailto:sales@buy-data360.com',
                icon: Tag,
                title: 'Sales',
                value: 'sales@buy-data360.com',
                desc: 'Bulk packages',
                iconClass: 'text-amber-600 dark:text-amber-400',
              },
              {
                href: 'mailto:info@buy-data360.com',
                icon: Mail,
                title: 'General',
                value: 'info@buy-data360.com',
                desc: 'General info',
                iconClass: 'text-purple-600 dark:text-purple-400',
              },
            ].map(({ href, external, icon: Icon, title, value, desc, iconClass }) => (
              <li key={title}>
                <a
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="h-full flex flex-col gap-2 p-3 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                    <Icon className={`w-4 h-4 ${iconClass}`} />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-[12px] font-semibold text-foreground leading-tight">{title}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
                    <div className="text-[10.5px] text-foreground/80 truncate mt-1">{value}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>

          {/* Bottom Bar: Copyright + Theme Toggle (Option B) */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50 text-[11px] text-muted-foreground">
            <span>� {new Date().getFullYear()} DATA360. All rights reserved.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="h-7 px-2.5 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </Button>
          </div>
        </div>
      </footer>
      <InstallBanner />
    </div>
  );
}
