import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../../firebase";
import { getAchievements, ALL_ACHIEVEMENTS, getLevelInfo, getRankTitle } from "@/lib/achievements";
import MetaStudyLogo from "@/assets/metastudy-icon.png";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Trophy } from "lucide-react";
import { getAchievementVisual } from "@/lib/achievement-icons";
import { Progress } from "@/components/ui/progress";
import { useUserData } from "@/contexts/UserDataContext";

const Achievements = () => {
  const userData = useUserData();
  const [uid, setUid] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [earned, setEarned] = useState<Record<string, { earned_at: string }>>({});
  const [streakCurrent, setStreakCurrent] = useState<number>(0);
  const [streakLongest, setStreakLongest] = useState<number>(0);
  const navigate = useNavigate();
  const version = import.meta.env.VITE_APP_VERSION || "";

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

  useEffect(() => {
    const run = async () => {
      if (!uid) { setLoading(false); return; }
      try {
        const { data } = await getAchievements(uid);
        setEarned(data.earned || {});
        setStreakCurrent(data.streak_current || 0);
        setStreakLongest(data.streak_longest || 0);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [uid]);

  // Get XP from context
  const xp = userData.xp;

  // Build list with earned first
  const items = Object.entries(ALL_ACHIEVEMENTS).sort(([idA], [idB]) => {
    const a = !!earned[idA];
    const b = !!earned[idB];
    if (a === b) return idA.localeCompare(idB);
    return a ? -1 : 1;
  });

  const getVisual = (id: string) => getAchievementVisual(id);

  const [filter, setFilter] = useState<'all' | 'earned' | 'unearned'>('earned');
  const filteredItems = items.filter(([id]) => {
    if (filter === 'all') return true;
    const have = !!earned[id];
    return filter === 'earned' ? have : !have;
  });

  return (
    <div className="min-h-screen">
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
              <button onClick={() => navigate('/achievements')} className="px-3 py-1 rounded-md transition-colors hover:bg-accent/50 hover:text-foreground/90">Achievements</button>
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
          <div className="flex items-center gap-2 mb-6">
            <Trophy className="w-6 h-6 text-yellow-500" />
            <h1 className="text-3xl font-bold">Achievements</h1>
          </div>

          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !uid ? (
            <p className="text-muted-foreground">Please sign in to view achievements.</p>
          ) : (
            <>
              <div className="mb-6">
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">Level</div>
                  <div className="font-medium">{getRankTitle(xp)}</div>
                </div>
                {(() => {
                  const info = getLevelInfo(xp);
                  const pct = Math.min(100, Math.max(0, Math.round(info.progress * 100)));
                  return (
                    <div className="mt-1">
                      <Progress value={pct} />
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{info.current} / {info.required}</span>
                        <span>Lvl {info.level + 1}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="mb-6 text-sm text-muted-foreground">
                <span>Current streak: </span><span className="font-medium">{streakCurrent} days</span>
                <span className="ml-4">Longest streak: </span><span className="font-medium">{streakLongest} days</span>
              </div>
              <div className="mb-4 flex items-center gap-2">
                <Button size="sm" variant={filter==='earned'?'default':'outline'} onClick={()=>setFilter('earned')}>Earned</Button>
                <Button size="sm" variant={filter==='unearned'?'default':'outline'} onClick={()=>setFilter('unearned')}>Yet to Achieve</Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredItems.map(([id, meta]) => {
                  const have = !!earned[id];
                  return (
                    <div
                      key={id}
                      className={`group relative overflow-hidden rounded-xl border transition-colors ${have ? 'bg-card border-primary/30' : 'bg-muted/20'}`}
                    >
                      <div className="flex items-center gap-3 p-4">
                        {(() => {
                          const { emoji, cls } = getVisual(id);
                          return (
                            <div className={`w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity ${cls} ${have ? '' : 'grayscale opacity-50 group-hover:opacity-70'}`}>
                              <span className="text-3xl leading-none select-none" role="img" aria-label={meta.title}>{emoji}</span>
                            </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className={`font-semibold truncate ${have ? '' : 'text-foreground/70'}`}>{meta.title}</h3>
                            {have && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">Earned</span>}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{meta.description}</p>
                          {have && <p className="text-xs text-muted-foreground mt-2">{new Date(earned[id].earned_at).toLocaleString()}</p>}
                        </div>
                      </div>
                      {!have && (
                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/40 pointer-events-none group-hover:to-background/50" />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default Achievements;
