import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, ShieldCheck, RotateCcw, Wallet, Lock } from 'lucide-react';
import logo from '@/assets/logo.png';

type Variant = 'customer' | 'admin';

const COPY: Record<Variant, { eyebrow: string; title: string; body: string; points: { icon: typeof Zap; title: string; desc: string }[] }> = {
  customer: {
    eyebrow: 'Ghana’s data & services hub',
    title: 'Data bundles delivered in seconds.',
    body: 'MTN, Telecel and AirtelTigo bundles, result checkers and AFA registration — all in one place.',
    points: [
      { icon: Zap, title: 'Instant delivery', desc: 'Most orders arrive in under a minute.' },
      { icon: Wallet, title: 'Wallet & MoMo', desc: 'Pay with your wallet or Paystack.' },
      { icon: RotateCcw, title: 'Automatic refunds', desc: 'Failed orders are refunded for you.' },
    ],
  },
  admin: {
    eyebrow: 'Restricted area',
    title: 'DATA360 Admin Console',
    body: 'Manage orders, payouts, pricing and providers securely.',
    points: [
      { icon: Lock, title: 'Authorized staff only', desc: 'All sign-ins are monitored.' },
      { icon: ShieldCheck, title: 'Audited actions', desc: 'Every change is logged.' },
    ],
  },
};

export default function AuthShell({ children, variant = 'customer' }: { children: ReactNode; variant?: Variant }) {
  const c = COPY[variant];
  return (
    <div className="min-h-screen auth-bg-gradient lg:grid lg:grid-cols-2">
      <aside className="auth-showcase hidden lg:flex flex-col justify-between p-12 xl:p-16">
        <Link to="/" className="flex items-center gap-3">
          <img src={logo} alt="DATA360" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
          <span className="font-display font-semibold text-xl tracking-tight">DATA360</span>
        </Link>

        <div className="max-w-md">
          <span className="inline-flex items-center rounded-full auth-showcase-pill px-3 py-1 text-xs font-medium mb-5">
            {c.eyebrow}
          </span>
          <h2 className="font-display font-bold text-4xl xl:text-5xl leading-tight tracking-tight mb-4">{c.title}</h2>
          <p className="auth-showcase-muted text-base leading-relaxed mb-10">{c.body}</p>
          <ul className="space-y-5">
            {c.points.map((p) => (
              <li key={p.title} className="flex items-start gap-4">
                <span className="auth-showcase-icon w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
                  <p.icon className="w-5 h-5" />
                </span>
                <div>
                  <p className="font-semibold">{p.title}</p>
                  <p className="auth-showcase-muted text-sm">{p.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-showcase-muted text-xs">© {new Date().getFullYear()} DATA360 · Secured by Paystack</p>
      </aside>

      <main className="min-h-screen flex items-center justify-center p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="w-full max-w-sm"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
