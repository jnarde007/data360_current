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
const WHATSAPP_CHAT_LINK = 'https://wa.me/233543761951?text=' + encodeURIComponent('Hi DATA360, I need help with an order/data bundle');

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const affiliateCode = searchParams.get('ref') || searchParams.get('affiliate') || '';

  return (
    <div className="min-h-screen font-body premium-app-shell text-foreground flex flex-col justify-between relative overflow-x-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[340px] bg-primary/10 blur-[130px] rounded-full pointer-events-none -z-10" />

      {/* Hero Section */}
      <section className="px-4 pt-10 pb-6 sm:pt-14 sm:pb-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="max-w-2xl mx-auto text-center"
        >
          {/* Live Status Pill */}
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold mb-4 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Automated Instant Delivery � Online 24/7</span>
          </motion.div>

          {/* Logo + Brand Name Centerpiece */}
          <motion.div
            variants={fadeUp}
            className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-4 mb-3"
          >
            <img
              src={logo}
              alt="DATA360"
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover shadow-sm flex-shrink-0"
            />
            <h1 className="text-4xl sm:text-6xl font-display font-extrabold tracking-tight leading-none text-foreground flex items-center justify-center">
              <span>DATA</span>
              <span className="text-primary ml-0.5">360</span>
            </h1>
          </motion.div>

          <motion.p
            variants={fadeUp}
            className="text-sm sm:text-base text-muted-foreground mb-6 max-w-xl mx-auto px-2 leading-relaxed"
          >
            Affordable data bundles, AFA registration, and BECE/WASSCE result checkers with automated delivery and instant support.
          </motion.p>

          {/* Action CTAs */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
            {user ? (
              <Link to="/dashboard">
                <Button
                  size="sm"
                  className="h-10 px-6 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-xl shadow-md hover:shadow-lg transition-all hover:opacity-95"
                >
                  Go to Dashboard <ArrowRight className="w-4 h-4 ml-1.5" />
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
                    className="h-10 px-5 text-sm font-semibold gradient-primary text-primary-foreground border-0 rounded-xl shadow-md hover:shadow-lg transition-all hover:opacity-95"
                  >
                    Create Account <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
                <Link to={affiliateCode ? `/auth?ref=${encodeURIComponent(affiliateCode)}` : '/auth'}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 px-5 text-sm font-semibold border-border bg-card/80 backdrop-blur-xs text-foreground hover:bg-muted rounded-xl shadow-2xs"
                  >
                    Sign In
                  </Button>
                </Link>
                <a
                  href={WHATSAPP_CHAT_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 px-4 text-sm font-semibold border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 rounded-xl gap-2 shadow-2xs transition-all"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <MessageCircle className="w-4 h-4 text-emerald-500" />
                    <span>Chat with Admin</span>
                  </Button>
                </a>
              </>
            )}
          </motion.div>

          {/* Trust Badges */}
          <motion.ul
            variants={fadeUp}
            className="mt-6 flex flex-wrap items-center justify-center gap-2"
          >
            {[
              { icon: Zap, label: 'Instant auto-delivery' },
              { icon: ShieldCheck, label: 'Secure Paystack payment' },
              { icon: RotateCcw, label: 'Automatic refunds' },
            ].map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-card/70 backdrop-blur-xs px-3 py-1 text-[11px] sm:text-xs font-medium text-muted-foreground shadow-2xs"
              >
                <Icon className="w-3.5 h-3.5 text-primary" />
                {label}
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Guest Purchase Section */}
        <div className="max-w-2xl mx-auto mt-6">
          <GuestNetworkPicker affiliateCode={affiliateCode} />
        </div>
      </section>

      {/* Footer & Contacts */}
      <footer className="mt-8 border-t border-border bg-card/40 backdrop-blur-xs py-8 px-4">
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
                href: WHATSAPP_CHAT_LINK,
                external: true,
                icon: MessageCircle,
                title: 'WhatsApp',
                value: WHATSAPP_NUMBER,
                desc: 'Chat with Admin',
                iconClass: 'text-green-600 dark:text-green-400',
                badge: 'Live',
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
            ].map(({ href, external, icon: Icon, title, value, desc, iconClass, badge }) => (
              <li key={title}>
                <a
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="h-full flex flex-col gap-2 p-3.5 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-md transition-all group relative"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                      <Icon className={`w-4 h-4 ${iconClass}`} />
                    </div>
                    {badge && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {badge}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-[12px] font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">{title}</div>
                    <div className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
                    <div className="text-[11px] text-foreground/80 truncate mt-1.5 font-medium">{value}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>

          {/* Bottom Bar: Copyright + Theme Toggle */}
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

      {/* Floating Instant WhatsApp Button for Guests */}
      <div className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-50 flex items-center gap-2.5 group">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card/95 backdrop-blur-md border border-border text-xs font-semibold text-foreground shadow-lg group-hover:border-emerald-500/40 transition-all pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Chat with Admin
        </span>
        <a
          href={WHATSAPP_CHAT_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="w-12 h-12 rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 flex items-center justify-center transition-all"
          aria-label="Chat with Admin on WhatsApp"
        >
          <MessageCircle className="w-6 h-6 fill-white text-white" />
        </a>
      </div>

      <InstallBanner />
    </div>
  );
}
