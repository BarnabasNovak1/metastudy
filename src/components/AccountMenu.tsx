import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, functions as fbFunctions } from "../../firebase";
import { signOut, User as FirebaseUser } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { useUserData } from "@/contexts/UserDataContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserCircle, LogOut, CreditCard, RefreshCw, HelpCircle, AlertCircle } from "lucide-react";
import { ReportIssueDialog } from "@/components/ReportIssueDialog";
import { useToast } from "@/hooks/use-toast";
import { getRankTitle, getLevelInfo } from "@/lib/achievements";
import { Progress } from "@/components/ui/progress";

interface AccountMenuProps {
  user: FirebaseUser;
  theme: "light" | "dark";
  onThemeToggle: () => void;
}

interface Profile {
  plan: string;
  uses_this_month: number;
  monthly_quota: number;
  first_name?: string;
  last_name?: string;
  stripe_customer_id?: string;
  username?: string;
}

export const AccountMenu = ({ user, theme }: AccountMenuProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const userData = useUserData();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [periodEndIso, setPeriodEndIso] = useState<string | null>(null);
  const [renewIso, setRenewIso] = useState<string | null>(null);
  const [cycleDay, setCycleDay] = useState<number | null>(null);
  const [syncingUsage, setSyncingUsage] = useState(false);
  const [syncingRenewal, setSyncingRenewal] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const itemHoverClass = "hover:bg-accent focus:bg-accent hover:text-foreground focus:text-foreground";

  // Sync usage counters (reset if expired)
  const handleSyncUsage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncingUsage) return;
    setSyncingUsage(true);
    try {
      const fixExpiredCounters = httpsCallable(fbFunctions, 'fixExpiredCounters');
      const result = await fixExpiredCounters();
      const data = (result as any).data;
      if (data.fixed) {
        toast({ title: 'Usage Synced!', description: data.message });
        window.location.reload();
      } else {
        toast({ title: 'Already Up to Date', description: data.message || 'Usage is current' });
      }
    } catch (e: any) {
      toast({ title: 'Sync Failed', description: e?.message || 'Could not sync usage', variant: 'destructive' });
    } finally {
      setSyncingUsage(false);
    }
  };

  // Sync renewal date from Stripe
  const handleSyncRenewal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncingRenewal) return;
    setSyncingRenewal(true);
    try {
      const syncRenewsAt = httpsCallable(fbFunctions, 'syncRenewsAtFromStripe');
      const result = await syncRenewsAt();
      const data = (result as any).data;
      if (data.synced) {
        toast({ title: 'Renewal Date Synced!', description: data.message });
        window.location.reload();
      } else {
        toast({ title: 'Could Not Sync', description: data.message || 'No active subscription found' });
      }
    } catch (e: any) {
      toast({ title: 'Sync Failed', description: e?.message || 'Could not sync renewal date', variant: 'destructive' });
    } finally {
      setSyncingRenewal(false);
    }
  };

  // Get all data from context
  useEffect(() => {
    if (!user?.uid) {
      setProfile({ plan: "free", uses_this_month: 0, monthly_quota: 0 });
      return;
    }

    const plan = userData.profile.plan || "free";
    let monthly_quota = typeof userData.profile.monthly_quota === "number" ? userData.profile.monthly_quota : 0;
    
    // Infer monthly_quota from plan if not set
    if (monthly_quota === 0) {
      if (plan === 'free') monthly_quota = 5;
      else if (plan === 'basic') monthly_quota = 50;
      else if (plan === 'advanced') monthly_quota = 200;
      else if (plan === 'pro') monthly_quota = 500;
    }

    setProfile({
      plan,
      uses_this_month: typeof userData.counters.uses_this_month === 'number' ? userData.counters.uses_this_month : 0,
      monthly_quota,
      first_name: userData.profile.first_name,
      last_name: userData.profile.last_name,
      username: userData.username || undefined,
    });

    const r = (userData.profile as any)?.renews_at;
    setRenewIso(typeof r === 'string' ? r : null);
    const cd = (userData.profile as any)?.usage_cycle_day;
    setCycleDay(typeof cd === 'number' ? Math.min(28, Math.max(1, Math.floor(cd))) : null);
    
    const end = typeof userData.counters.usage_period_end === 'string' ? userData.counters.usage_period_end : null;
    setPeriodEndIso(end);
  }, [user?.uid, userData.profile, userData.counters, userData.username]);

  // Study days are now counted when generating content (via incrementMonthlyUsage)
  // Removed page-load visit tracking to only count active study days

  const handleSignOut = async () => {
    await signOut(auth);
    navigate("/");
  };

  
  const xp = userData.xp;
  Number(userData.achievements.days_total || 0);
  
  // Check if user is part of an institution (verified institution user)
  const isInstitutionUser = !!(userData.profile as any)?.verifiedInstitution;

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case "student":
        return "text-blue-400";
      case "pro":
        return "text-purple-400";
      case "unlimited":
      case "premium":
        return "text-primary";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full overflow-hidden">
          {userData.photoURL ? (
            <img src={userData.photoURL} alt="Profile" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <UserCircle className="h-5 w-5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">Manage Account</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
            {profile?.username && (
              <p className="text-xs leading-none text-muted-foreground">@{profile.username}</p>
            )}
          </div>
        </DropdownMenuLabel>
        {/* XP Level + Progress (clickable to Achievements) */}
        <div
          className="px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors"
          onClick={() => navigate('/account?tab=achievements')}
          role="button"
          aria-label="View Achievements"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Level</div>
            <div className="text-xs font-medium">{getRankTitle(xp)}</div>
          </div>
          <div className="mt-1">
            {(() => {
              const info = getLevelInfo(xp);
              const pct = Math.min(100, Math.max(0, Math.round(info.progress * 100)));
              return (
                <div>
                  <Progress
                    value={pct}
                    indicatorStyle={theme === 'dark' ? { backgroundColor: '#FEF8CA' } : undefined}
                    style={theme !== 'dark' ? { backgroundColor: '#FEF8CA' } : undefined}
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{info.current} / {info.required}</span>
                    <span>Lvl {info.level + 1}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
        <DropdownMenuSeparator />

        {/* Manage Account (Usage & Achievements) */}
        <DropdownMenuItem onClick={() => navigate('/account')} className={itemHoverClass}>
          <UserCircle className="mr-2 h-4 w-4" />
          <span>Manage Account</span>
        </DropdownMenuItem>

        {/* Plan action (buy/upgrade) - hidden for institution users */}
        {profile && !isInstitutionUser && (
          (() => {
            const p = (profile.plan || 'free').toLowerCase();
            if (p === 'pro') return null;
            const label = p === 'free' ? 'Buy Plan' : (p === 'basic' || p === 'advanced') ? 'Upgrade Plan' : 'Buy Plan';
            return (
              <DropdownMenuItem
                onClick={() => navigate('/account?tab=usage')}
                className={itemHoverClass}
              >
                <CreditCard className="mr-2 h-4 w-4" />
                <span>{label}</span>
              </DropdownMenuItem>
            );
          })()
        )}
        
        {/* Buy add-on uses - opens in new tab (hidden for institution users) */}
        {!isInstitutionUser && (
          <DropdownMenuItem
            onClick={() => {
              const url = import.meta.env.VITE_STRIPE_ADDON_URL || '';
              if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
              } else {
                toast({ title: 'Payments coming soon', description: 'Online billing isn\'t enabled yet — please check back later.', variant: 'destructive' });
              }
            }}
            className={itemHoverClass}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Buy +10 credits ($1)</span>
          </DropdownMenuItem>
        )}
        
        {/* Guided Tour */}
        <DropdownMenuItem
          onClick={() => {
            // Clear tour completed flag and reload to trigger tour
            localStorage.removeItem('metastudy_tour_completed');
            localStorage.setItem('metastudy_just_signed_up', 'true');
            window.location.reload();
          }}
          className={itemHoverClass}
        >
          <HelpCircle className="mr-2 h-4 w-4" />
          <span>Tutorial</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {profile && (
          <>
            <div
              className="px-2 py-2 cursor-pointer hover:bg-accent/40 transition-colors rounded"
              onClick={() => navigate('/account?tab=usage')}
              role="button"
              aria-label="Manage plan"
            >
              <div className="text-xs text-muted-foreground mb-1">Current Plan</div>
              <div className={`text-sm font-semibold capitalize ${getPlanColor(profile.plan)}`}>
                {profile.plan} Plan
              </div>
            </div>
            <div className="px-2 py-2">
              {/* Usage count with sync button */}
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-muted-foreground">Credits This Month</div>
                <button
                  onClick={handleSyncUsage}
                  disabled={syncingUsage}
                  className="p-0.5 rounded hover:bg-accent/60 transition-colors disabled:opacity-50"
                  title="Sync credits"
                >
                  <RefreshCw className={`w-3 h-3 text-muted-foreground ${syncingUsage ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div 
                className="text-sm font-medium cursor-pointer hover:text-primary transition-colors"
                onClick={() => navigate('/account?tab=usage')}
              >
                {profile.uses_this_month} / {profile.monthly_quota} credits
              </div>
              
              {/* Reset date with sync button - only show renewal sync for paid users */}
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-muted-foreground">
                  {(() => {
                    const computeNext = (anchor: number) => {
                      const now = new Date();
                      const y = now.getFullYear();
                      const m = now.getMonth();
                      const d = now.getDate();
                      const dt = d < anchor ? new Date(y, m, anchor) : new Date(y, m + 1, anchor);
                      return dt.toLocaleDateString();
                    };
                    const shown = periodEndIso ? new Date(periodEndIso).toLocaleDateString() : (renewIso ? new Date(renewIso).toLocaleDateString() : (cycleDay ? computeNext(cycleDay) : '-'));
                    return <>Resets: {shown}</>;
                  })()}
                </div>
                {/* Only show Stripe sync for paid plans - free users use the usage sync button above */}
                {profile.plan !== 'free' && (
                  <button
                    onClick={handleSyncRenewal}
                    disabled={syncingRenewal}
                    className="p-0.5 rounded hover:bg-accent/60 transition-colors disabled:opacity-50"
                    title="Sync renewal date from Stripe"
                  >
                    <RefreshCw className={`w-3 h-3 text-muted-foreground ${syncingRenewal ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem onClick={() => setReportOpen(true)} className={itemHoverClass}>
          <AlertCircle className="mr-2 h-4 w-4" />
          <span>Report Issue</span>
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleSignOut} className={`text-red-400 hover:text-red-500 focus:text-red-500 ${itemHoverClass}`}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ReportIssueDialog open={reportOpen} onOpenChange={setReportOpen} />
    </DropdownMenu>
  );
}
