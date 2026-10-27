import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import MetaStudyLogo from "@/assets/metastudy-icon.png";
import { Moon, Sun } from "lucide-react";
import { SEO } from "@/components/SEO";

const AccountUsage = () => {
  const userData = useUserData();
  const isInstitutionUser = !!(userData.profile as any)?.verifiedInstitution;
  const [uid, setUid] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const navigate = useNavigate();
  const version = import.meta.env.VITE_APP_VERSION || "";
  // XP bar theming parity: in light mode, track shows remaining (#FEF8CA); in dark mode, indicator uses #FEF8CA.
  const xpTrackStyle = !isDark ? ({ backgroundColor: '#FEF8CA' } as React.CSSProperties) : undefined;
  const xpIndicatorStyle = isDark ? ({ backgroundColor: '#FEF8CA' } as React.CSSProperties) : undefined;

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setUid(u?.uid || null));
    return () => unsub();
  }, []);

  // Get data from context
  useEffect(() => {
    if (!uid) { 
      setLoading(false); 
      setData(null); 
      return; 
    }
    
    const combinedData = {
      ...userData.profile,
      uses_this_month: typeof userData.counters.uses_this_month === 'number' ? userData.counters.uses_this_month : 0,
      extra_uses_balance: typeof userData.counters.extra_uses_balance === 'number' ? userData.counters.extra_uses_balance : 0,
      extra_uses_used: typeof userData.counters.extra_uses_used === 'number' ? userData.counters.extra_uses_used : 0,
      usage_period_end: typeof userData.counters.usage_period_end === 'string' ? userData.counters.usage_period_end : null,
    };
    
    setData(combinedData);
    setLoading(userData.loading);
  }, [uid, userData.profile, userData.counters, userData.loading]);

  const uses = typeof data?.uses_this_month === "number" ? data.uses_this_month : 0;
  const plan = (data?.plan || "free") as string;
  
  // Infer monthly_quota from plan if not set
  let quota = typeof data?.monthly_quota === "number" ? data.monthly_quota : 0;
  if (quota === 0) {
    if (plan === 'free') quota = 5;
    else if (plan === 'basic') quota = 50;
    else if (plan === 'advanced') quota = 200;
    else if (plan === 'pro') quota = 500;
  }
  
  const wordLimit = typeof data?.word_limit === "number" ? data.word_limit : undefined;
  const extraBal = typeof data?.extra_uses_balance === "number" ? data.extra_uses_balance : 0;
  const extraUsed = typeof data?.extra_uses_used === "number" ? data.extra_uses_used : 0;
  const periodEnd = typeof data?.usage_period_end === 'string' ? data.usage_period_end : null;
  const renewsAt = typeof data?.renews_at === 'string' ? data.renews_at : null;
  const cycleDay = typeof data?.usage_cycle_day === 'number' ? Math.min(28, Math.max(1, Math.floor(data.usage_cycle_day))) : null;
  const computeNextFromDay = (anchor: number) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    return (d < anchor ? new Date(y, m, anchor) : new Date(y, m + 1, anchor)).toLocaleDateString();
  };

  return (
    <div className="min-h-screen">
      <SEO
        title="Account Usage • metastudy-e1ba2.web.app"
        description="View your monthly uses, add-on balance, and reset date."
        canonical={typeof window !== 'undefined' ? window.location.origin + "/account" : undefined}
      />
      {/* Top nav (consistent) */}
      <div className="sticky top-0 z-20 w-full backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <button onClick={() => navigate('/')} className="inline-flex items-center">
              <img src={MetaStudyLogo} alt="Logo" className="w-20 h-20 object-contain hidden dark:block" />
              <img src={MetaStudyLogo} alt="Logo" className="w-20 h-20 object-contain dark:hidden" />
            </button>
            <nav className="hidden md:flex items-center gap-2 text-base">
              <button onClick={() => navigate('/')} className="px-3 py-1 rounded-md transition-colors hover:bg-accent/50 hover:text-foreground/90">Home</button>
              <button onClick={() => navigate('/pricing')} className="px-3 py-1 rounded-md transition-colors hover:bg-accent/50 hover:text-foreground/90">Pricing</button>
              <button onClick={() => navigate('/faq')} className="px-3 py-1 rounded-md transition-colors hover:bg-accent/50 hover:text-foreground/90">FAQ</button>
              <button onClick={() => navigate('/usage')} className="px-3 py-1 rounded-md transition-colors hover:bg-accent/50 hover:text-foreground/90">Usage</button>
            </nav>
            <div className="text-sm text-muted-foreground">{version ? `v${version}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/auth')}>Sign in</Button>
            <Button variant="outline" size="sm" onClick={toggleTheme} aria-label="Toggle theme">
              {isDark ? (<Sun className="w-4 h-4" />) : (<Moon className="w-4 h-4" />)}
            </Button>
          </div>
        </div>
      </div>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-3xl font-bold mb-6">Usage Dashboard</h1>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !uid ? (
            <p className="text-muted-foreground">Please sign in to view your usage.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-6">
                <h2 className="text-lg font-semibold">Plan Overview</h2>
                <div className="mt-2 space-y-1 text-sm">
                  <div><span className="text-muted-foreground">Plan:</span> <span className="font-medium uppercase">{plan}</span></div>
                  <div><span className="text-muted-foreground">Monthly Quota:</span> <span className="font-medium">{quota}</span></div>
                  {typeof wordLimit === 'number' && (
                    <div><span className="text-muted-foreground">Words per use:</span> <span className="font-medium">{wordLimit.toLocaleString()}</span></div>
                  )}
                </div>
              </Card>

              <Card className="p-6">
                <h2 className="text-lg font-semibold">This Month</h2>
                <div className="mt-3">
                  <Progress value={quota > 0 ? Math.min(100, (uses / quota) * 100) : 0} indicatorStyle={xpIndicatorStyle} style={xpTrackStyle} />
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{uses} of {quota} uses</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Usage resets on: {periodEnd ? new Date(periodEnd).toLocaleDateString() : (renewsAt ? new Date(renewsAt).toLocaleDateString() : (cycleDay ? computeNextFromDay(cycleDay) : '-'))}
                </div>
              </Card>

              {!isInstitutionUser && (
                <Card className="p-6">
                  <h2 className="text-lg font-semibold">Add-on Uses</h2>
                  {extraBal > 0 || extraUsed > 0 ? (
                    <div className="mt-2 space-y-1 text-sm">
                      <div><span className="text-muted-foreground">Remaining:</span> <span className="font-medium">{extraBal}</span></div>
                      <div><span className="text-muted-foreground">Used:</span> <span className="font-medium">{extraUsed}</span></div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">No add-on uses purchased yet.</p>
                  )}
                  <div className="mt-4">
                    <Button variant="outline" size="sm" onClick={() => navigate('/pricing')}>Buy +10 uses</Button>
                  </div>
                </Card>
              )}
            </div>
          )}

          <div className="mt-10 text-sm text-muted-foreground">
            <p>Free/Basic add-on uses allow up to 5,000 words per use. Advanced/Pro keep their plan's per-use word limits when using add-ons (Advanced: 7,000 • Pro: 15,000).</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AccountUsage;
