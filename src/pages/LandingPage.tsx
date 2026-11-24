import { Link, useSearchParams } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sun, Moon, ArrowRight, MessageCircle, LifeBuoy, Tag, Mail, Store, Zap, ShieldCheck, RotateCcw } from 'lucide-react';
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
    <div className="min-h-screen font-body premium-app-shell text-foreground">
      {/* Compact Navbar */}
      <nav className="sticky top-0 z-50 premium-topbar border-b border-border">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="DATA360" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-display font-semibold text-base text-foreground tracking-tight">
              DATA360
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-4 pt-10 pb-6 sm:pt-14 sm:pb-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="max-w-2xl mx-auto text-center"
        >
          <motion.h1
            variants={fadeUp}
            className="text-5xl sm:text-6xl font-display font-extrabold tracking-tight mb-3 leading-none"
          >
            <span className="text-foreground">DATA</span>
            <span className="text-primary">360</span>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="text-sm sm:text-base text-muted-foreground mb-5 max-w-xl mx-auto sm:whitespace-nowrap px-2"
          >
            Affordable data bundles, AFA registration, and result checkers at your fingertips.
          </motion.p>

          <motion.div variants={fadeUp} className="flex items-center justify-center gap-2.5">
            {user ? (
              <Link to="/dashboard">
                <Button
                  size="sm"
                  className="h-10 px-5 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-lg"
                >
                  Go to Dashboard <ArrowRight className="w-3.5 h-3.5 ml-1" />
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
                    className="h-10 px-5 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-lg"
                  >
                    Create Account <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
                <Link to={affiliateCode ? `/auth?ref=${encodeURIComponent(affiliateCode)}` : '/auth'}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 px-5 text-sm font-semibold border-border bg-card text-foreground hover:bg-muted rounded-lg"
                  >
                    Sign In
                  </Button>
                </Link>
              </>
            )}
          </motion.div>

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
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] sm:text-xs font-medium text-muted-foreground"
              >
                <Icon className="w-3.5 h-3.5 text-primary" />
                {label}
              </li>
            ))}
          </motion.ul>
        </motion.div>
      </section>

      {/* Guest network picker + other services */}
      <GuestNetworkPicker affiliateCode={affiliateCode} />

      {/* Footer / Contact */}
      <footer className="mt-8 pb-24 pt-2">
        <div className="container mx-auto px-4 max-w-md sm:max-w-3xl">
          <div className="flex items-center gap-3 mb-3">
            <span className="h-px flex-1 bg-border" />
            <h3 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              Contact Us
            </h3>
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
                  desc: 'Help, complaints & refunds',
                  iconClass: 'text-blue-600 dark:text-blue-400',
                },
                {
                  href: 'mailto:sales@buy-data360.com',
                  icon: Tag,
                  title: 'Sales',
                  value: 'sales@buy-data360.com',
                  desc: 'Pricing & bulk orders',
                  iconClass: 'text-amber-600 dark:text-amber-400',
                },
                {
                  href: 'mailto:info@buy-data360.com',
                  icon: Mail,
                  title: 'General',
                  value: 'info@buy-data360.com',
                  desc: 'Other inquiries',
                  iconClass: 'text-purple-600 dark:text-purple-400',
                },
              ].map(({ href, external, icon: Icon, title, value, desc, iconClass }) => (
                <li key={title}>
                  <a
                    href={href}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="h-full flex flex-col gap-2 p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-md transition-all"
                  >
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                      <Icon className={`w-4 h-4 ${iconClass}`} />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="text-[13px] font-semibold text-foreground leading-tight">{title}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
                      <div className="text-[11px] text-foreground/80 truncate mt-1.5">{value}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>

          <p className="text-[11px] text-muted-foreground text-center mt-4">
            © {new Date().getFullYear()} DATA360
          </p>
        </div>
      </footer>
      <InstallBanner />
    </div>
  );
}
