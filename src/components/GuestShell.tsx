import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import logo from '@/assets/logo.png';

/**
 * Lightweight shell for guest pages — no sidebar, no auth required.
 * Shared across guest data, AFA, checker, success, track pages.
 */
export default function GuestShell({ children, hideTrack = false }: { children: React.ReactNode; hideTrack?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen premium-app-shell">
      <nav className="sticky top-0 z-50 premium-topbar border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="DATA360" className="w-8 h-8 rounded-xl object-cover" />
            <span className="font-display font-bold text-lg text-foreground">DATA360</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            {!hideTrack && (
              <Link to="/guest/track">
                <Button variant="outline" size="sm" className="text-sm rounded-full">Track</Button>
              </Link>
            )}
            <Link to="/auth">
              <Button size="sm" className="text-sm bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">Log In</Button>
            </Link>
          </div>
        </div>
      </nav>
      <main className="premium-page-content container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
