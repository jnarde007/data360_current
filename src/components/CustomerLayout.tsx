import { useState, useCallback } from 'react';
import { useServerTimeSync } from '@/hooks/use-server-time';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
  LayoutDashboard, ShoppingCart, History, Wallet, CreditCard, User, Gift,
  LogOut, Menu, Sun, Moon, ChevronRight, X, Settings, PanelLeftClose, PanelLeft, LifeBuoy, FileSearch, UserPlus, Store, RotateCcw, KeyRound
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import logo from '@/assets/logo.png';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { FloatingWhatsApp } from '@/components/FloatingWhatsApp';
import { NotificationCenter } from '@/components/NotificationCenter';

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/buy-data', label: 'Buy Data', icon: ShoppingCart },
  { to: '/checker', label: 'Results Checker', icon: FileSearch },
  { to: '/afa', label: 'MTN AFA Registration', icon: UserPlus },
  { to: '/orders', label: 'Orders', icon: History },
  { to: '/refunds', label: 'Refunds', icon: RotateCcw },
];

const financeLinks = [
  { to: '/topup', label: 'Top Up', icon: CreditCard },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/affiliate', label: 'Referrals', icon: Gift },
  { to: '/my-store', label: 'My Store', icon: Store },
];


const settingsLinks = [
  { to: '/developer-api', label: 'Developer API', icon: KeyRound },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/account', label: 'Account', icon: Settings },
];

function NavSection({ label, links, pathname, onNavigate, collapsed }: { label: string; links: typeof mainLinks; pathname: string; onNavigate: () => void; collapsed: boolean }) {
  return (
    <div className="space-y-0.5">
      {!collapsed && (
        <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/40 font-semibold px-3 pt-4 pb-1">{label}</p>
      )}
      {collapsed && <div className="pt-2" />}
      {links.map(link => {
        const isActive = pathname === link.to;
        const content = (
          <Link
            key={link.to}
            to={link.to}
            onClick={onNavigate}
            className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${collapsed ? 'px-0 mx-auto w-10 h-10' : 'px-3'} py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group relative ${
              isActive
                ? 'bg-primary/[0.08] text-primary shadow-sm dark:bg-primary/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            {isActive && !collapsed && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
            )}
            <link.icon className={`w-[18px] h-[18px] shrink-0 transition-all duration-200 ${isActive ? 'text-primary' : 'group-hover:text-foreground'}`} strokeWidth={isActive ? 2.2 : 1.8} />
            {!collapsed && <span className="flex-1">{link.label}</span>}
            {isActive && !collapsed && <ChevronRight className="w-3.5 h-3.5 opacity-40" />}
          </Link>
        );

        if (collapsed) {
          return (
            <Tooltip key={link.to} delayDuration={0}>
              <TooltipTrigger asChild>{content}</TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{link.label}</TooltipContent>
            </Tooltip>
          );
        }
        return content;
      })}
    </div>
  );
}

export function CustomerLayout({ children }: { children: React.ReactNode }) {
  useServerTimeSync({ autoRefresh: true });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleRefresh = useCallback(async () => {
    window.location.reload();
  }, []);

  const { pulling, pullDistance, refreshing } = usePullToRefresh({ onRefresh: handleRefresh });

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const closeSidebar = () => setSidebarOpen(false);

  const initials = (user?.full_name || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const displayName = (user as any)?.username || user?.full_name?.split(' ')[0] || 'User';

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-[260px]';

  return (
    <TooltipProvider>
      <div className="min-h-[100dvh] premium-app-shell flex">
        <PullToRefreshIndicator pulling={pulling} pullDistance={pullDistance} refreshing={refreshing} />

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
              <Link to="/dashboard" className="flex items-center gap-3" onClick={closeSidebar}>
                <div className="w-9 h-9 rounded-xl overflow-hidden shadow-sm ring-1 ring-border/30 shrink-0">
                  <img src={logo} alt="DATA360" className="w-full h-full object-cover" />
                </div>
                {(sidebarOpen || !collapsed) && (
                  <div>
                    <span className="font-display font-bold text-base text-foreground tracking-tight block leading-tight">DATA360</span>
                    <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wider uppercase">Dashboard</span>
                  </div>
                )}
              </Link>
              {/* Close – mobile */}
              <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 shrink-0 ml-auto" onClick={closeSidebar}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            {/* Collapse toggle – desktop, separate row */}
            <div className={`hidden lg:flex ${collapsed ? 'justify-center px-2.5' : 'justify-end px-5'} pb-4`}>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
              >
                {collapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className={`${collapsed ? 'mx-2' : 'mx-4'} h-px bg-border/30`} />

          {/* Navigation */}
          <nav className={`flex-1 ${collapsed ? 'px-1.5' : 'px-3'} py-2 overflow-y-auto space-y-1`}>
            <NavSection label="Main" links={mainLinks} pathname={location.pathname} onNavigate={closeSidebar} collapsed={collapsed && !sidebarOpen} />
            <NavSection label="Finance" links={financeLinks} pathname={location.pathname} onNavigate={closeSidebar} collapsed={collapsed && !sidebarOpen} />
            <NavSection label="Settings" links={settingsLinks} pathname={location.pathname} onNavigate={closeSidebar} collapsed={collapsed && !sidebarOpen} />
          </nav>

          {/* User section */}
          <div className={`${collapsed ? 'mx-2' : 'mx-4'} h-px bg-border/30`} />
          <div className={`${collapsed ? 'p-1.5' : 'p-3'} space-y-0.5`}>
            {/* User card */}
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
                  <p className="text-muted-foreground">{user?.email}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/30">
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold shadow-sm shrink-0">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight">{displayName}</p>
                  <p className="text-[10px] text-muted-foreground/60 truncate">{user?.email}</p>
                </div>
              </div>
            )}

            {/* Actions */}
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
          {/* Desktop top bar */}
          <header className="hidden lg:flex sticky top-0 z-30 premium-topbar border-b border-border/40 px-6 py-2.5 items-center justify-end gap-2" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <NotificationCenter targetType="customer" />
          </header>
          {/* Mobile header */}
          <header className="lg:hidden sticky top-0 z-30 premium-topbar border-b border-border/40 px-4 py-3 flex items-center justify-between" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-9 w-9">
              <Menu className="w-5 h-5" />
            </Button>
            <Link to="/dashboard" className="flex items-center gap-2">
              <img src={logo} alt="DATA360" className="w-7 h-7 rounded-lg object-cover" />
              <span className="font-display font-bold text-foreground">DATA360</span>
            </Link>
            <div className="flex items-center gap-1">
              <NotificationCenter targetType="customer" />
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-9 w-9">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </header>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="premium-page-content p-4 pb-24 lg:p-8 max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
          <FloatingWhatsApp />

          {/* Mobile bottom navigation */}
          <nav
            aria-label="Quick navigation"
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 premium-topbar border-t border-border/40 px-2 pt-1.5"
            style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))', boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="grid grid-cols-5 max-w-md mx-auto">
              {[
                { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
                { to: '/buy-data', label: 'Buy Data', icon: ShoppingCart },
                { to: '/orders', label: 'Orders', icon: History },
                { to: '/wallet', label: 'Wallet', icon: Wallet },
              ].map(item => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-medium transition-colors ${active ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <item.icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.8} />
                    {item.label}
                  </Link>
                );
              })}
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex flex-col items-center gap-0.5 py-1.5 rounded-xl text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Menu className="w-5 h-5" strokeWidth={1.8} />
                More
              </button>
            </div>
          </nav>
        </main>
      </div>
    </TooltipProvider>
  );
}