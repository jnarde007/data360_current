import { useState, useMemo, useRef } from 'react';
import { useMobileTableCards } from '@/hooks/useMobileTableCards';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
  LayoutDashboard, Users, CreditCard, ShoppingCart, DollarSign, Settings, Shield,
  LogOut, Menu, Sun, Moon, BarChart3, UserCheck, Wifi, BookOpen, Scale, ShieldCheck,
  ChevronRight, X, PanelLeftClose, PanelLeft, Trophy, LifeBuoy,
  FileSpreadsheet, FileSearch, ClipboardList, MessageSquare, Package, Activity,
  Wallet, ArrowUpDown, UserPlus, Search, RotateCcw,

  Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import logo from '@/assets/logo.png';
import { NotificationCenter } from '@/components/NotificationCenter';
import { AdminCommandPalette } from '@/components/AdminCommandPalette';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  description: string;
  superAdminOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    icon: LayoutDashboard,
    defaultOpen: true,
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, description: 'High-level KPIs, revenue and activity at a glance.' },
      { to: '/admin/profit', label: 'Profit', icon: BarChart3, description: 'Confirmed vs projected profit and margin tracking.', superAdminOnly: true },
      { to: '/admin/reports', label: 'Reports', icon: FileSpreadsheet, description: 'Generate and download business reports as Excel.', superAdminOnly: true },
    ],
  },
  {
    label: 'Orders & Fulfillment',
    icon: ShoppingCart,
    defaultOpen: true,
    items: [
      { to: '/admin/orders', label: 'Orders', icon: ShoppingCart, description: 'Browse, search and manage every customer order.' },
      { to: '/admin/fulfillment-queue', label: 'Fulfillment Queue', icon: ClipboardList, description: 'Manual delivery queue prioritised by aging buckets.' },
      { to: '/admin/afa', label: 'AFA Registration', icon: UserPlus, description: 'Review and process AFA registration requests.' },
    ],
  },
  {
    label: 'Customers',
    icon: Users,
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users, description: 'All registered users, balances and account status.' },
      { to: '/admin/support', label: 'Chats', icon: LifeBuoy, description: 'Live conversations and inquiries.' },
      { to: '/admin/super-agents', label: 'Super Agents', icon: Crown, description: 'Approve resellers and manage Super Agent pricing.', superAdminOnly: true },
      { to: '/admin/api-usage', label: 'API Usage', icon: Activity, description: 'Developer API request monitoring (no blocking).' },
      { to: '/admin/affiliates', label: 'Affiliates', icon: UserCheck, description: 'Manage affiliates, commissions and withdrawals.' },
      { to: '/admin/referral-leaderboard', label: 'Referral Leaderboard', icon: Trophy, description: 'Top-performing affiliates ranked by referrals.' },
    ],
  },
  {
    label: 'Payments & Wallets',
    icon: Wallet,
    items: [
      { to: '/admin/topups', label: 'Wallet Top-ups', icon: CreditCard, description: 'Track Paystack and manual wallet top-ups.' },
      { to: '/admin/wallet-ledger', label: 'Wallet Ledger', icon: BookOpen, description: 'Full audit trail of every wallet movement.' },
      { to: '/admin/payment-recovery', label: 'Payment Recovery', icon: ArrowUpDown, description: 'Recover stuck or unmatched Paystack payments.' },
      { to: '/admin/reconciliation', label: 'Reconciliation', icon: Scale, description: 'Match provider transactions against local records.' },
    ],
  },
  {
    label: 'Products',
    icon: Package,
    items: [
      { to: '/admin/pricing', label: 'Data Bundles', icon: DollarSign, description: 'Manage networks, bundles and customer pricing.' },
      { to: '/admin/checkers', label: 'Result Checkers', icon: FileSearch, description: 'WASSCE/BECE checker stock and assignments.' },
      { to: '/admin/stores', label: 'Store Management', icon: Package, description: 'Manage vendor stores, transactions and withdrawals.' },
    ],

  },
  {
    label: 'System',
    icon: Settings,
    items: [
      { to: '/admin/settings', label: 'Platform Settings', icon: Settings, description: 'Global toggles, feature flags and platform config.' },
      { to: '/admin/health-check', label: 'Health Check', icon: ShieldCheck, description: 'Run reconciliation and integrity health checks.' },
      { to: '/admin/sms-logs', label: 'SMS Logs', icon: MessageSquare, description: 'View Wittyflow SMS delivery history and status.' },
      { to: '/admin/api', label: 'Network APIs', icon: Wifi, description: 'Configure provider APIs and delivery routing.', superAdminOnly: true },
      { to: '/admin/provider-balances', label: 'Provider Balances', icon: Wallet, description: 'Live wallet balances from upstream data providers.' },
      { to: '/admin/payouts', label: 'Payouts', icon: Wallet, description: 'Affiliate & store commission payouts via Paystack.' },
      { to: '/admin/refunds', label: 'Refunds', icon: RotateCcw, description: 'Automatic provider refunds and their settlement state.' },
      { to: '/admin/admins', label: 'Admin Users', icon: Shield, description: 'Manage admin accounts, roles and permissions.', superAdminOnly: true },
      { to: '/admin/cross-network', label: 'Cross-Network Access', icon: ShieldCheck, description: 'Authorize customers to bypass same-network validation.', superAdminOnly: true },
    ],
  },
];

function NavGroupSection({
  group,
  pathname,
  onNavigate,
  collapsed,
  isSuperAdmin,
  filter,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate: () => void;
  collapsed: boolean;
  isSuperAdmin?: boolean;
  filter: string;
}) {
  const q = filter.trim().toLowerCase();
  const visibleItems = group.items
    .filter(item => !item.superAdminOnly || isSuperAdmin)
    .filter(item =>
      !q ||
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      group.label.toLowerCase().includes(q)
    );
  if (visibleItems.length === 0) return null;

  // Collapsed sidebar: show only icons
  if (collapsed) {
    return (
      <div className="space-y-0.5 py-1">
        {visibleItems.map(item => {
          const isActive = pathname === item.to;
          return (
            <Tooltip key={item.to} delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl text-[13px] font-medium transition-all duration-200 group relative ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className={`w-[18px] h-[18px] shrink-0 transition-all duration-200 ${isActive ? '' : 'group-hover:text-foreground'}`} strokeWidth={isActive ? 2.4 : 1.8} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[240px]">
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  // Expanded sidebar
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 font-semibold select-none">
        <group.icon className="w-3.5 h-3.5 shrink-0 opacity-50" strokeWidth={1.8} />
        <span className="flex-1 text-left">{group.label}</span>
      </div>
      <div className="space-y-0.5 mt-0.5">
        {visibleItems.map(item => {
          const isActive = pathname === item.to;
          return (
            <Tooltip key={item.to} delayDuration={400}>
              <TooltipTrigger asChild>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 pl-[34px] py-2 rounded-xl text-[13px] font-medium transition-all duration-200 group relative ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-primary" />
                  )}
                  <item.icon className={`w-[16px] h-[16px] shrink-0 transition-all duration-200 ${isActive ? '' : 'group-hover:text-foreground'}`} strokeWidth={isActive ? 2.4 : 1.8} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-80" />}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[240px]">
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.description}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const isSupportChatRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin/support');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const { logout, user } = useAuth();
  const isSuperAdmin = user?.adminRole === 'Super Admin';
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useMobileTableCards(contentRef);
  const paletteGroups = useMemo(() => navGroups.map(g => ({
    label: g.label,
    items: g.items.filter(i => !i.superAdminOnly || isSuperAdmin),
  })).filter(g => g.items.length > 0), [isSuperAdmin]);

  const handleLogout = () => { logout(); navigate('/'); };
  const closeSidebar = () => setSidebarOpen(false);

  const initials = (user?.full_name || 'A')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const displayName = user?.full_name || 'Admin';

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-[260px]';

  return (
    <TooltipProvider>
      <div className="min-h-[100dvh] premium-app-shell flex">
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
              onClick={closeSidebar}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside
          className={`fixed lg:sticky top-0 left-0 z-50 h-[100dvh] ${sidebarOpen ? 'w-[260px]' : sidebarWidth} premium-sidebar flex flex-col transition-[width,transform] duration-300 ease-out border-r border-border/50 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Header */}
          <div className="flex flex-col">
            <div className={`${collapsed && !sidebarOpen ? 'px-2.5 justify-center' : 'px-5'} pt-6 pb-3 flex items-center`}>
              <Link to="/admin" className="flex items-center gap-3" onClick={closeSidebar}>
                <div className="w-9 h-9 rounded-xl overflow-hidden shadow-sm ring-1 ring-border/30 shrink-0">
                  <img src={logo} alt="DATA360" className="w-full h-full object-cover" />
                </div>
                {(sidebarOpen || !collapsed) && (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-base text-foreground tracking-tight leading-tight">DATA360</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold uppercase tracking-wider">Admin</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wider uppercase">Control Panel</span>
                  </div>
                )}
              </Link>
              <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 shrink-0 ml-auto" onClick={closeSidebar}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className={`hidden lg:flex ${collapsed ? 'justify-center px-2.5' : 'justify-end px-5'} pb-4`}>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
              >
                {collapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className={`${collapsed ? 'mx-2' : 'mx-4'} h-px bg-border/30`} />

          {/* Search */}
          {!(collapsed && !sidebarOpen) && (
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search pagesâ€¦"
                  className="h-8 pl-8 pr-7 text-[12px] bg-muted/40 border-border/40 focus-visible:ring-1"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className={`flex-1 ${collapsed ? 'px-1.5' : 'px-3'} py-2 overflow-y-auto space-y-0.5`}>
            {navGroups.map(group => (
              <NavGroupSection
                key={group.label}
                group={group}
                pathname={location.pathname}
                onNavigate={closeSidebar}
                collapsed={collapsed && !sidebarOpen}
                isSuperAdmin={isSuperAdmin}
                filter={collapsed && !sidebarOpen ? '' : search}
              />
            ))}
            {search && !(collapsed && !sidebarOpen) && navGroups.every(g =>
              g.items
                .filter(i => !i.superAdminOnly || isSuperAdmin)
                .every(i =>
                  !i.label.toLowerCase().includes(search.trim().toLowerCase()) &&
                  !i.description.toLowerCase().includes(search.trim().toLowerCase()) &&
                  !g.label.toLowerCase().includes(search.trim().toLowerCase())
                )
            ) && (
              <p className="text-[11px] text-muted-foreground/60 text-center py-6 px-3">
                No pages match â€œ{search}â€.
              </p>
            )}
          </nav>

          {/* User section */}
          <div className={`${collapsed ? 'mx-2' : 'mx-4'} h-px bg-border/30`} />
          <div className={`${collapsed ? 'p-1.5' : 'p-3'} space-y-0.5`}>
            {collapsed && !sidebarOpen ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center py-2">
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-sm shrink-0">
                      {initials}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  <p className="font-medium">{displayName}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/30">
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold shadow-sm shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground/60 truncate">{user?.adminRole || 'Admin'}</p>
                </div>
              </div>
            )}

            {collapsed && !sidebarOpen ? (
              <>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button onClick={toggleTheme} className="flex items-center justify-center w-10 h-10 mx-auto rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200">
                      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</TooltipContent>
                </Tooltip>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button onClick={handleLogout} className="flex items-center justify-center w-10 h-10 mx-auto rounded-xl text-destructive hover:bg-destructive/10 transition-all duration-200">
                      <LogOut className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">Log Out</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <button onClick={toggleTheme} className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/50 w-full transition-all duration-200">
                  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
                <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] text-destructive hover:bg-destructive/10 w-full transition-all duration-200">
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-[100dvh] min-w-0">
          <header className="hidden lg:flex sticky top-0 z-30 premium-topbar border-b border-border/40 px-6 py-2.5 items-center justify-between gap-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 w-72 h-9 px-3 rounded-xl border border-border/60 bg-muted/40 text-sm text-muted-foreground hover:bg-muted/70 transition-colors"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Jump to pageâ€¦</span>
              <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md border border-border bg-background">Ctrl K</kbd>
            </button>
            <NotificationCenter targetType="admin" />
            <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />
          </header>
          <header className={"lg:hidden sticky top-0 z-30 premium-topbar " + (isSupportChatRoute ? "hidden" : "") border-b border-border/40 px-4 py-3 flex items-center justify-between" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-9 w-9">
              <Menu className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <img src={logo} alt="DATA360" className="w-7 h-7 rounded-lg object-cover" />
              <span className="font-display font-bold text-foreground">DATA360</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold">Admin</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => setPaletteOpen(true)} className="h-9 w-9" aria-label="Jump to page">
                <Search className="w-4 h-4" />
              </Button>
              <NotificationCenter targetType="admin" />
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </header>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            ref={contentRef}
            className="premium-page-content admin-mobile-cards p-4 lg:p-8 max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </TooltipProvider>
  );
}

