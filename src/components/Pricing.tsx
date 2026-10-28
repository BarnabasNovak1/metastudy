import { Button } from '@/components/ui/button';
import { Check, X as XIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUserData } from '@/contexts/UserDataContext';
import { auth } from '../../firebase';
import { useEffect, useState } from 'react';
import { createPortalSession } from '@/lib/billing';

// Direct Stripe payment links — set these env vars once billing is configured.
// Empty = checkout buttons show a "not available" toast.
const PRO_DIRECT_URL = import.meta.env.VITE_STRIPE_PRO_URL || "";
const ADVANCED_DIRECT_URL = import.meta.env.VITE_STRIPE_ADVANCED_URL || "";
const BASIC_DIRECT_URL = import.meta.env.VITE_STRIPE_BASIC_URL || "";
const ADDON_DIRECT_URL = import.meta.env.VITE_STRIPE_ADDON_URL || "";

// Tier order for comparison (lower index = lower tier)
const TIER_ORDER = ['free', 'basic', 'advanced', 'pro'] as const;
type TierName = typeof TIER_ORDER[number];

const getTierIndex = (tier: string): number => {
  const idx = TIER_ORDER.indexOf(tier.toLowerCase() as TierName);
  return idx >= 0 ? idx : 0;
};

interface PricingProps {
  showCurrentPlan?: boolean;
}

export const Pricing = ({ showCurrentPlan = false }: PricingProps) => {
  const { toast } = useToast();
  // OPTIMIZED: Use context instead of duplicate Firestore listener
  const { uid, plan: contextPlan, profile } = useUserData();
  const [billingLoading, setBillingLoading] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  
  // Check if user is part of an institution (verified institution user)
  const isInstitutionUser = !!(profile as any)?.verifiedInstitution;
  
  // Use context plan when showCurrentPlan is true, otherwise default to 'free'
  const currentPlan = showCurrentPlan ? (contextPlan || 'free') : 'free';

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => { setEmail(u?.email || null); });
    return () => unsub();
  }, []);

  const currentTierIndex = getTierIndex(currentPlan);

  const getButtonText = (tierName: string): { text: string; isCurrentPlan: boolean; action: 'upgrade' | 'downgrade' | 'current' } => {
    // If not showing current plan logic, always return "Buy Plan" for paid tiers
    if (!showCurrentPlan) {
      if (tierName === 'free') {
        return { text: 'Current by default', isCurrentPlan: false, action: 'current' };
      }
      return { text: 'Buy Plan', isCurrentPlan: false, action: 'upgrade' };
    }
    
    const tierIndex = getTierIndex(tierName);
    if (tierIndex === currentTierIndex) {
      return { text: 'Your Plan', isCurrentPlan: true, action: 'current' };
    } else if (tierIndex > currentTierIndex) {
      return { text: 'Upgrade', isCurrentPlan: false, action: 'upgrade' };
    } else {
      return { text: 'Downgrade', isCurrentPlan: false, action: 'downgrade' };
    }
  };

  const openDirect = (baseUrl: string) => {
    if (!uid) { toast({ title: 'Sign in required', description: 'Please sign in to continue.', variant: 'destructive' }); return; }
    try {
      const u = new URL(baseUrl);
      if (email) u.searchParams.set('prefilled_email', email);
      u.searchParams.set('client_reference_id', uid);
      window.open(u.toString(), '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast({ title: 'Link error', description: e?.message || 'Invalid checkout link', variant: 'destructive' });
    }
  };

  const goSubDirect = (tier: 'BASIC'|'ADVANCED'|'PRO') => {
    const map = { BASIC: BASIC_DIRECT_URL, ADVANCED: ADVANCED_DIRECT_URL, PRO: PRO_DIRECT_URL } as const;
    const url = map[tier];
    if (!url) return toast({ title: 'Payments coming soon', description: 'Online billing isn\'t enabled yet — please check back later.', variant: 'destructive' });
    openDirect(url);
  };

  const goAddonDirect = () => {
    if (!ADDON_DIRECT_URL) return toast({ title: 'Payments coming soon', description: 'Online billing isn\'t enabled yet — please check back later.', variant: 'destructive' });
    openDirect(ADDON_DIRECT_URL);
  };

  // Open billing portal for downgrades/cancellation
  const openBillingPortal = async () => {
    if (billingLoading) return;
    const customerId = profile?.stripe_customer_id;
    if (!customerId) {
      toast({ title: 'No subscription found', description: 'Please contact support to manage your subscription.', variant: 'destructive' });
      return;
    }
    setBillingLoading(true);
    try {
      const res = await createPortalSession(String(customerId));
      const url = (res as any)?.url;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        toast({ title: 'Portal error', description: 'Could not open billing portal.', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Portal error', description: e?.message || 'Could not open billing portal.', variant: 'destructive' });
    } finally {
      setBillingLoading(false);
    }
  };

  return (
    <section id="pricing" className="py-16">
      <div className="max-w-7xl mx-auto px-4">
        <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">Plans</p>
        <h2 className="text-4xl font-bold tracking-tight mb-4">Pick your workload</h2>
        <div className="max-w-3xl mb-12">
          <p className="text-muted-foreground text-lg">Pick the plan that matches your workload. Upgrade anytime — manage everything in the billing portal.</p>
          <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm md:text-base">
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> Every tool, one place</li>
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> No ads</li>
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> No hidden fees</li>
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> No data selling</li>
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> AI or manual — your call</li>
            <li className="flex items-center gap-2 font-medium"><span className="text-primary">✔</span> Cancel anytime</li>
          </ul>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Free */}
          <div className={`relative border-2 border-foreground p-6 bg-card hard-shadow-sm ${getButtonText('free').isCurrentPlan ? 'border-2 border-green-500 ring-2 ring-green-500/20' : ''}`}>
            {getButtonText('free').isCurrentPlan && (
              <div className="absolute -top-3 left-6 text-xs px-2 py-0.5 rounded-full bg-green-500 text-white font-medium">Your Plan</div>
            )}
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-semibold">Free</h3>
              <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-foreground/80">Get started</span>
            </div>
            <div className="mt-2 text-3xl font-bold">$0<span className="text-base text-muted-foreground font-medium">/mo</span></div>
            <p className="text-xs text-green-600 font-medium mt-1">No credit card required</p>
            <ul className="mt-4 text-sm space-y-2">
              <li>• 5 credits / month</li>
              <li>• 3,000 word limit per use</li>
              <li className="pt-2 flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> AI Chat</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Summarizer</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Flashcard generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Adaptive Tutor (practice)</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Quiz generator</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Lesson Generator</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Career Launchpad</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Study Feed</li>
            </ul>
            <Button 
              className={`w-full mt-8 ${getButtonText('free').isCurrentPlan ? 'bg-green-500 hover:bg-green-600' : ''}`} 
              disabled={getButtonText('free').isCurrentPlan || billingLoading}
              onClick={() => showCurrentPlan && getButtonText('free').action === 'downgrade' && openBillingPortal()}
            >
              {billingLoading && showCurrentPlan && getButtonText('free').action === 'downgrade' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</>
              ) : getButtonText('free').text}
            </Button>
          </div>

          {/* Basic */}
          <div className={`relative border-2 border-foreground p-6 bg-card hard-shadow-sm ${getButtonText('basic').isCurrentPlan ? 'border-2 border-green-500 ring-2 ring-green-500/20' : ''}`}>
            {getButtonText('basic').isCurrentPlan && (
              <div className="absolute -top-3 left-6 text-xs px-2 py-0.5 rounded-full bg-green-500 text-white font-medium">Your Plan</div>
            )}
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-semibold">Basic</h3>
            </div>
            <div className="mt-2 text-3xl font-bold">$9.99<span className="text-base text-muted-foreground font-medium">/mo</span></div>
            <ul className="mt-6 text-sm space-y-2">
              <li>• 50 credits / month</li>
              <li>• 5,000 word limit per use</li>
              <li className="pt-2 flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> AI Chat</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Summarizer</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Flashcard generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Quiz generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Adaptive Tutor (practice)</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Lesson Generator</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Career Launchpad</li>
              <li className="flex items-center gap-2 text-muted-foreground"><XIcon className="w-4 h-4 text-red-500" /> Study Feed</li>
            </ul>
            <Button 
              className={`w-full mt-8 ${getButtonText('basic').isCurrentPlan ? 'bg-green-500 hover:bg-green-600' : ''}`} 
              onClick={() => {
                if (isInstitutionUser) return;
                if (getButtonText('basic').isCurrentPlan) return;
                if (showCurrentPlan && getButtonText('basic').action === 'downgrade') openBillingPortal();
                else goSubDirect('BASIC');
              }}
              disabled={isInstitutionUser || getButtonText('basic').isCurrentPlan || billingLoading}
              title={isInstitutionUser ? 'Your plan is managed by your institution' : undefined}
            >
              {billingLoading && showCurrentPlan && getButtonText('basic').action === 'downgrade' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</>
              ) : getButtonText('basic').text}
            </Button>
          </div>

          {/* Advanced - Featured */}
          <div className={`relative border-2 border-foreground p-6 bg-accent/40 hard-shadow ${getButtonText('advanced').isCurrentPlan ? 'border-2 border-green-500 ring-2 ring-green-500/20' : 'border-primary/40'}`}>
            {getButtonText('advanced').isCurrentPlan ? (
              <div className="absolute -top-3 left-6 text-xs px-2 py-0.5 rounded-full bg-green-500 text-white font-medium">Your Plan</div>
            ) : (
              <div className="absolute -top-3 left-6 text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground">Most Popular</div>
            )}
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-semibold">Advanced</h3>
            </div>
            <div className="mt-2 text-3xl font-bold">$16.99<span className="text-base text-muted-foreground font-medium">/mo</span></div>
            <ul className="mt-6 text-sm space-y-2">
              <li>• 200 credits / month</li>
              <li>• 7,000 word limit per use</li>
              <li className="pt-2 flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> AI Chat</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Summarizer</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Flashcard generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Quiz generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Adaptive Tutor + Lesson Generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Career Launchpad</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Study Feed</li>
            </ul>
            <Button 
              className={`w-full mt-8 ${getButtonText('advanced').isCurrentPlan ? 'bg-green-500 hover:bg-green-600' : ''}`} 
              onClick={() => {
                if (isInstitutionUser) return;
                if (getButtonText('advanced').isCurrentPlan) return;
                if (showCurrentPlan && getButtonText('advanced').action === 'downgrade') openBillingPortal();
                else goSubDirect('ADVANCED');
              }}
              disabled={isInstitutionUser || getButtonText('advanced').isCurrentPlan || billingLoading}
              title={isInstitutionUser ? 'Your plan is managed by your institution' : undefined}
            >
              {billingLoading && showCurrentPlan && getButtonText('advanced').action === 'downgrade' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</>
              ) : getButtonText('advanced').text}
            </Button>
          </div>

          {/* Pro */}
          <div className={`relative border-2 border-foreground p-6 bg-card hard-shadow-sm ${getButtonText('pro').isCurrentPlan ? 'border-2 border-green-500 ring-2 ring-green-500/20' : ''}`}>
            {getButtonText('pro').isCurrentPlan && (
              <div className="absolute -top-3 left-6 text-xs px-2 py-0.5 rounded-full bg-green-500 text-white font-medium">Your Plan</div>
            )}
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-semibold">Pro</h3>
            </div>
            <div className="mt-2 text-3xl font-bold">$19.99<span className="text-base text-muted-foreground font-medium">/mo</span></div>
            <ul className="mt-6 text-sm space-y-2">
              <li>• 500 credits / month</li>
              <li>• 15,000 word limit per use</li>
              <li className="pt-2 flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> AI Chat</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Summarizer</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Flashcard generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Quiz generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Adaptive Tutor + Lesson Generator</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Career Launchpad</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Study Feed</li>
            </ul>
            <Button 
              className={`w-full mt-8 ${getButtonText('pro').isCurrentPlan ? 'bg-green-500 hover:bg-green-600' : ''}`} 
              onClick={() => {
                if (isInstitutionUser) return;
                if (getButtonText('pro').isCurrentPlan) return;
                if (showCurrentPlan && getButtonText('pro').action === 'downgrade') openBillingPortal();
                else goSubDirect('PRO');
              }}
              disabled={isInstitutionUser || getButtonText('pro').isCurrentPlan || billingLoading}
              title={isInstitutionUser ? 'Your plan is managed by your institution' : undefined}
            >
              {billingLoading && showCurrentPlan && getButtonText('pro').action === 'downgrade' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</>
              ) : getButtonText('pro').text}
            </Button>
          </div>
        </div>

        {!isInstitutionUser && (
          <div className="mt-12 border-2 border-foreground p-6 bg-card hard-shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Need just a bit more?</h3>
              <p className="text-sm text-muted-foreground">Buy +10 credits for $1. Add-on credits keep your plan's per-credit word limit (Free: 3,000 • Basic: 5,000 • Advanced: 7,000 • Pro: 15,000).</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={goAddonDirect}>Buy +10 credits for $1</Button>
            </div>
          </div>
        )}
        
        {isInstitutionUser && showCurrentPlan && (
          <div className="mt-12 border-2 border-foreground p-6 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
            <h3 className="text-lg font-semibold">Institution Plan</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Your plan is managed by your institution. Plan changes and billing are handled by your institution administrator.
            </p>
          </div>
        )}

        {/* Institution Pricing Section */}
        {!isInstitutionUser && (
          <div className="mt-12 border-2 border-foreground p-8 bg-accent/50 hard-shadow">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary font-medium">For Schools & Institutions</span>
                </div>
                <h3 className="text-2xl font-bold">Institution Plans</h3>
                <p className="text-muted-foreground mt-2 max-w-lg">
                  Get up to <span className="font-semibold text-green-600">20% off</span> when you purchase plans for your students, teachers, or employees in bulk. Perfect for schools, universities, and organizations.
                </p>
                <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Volume discounts for 50+ users</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Centralized billing & admin dashboard</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Dedicated onboarding support</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-600" /> Custom usage analytics</li>
                </ul>
              </div>
              <div className="flex flex-col items-center gap-3">
                <Button 
                  size="lg" 
                  className="px-8"
                  onClick={() => window.location.href = '/pricing?contact=institution'}
                >
                  Contact Us for Pricing
                </Button>
                <span className="text-xs text-muted-foreground">Response within 24 hours</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
