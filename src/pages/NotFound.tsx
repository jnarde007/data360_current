import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { Compass, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen auth-bg-gradient flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md text-center"
      >
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <img src={logo} alt="DATA360" className="w-11 h-11 rounded-xl object-cover shadow-lg" />
          <span className="font-display font-bold text-2xl text-foreground tracking-tight">DATA360</span>
        </Link>

        <div className="premium-card p-8 sm:p-10" style={{ boxShadow: "var(--shadow-lg)" }}>
          <div className="icon-box icon-box-2xl icon-box-primary mx-auto mb-5">
            <Compass className="w-7 h-7" />
          </div>

          <h1 className="font-display font-extrabold text-7xl text-gradient leading-none mb-2 tracking-tight">
            404
          </h1>
          <h2 className="font-display font-bold text-xl text-foreground mb-2">Page not found</h2>
          <p className="text-sm text-muted-foreground mb-1">
            We couldn't find the page you're looking for.
          </p>
          {location.pathname && (
            <p className="text-xs text-muted-foreground/80 mb-6 font-mono break-all">
              {location.pathname}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <Button
              asChild
              variant="outline"
              className="flex-1 h-11 rounded-xl"
            >
              <button onClick={() => window.history.back()} type="button">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go back
              </button>
            </Button>
            <Button asChild className="flex-1 h-11 gradient-primary text-primary-foreground border-0 shadow-md rounded-xl">
              <Link to="/">
                <Home className="w-4 h-4 mr-2" />
                Return home
              </Link>
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default NotFound;
