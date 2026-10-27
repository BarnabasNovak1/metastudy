import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../../firebase";
import { syncCheckoutSession } from "@/lib/billing";
import { Moon, Sun } from "lucide-react";
import { getCookieConsent } from "@/components/CookieConsent";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

const CheckoutSuccess = () => {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(true);
  const [syncStatus, setSyncStatus] = useState('Checking your checkout...');
  const [confirmed, setConfirmed] = useState(false);
  const [canRedirect, setCanRedirect] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const conversionFired = useRef(false);

  // Fire Google Ads conversion on mount (only once, and only with cookie consent)
  useEffect(() => {
    if (!confirmed || conversionFired.current) return;
    conversionFired.current = true;

    // Respect cookie consent - no tracking without explicit acceptance (GDPR)
    if (getCookieConsent() !== 'accepted') return;

    // Ensure gtag is loaded (bounded retries)
    let attempts = 0;
    const fireConversion = () => {
      if (window.gtag) {
        window.gtag('event', 'conversion', {
          'send_to': 'AW-17948231622/purchase',
        });
        console.log('[CheckoutSuccess] Google Ads conversion fired');
      } else if (attempts++ < 10) {
        // gtag not ready yet, try again shortly
        setTimeout(fireConversion, 500);
      }
    };
    fireConversion();
  }, [confirmed]);

  // Auto-close tab after 5 seconds once sync is complete
  useEffect(() => {
    if (syncing || !canRedirect) return;
    
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          // Try to close this tab (works if opened via window.open)
          // If can't close, redirect to account page
          try {
            window.close();
          } catch {}
          // Fallback: if window.close() didn't work, navigate to account
          setTimeout(() => {
            navigate('/account');
          }, 100);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [syncing, canRedirect, navigate]);

  useEffect(() => {
    let cancelled = false;
    const syncSubscription = async () => {
      try {
        await auth.authStateReady();
        const u = auth.currentUser;
        if (!u) {
          if (!cancelled) setSyncStatus('Please sign in to view your purchase.');
          return;
        }

        await u.getIdToken(true);
        const sessionId = new URLSearchParams(window.location.search).get('session_id');
        if (!sessionId) {
          // Extension redirects may omit a session ID. Its server trigger owns
          // fulfillment; the browser must not infer or write a plan.
          if (!cancelled) {
            setSyncStatus('Your account will update when payment is confirmed.');
            setCanRedirect(true);
          }
          return;
        }
        const session = await syncCheckoutSession(sessionId);
        if (cancelled) return;
        const paid = session.status === 'complete'
          && ['paid', 'no_payment_required'].includes(session.payment_status);
        setConfirmed(paid);
        setSyncStatus(paid
          ? 'Payment confirmed. Your account will update shortly.'
          : 'Payment is still processing. Your account will update once it is confirmed.');
        setCanRedirect(true);
      } catch (err) {
        console.error('Subscription sync error:', err);
        if (!cancelled) setSyncStatus('We could not confirm this checkout yet. Check your account or contact support before purchasing again.');
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };

    syncSubscription();
    return () => { cancelled = true; };
  }, []);
  // Theme state and toggle
  const [isDark, setIsDark] = useState(false);
  
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem("theme", newDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", newDark);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background relative">
      {/* Theme toggle - top right */}
      <div className="absolute top-4 right-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>

      <div className="max-w-md w-full text-center space-y-8">
        {/* Thank you message */}
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground">
          {confirmed ? 'Thank you for your purchase!' : 'Checkout received'}
        </h1>
        
        {/* Tagline */}
        <p className="text-lg sm:text-xl text-muted-foreground">
          Your study tools and purchase details are available in your account.
        </p>
        
        {/* Logo - shows dark logo on light bg, light logo on dark bg */}
        <div className="flex justify-center py-4">
          <img 
            src={MetaStudyLogo} 
            alt="metastudy-e1ba2.web.app" 
            className="w-24 h-24 object-contain hidden dark:block"
          />
          <img 
            src={MetaStudyLogo} 
            alt="metastudy-e1ba2.web.app" 
            className="w-24 h-24 object-contain dark:hidden"
          />
        </div>
        
        {/* Auto-redirect notice */}
        <p className="text-sm text-muted-foreground" role="status">{syncStatus}</p>
        {!syncing && canRedirect && <p className="text-sm text-muted-foreground">
          Redirecting to your account in {countdown} second{countdown !== 1 ? 's' : ''}…
        </p>}
        <Button onClick={() => navigate('/account')}>Go to account</Button>
      </div>
    </div>
  );
};

export default CheckoutSuccess;
