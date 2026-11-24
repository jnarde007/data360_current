import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import logo from '@/assets/logo.png';
import { Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import AuthShell from '@/components/auth/AuthShell';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { adminLogin } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast({ title: 'Please fill all fields', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const result = await adminLogin(email, password);
      if (result.success) {
        navigate('/admin');
      } else {
        toast({ title: result.message || 'Login failed', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: err?.message || 'Login failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell variant="admin">
        <div className="auth-glass py-6 px-5">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <img src={logo} alt="DATA360" className="w-10 h-10 rounded-xl object-cover shadow-lg" />
            <span className="font-display font-semibold text-xl text-foreground tracking-tight">DATA360</span>
          </div>
          <h1 className="font-display font-bold text-xl text-foreground mb-0.5 tracking-tight text-center">Admin Login</h1>
          <p className="text-xs text-muted-foreground mb-6 text-center">Access the admin console</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="auth-label">Email</label>
              <Input type="email" placeholder="admin@data360.com" value={email} onChange={e => setEmail(e.target.value)} className="auth-input mt-1" autoComplete="email" />
            </div>
            <div>
              <label className="auth-label">Password</label>
              <div className="relative mt-1">
                <Input type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="auth-input pr-12" autoComplete="off" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={loading} className="auth-btn">
              {loading ? 'Logging in...' : 'Log In'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-4">
            <Link to="/" className="text-primary hover:underline font-medium">Back to site</Link>
          </p>
        </div>
    </AuthShell>
  );
}
