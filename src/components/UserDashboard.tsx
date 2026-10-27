import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, BookOpen, Brain, Target, Flame, Star, Pencil, Check, X, Plus, Trash2 } from 'lucide-react';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { DashboardStatsSkeleton, ChartSkeleton } from '@/components/ui/SkeletonLoaders';
import { useUserData } from '@/contexts/UserDataContext';

interface DashboardProps {
  uid: string;
  counters?: any;
  xp?: number;
  streakCurrent?: number;
  streakLongest?: number;
  daysTotal?: number;
}

interface ActivityData {
  date: string;
  sessions: number;
  generations: number;
}

interface ToolUsage {
  tool: string;
  count: number;
  color: string;
}

const TOOL_COLORS: Record<string, string> = {
  chat: '#8b5cf6',
  summarizer: '#06b6d4',
  flashcards: '#f59e0b',
  quiz: '#10b981',
  helper: '#ec4899',
  career: '#6366f1',
};

const TOOL_LABELS: Record<string, string> = {
  chat: 'AI Chat',
  summarizer: 'Summarizer',
  flashcards: 'Flashcards',
  quiz: 'Quiz',
  helper: 'Lesson Generator',
  career: 'Career',
};

// Goal types matching StatsPopup
const GOAL_TYPES = {
  days: { label: 'Study days', counterKey: null, achievementKey: 'days_total', defaultTarget: 5, max: 7 },
  flashcards: { label: 'Flashcards created', counterKey: 'flashcards', achievementKey: null, defaultTarget: 10, max: 100 },
  quizzes: { label: 'Quizzes created', counterKey: 'quizzes', achievementKey: null, defaultTarget: 3, max: 50 },
  summaries: { label: 'Summaries created', counterKey: 'summaries', achievementKey: null, defaultTarget: 5, max: 50 },
  posts: { label: 'Feed posts', counterKey: 'posts', achievementKey: null, defaultTarget: 3, max: 20 },
} as const;

type GoalType = keyof typeof GOAL_TYPES;

interface GoalItem {
  type: GoalType;
  target: number;
}

interface WeeklyGoalsData {
  goals: GoalItem[];
}

const DEFAULT_GOALS: GoalItem[] = [
  { type: 'days', target: 5 },
  { type: 'quizzes', target: 3 },
  { type: 'flashcards', target: 5 },
];

export function UserDashboard({ uid, counters, xp = 0, streakCurrent = 0, streakLongest = 0, daysTotal = 0 }: DashboardProps) {
  const { toast } = useToast();
  // OPTIMIZED: Use context data instead of duplicate Firestore reads
  const { weeklyCounters: contextWeeklyCounters, weeklyDays: contextWeeklyDays, refreshWeeklyCounters } = useUserData();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [loading, setLoading] = useState(true);
  const [activityData, setActivityData] = useState<ActivityData[]>([]);
  const [toolUsage, setToolUsage] = useState<ToolUsage[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>(DEFAULT_GOALS);
  const [editingGoals, setEditingGoals] = useState(false);
  const [tempGoals, setTempGoals] = useState<GoalItem[]>(DEFAULT_GOALS);
  const [isDark, setIsDark] = useState(false);
  
  // Use context data for weekly stats
  const weeklyCounters = contextWeeklyCounters || {};
  const weeklyDays = contextWeeklyDays;

  // Detect dark mode
  useEffect(() => {
    const checkDark = () => document.documentElement.classList.contains('dark');
    setIsDark(checkDark());
    const observer = new MutationObserver(() => setIsDark(checkDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // XP bar theming: in light mode, track shows remaining (#FEF8CA). In dark mode, indicator is #FEF8CA.
  const progressTrackStyle = !isDark ? { backgroundColor: '#FEF8CA' } as React.CSSProperties : undefined;
  const progressIndicatorStyle = isDark ? { backgroundColor: '#FEF8CA' } as React.CSSProperties : undefined;

  // Get current value for a goal type - uses weekly counters for weekly goals
  const getValue = (type: GoalType): number => {
    const config = GOAL_TYPES[type];
    if (config.achievementKey === 'days_total') {
      // Use weekly days count instead of all-time daysTotal
      return weeklyDays;
    }
    if (config.counterKey) {
      return weeklyCounters[config.counterKey] || 0;
    }
    return 0;
  };

  useEffect(() => {
    if (!uid) return;
    loadDashboardData();
    loadWeeklyGoals();
  }, [uid, timeRange]);

  useEffect(() => {
    if (!uid) return;
    refreshWeeklyCounters();
  }, [uid]);

  const loadWeeklyGoals = async () => {
    if (!uid) return;
    // Try cache first
    const cacheKey = `weeklyGoals_${uid}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached) as WeeklyGoalsData;
        if (Array.isArray(data.goals) && data.goals.length > 0) {
          const validGoals = data.goals.filter(g => g.type in GOAL_TYPES && typeof g.target === 'number');
          if (validGoals.length > 0) {
            setGoals(validGoals);
            setTempGoals(validGoals);
            return;
          }
        }
      }
    } catch {}
    // Fallback to Firestore
    try {
      const goalsRef = doc(db, 'users', uid, 'settings', 'weeklyGoals');
      const goalsSnap = await getDoc(goalsRef);
      if (goalsSnap.exists()) {
        const data = goalsSnap.data() as WeeklyGoalsData;
        if (Array.isArray(data.goals) && data.goals.length > 0) {
          const validGoals = data.goals.filter(g => g.type in GOAL_TYPES && typeof g.target === 'number');
          if (validGoals.length > 0) {
            setGoals(validGoals);
            setTempGoals(validGoals);
            try { localStorage.setItem(cacheKey, JSON.stringify({ goals: validGoals })); } catch {}
            return;
          }
        }
      }
      setGoals(DEFAULT_GOALS);
      setTempGoals(DEFAULT_GOALS);
    } catch (error) {
      console.error('Failed to load weekly goals:', error);
    }
  };


  const saveWeeklyGoals = async () => {
    if (!uid) return;
    try {
      const goalsRef = doc(db, 'users', uid, 'settings', 'weeklyGoals');
      await setDoc(goalsRef, { goals: tempGoals });
      setGoals(tempGoals);
      setEditingGoals(false);
      // Update cache
      try { localStorage.setItem(`weeklyGoals_${uid}`, JSON.stringify({ goals: tempGoals })); } catch {}
      toast({
        title: 'Goals updated',
        description: 'Your weekly goals have been saved.',
      });
    } catch (error) {
      toast({
        title: 'Failed to save goals',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const updateGoalTarget = (index: number, target: number) => {
    const updated = [...tempGoals];
    const config = GOAL_TYPES[updated[index].type];
    updated[index] = { ...updated[index], target: Math.max(1, Math.min(config.max, target)) };
    setTempGoals(updated);
  };

  const updateGoalType = (index: number, newType: GoalType) => {
    const updated = [...tempGoals];
    const config = GOAL_TYPES[newType];
    updated[index] = { type: newType, target: config.defaultTarget };
    setTempGoals(updated);
  };

  const addGoal = () => {
    const usedTypes = new Set(tempGoals.map(g => g.type));
    const availableType = (Object.keys(GOAL_TYPES) as GoalType[]).find(t => !usedTypes.has(t));
    if (availableType) {
      const config = GOAL_TYPES[availableType];
      setTempGoals([...tempGoals, { type: availableType, target: config.defaultTarget }]);
    }
  };

  const removeGoal = (index: number) => {
    setTempGoals(tempGoals.filter((_, i) => i !== index));
  };

  const getAvailableTypes = (currentType: GoalType): GoalType[] => {
    const usedTypes = new Set(tempGoals.map(g => g.type));
    return (Object.keys(GOAL_TYPES) as GoalType[]).filter(t => t === currentType || !usedTypes.has(t));
  };

  const cancelEditGoals = () => {
    setTempGoals(goals);
    setEditingGoals(false);
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Generate mock data based on counters (in production, you'd query actual session logs)
      const mockActivity = generateActivityData(days, counters);
      setActivityData(mockActivity);

      const mockToolUsage = generateToolUsage(counters);
      setToolUsage(mockToolUsage);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateActivityData = (days: number, counters: any) => {
    const data: { date: string; sessions: number; generations: number }[] = [];
    const today = new Date();
    
    // Calculate total generations from counters
    const totalGens = (counters?.flashcards || 0) + (counters?.quizzes || 0) + 
                      (counters?.summaries || 0) + (counters?.posts || 0) + 
                      (counters?.chats || 0) + (counters?.lessons || 0);
    
    // Get weeklyDays array to know which days had activity
    const weeklyDaysArray: string[] = Array.isArray(weeklyCounters?.weeklyDays) ? weeklyCounters.weeklyDays : [];
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      // Check if this day is in weeklyDays (had activity)
      const hadActivity = weeklyDaysArray.includes(dateKey);
      
      // For days with activity, distribute generations roughly
      // For today, show a minimum of 1 if there was activity
      const isToday = i === 0;
      const gensForDay = hadActivity ? (isToday && totalGens > 0 ? Math.max(1, Math.floor(totalGens / Math.max(1, weeklyDaysArray.length))) : Math.floor(totalGens / Math.max(1, weeklyDaysArray.length))) : 0;
      
      data.push({
        date: dateStr,
        sessions: hadActivity ? 1 : 0,
        generations: gensForDay,
      });
    }
    
    return data;
  };

  const generateToolUsage = (counters: any) => {
    // Map tool names to actual counter keys
    const toolMapping: Record<string, string> = {
      'chat': 'chats',
      'summarizer': 'summaries', 
      'flashcards': 'flashcards',
      'quiz': 'quizzes',
      'helper': 'lessons',
      'career': 'career_uses',
    };
    const tools = ['chat', 'summarizer', 'flashcards', 'quiz', 'helper', 'career'];
    return tools.map(tool => ({
      tool: TOOL_LABELS[tool],
      count: counters?.[toolMapping[tool]] || 0,
      color: TOOL_COLORS[tool],
    })).filter(t => t.count > 0);
  };

  // Calculate total generations from all-time counters
  const totalGenerations = useMemo(() => {
    return (counters?.flashcards || 0) + (counters?.quizzes || 0) + 
           (counters?.summaries || 0) + (counters?.posts || 0) + 
           (counters?.chats || 0) + (counters?.lessons || 0);
  }, [counters]);

  const stats = useMemo(() => {
    const totalSessions = activityData.reduce((sum, d) => sum + (d as any).sessions, 0);
    const totalDailyGens = activityData.reduce((sum, d) => sum + (d as any).generations, 0);
    const activeDays = activityData.filter(d => (d as any).sessions > 0).length;

    return { totalSessions, totalDailyGens, activeDays };
  }, [activityData]);

  const weeklyChange = useMemo(() => {
    if (activityData.length < 14) return 0;
    const thisWeek = activityData.slice(-7).reduce((s, d) => s + (d as any).generations, 0);
    const lastWeek = activityData.slice(-14, -7).reduce((s, d) => s + (d as any).generations, 0);
    if (lastWeek === 0) return 100;
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  }, [activityData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <DashboardStatsSkeleton />
        <div className="grid gap-6 md:grid-cols-2">
          <ChartSkeleton height={250} />
          <ChartSkeleton height={250} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Study Dashboard</h2>
        <Select value={timeRange} onValueChange={(v: any) => setTimeRange(v)}>
          <SelectTrigger className="w-36 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-tour="stats-overview">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Generations</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalGenerations.toLocaleString()}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              {weeklyChange >= 0 ? (
                <TrendingUp className="h-3 w-3 mr-1 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-1 text-red-500" />
              )}
              <span className={weeklyChange >= 0 ? 'text-green-500' : 'text-red-500'}>
                {weeklyChange >= 0 ? '+' : ''}{weeklyChange}%
              </span>
              <span className="ml-1">vs last week</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Study Sessions</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSessions}</div>
            <p className="text-xs text-muted-foreground">
              {stats.activeDays} active days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Current Streak</CardTitle>
            <Flame className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{streakCurrent} days</div>
            <p className="text-xs text-muted-foreground">
              Best: {streakLongest} days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total XP</CardTitle>
            <Star className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{xp.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {daysTotal} total days
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2" data-tour="stats-charts">
        {/* Activity Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Study Activity</CardTitle>
            <CardDescription>Generations per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Bar 
                    dataKey="generations" 
                    fill="hsl(var(--primary))" 
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Tool Usage Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Feature Usage</CardTitle>
            <CardDescription>Most used study tools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={toolUsage}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="tool"
                    label={({ tool, percent }) => `${tool} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {toolUsage.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly Goals */}
      <Card data-tour="stats-goals">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Weekly Goals
            </CardTitle>
            {!editingGoals ? (
              <Button variant="ghost" size="sm" onClick={() => setEditingGoals(true)} className="h-8 px-2">
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={saveWeeklyGoals} className="h-8 px-2 text-green-600 hover:text-green-700">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEditGoals} className="h-8 px-2 text-red-600 hover:text-red-700">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(editingGoals ? tempGoals : goals).map((goal, index) => {
            const config = GOAL_TYPES[goal.type];
            const current = getValue(goal.type);
            const target = goal.target;
            const isComplete = current >= target;
            const progressValue = target > 0 ? (Math.min(current, target) / target) * 100 : 0;

            return (
              <div key={goal.type} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  {editingGoals ? (
                    <>
                      <div className="flex items-center gap-2 flex-1">
                        <select
                          value={goal.type}
                          onChange={(e) => updateGoalType(index, e.target.value as GoalType)}
                          className="h-7 text-xs w-[145px] rounded-md border border-input/80 bg-background px-2 py-1 
                            text-foreground focus:outline-none focus:ring-1 focus:ring-ring
                            appearance-none cursor-pointer
                            bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')]
                            bg-no-repeat bg-[right_6px_center] bg-[length:10px] pr-6"
                        >
                          {getAvailableTypes(goal.type).map(t => (
                            <option key={t} value={t}>
                              {GOAL_TYPES[t].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max={config.max}
                          value={tempGoals[index]?.target || config.defaultTarget}
                          onChange={(e) => updateGoalTarget(index, parseInt(e.target.value) || 1)}
                          className="w-16 h-7 text-center"
                        />
                        {tempGoals.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removeGoal(index)} className="h-7 w-7 p-0">
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <span>{config.label}</span>
                      <span className={isComplete ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                        {Math.min(current, target)}/{target}
                        {isComplete && ' ✓'}
                      </span>
                    </>
                  )}
                </div>
                {!editingGoals && (
                  <Progress 
                    value={progressValue} 
                    className={isComplete ? 'bg-green-100 [&>div]:bg-green-500' : ''} 
                    style={isComplete ? undefined : progressTrackStyle}
                    indicatorStyle={isComplete ? undefined : progressIndicatorStyle}
                  />
                )}
              </div>
            );
          })}
          
          {/* Add Goal Button (when editing) */}
          {editingGoals && tempGoals.length < Object.keys(GOAL_TYPES).length && (
            <Button variant="outline" size="sm" onClick={addGoal} className="w-full h-8">
              <Plus className="w-4 h-4 mr-2" />
              Add Goal
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
