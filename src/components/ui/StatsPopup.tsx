import { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Target, Flame, Trophy, BookOpen, Pencil, Check, X, BarChart3, ChevronRight, Layers, FileText, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Available goal types users can choose from
const GOAL_TYPES = {
  days: { label: 'Study days', icon: BookOpen, counterKey: null, achievementKey: 'days_total', defaultTarget: 5, max: 7 },
  flashcards: { label: 'Flashcards created', icon: Layers, counterKey: 'flashcards', achievementKey: null, defaultTarget: 10, max: 100 },
  quizzes: { label: 'Quizzes created', icon: Target, counterKey: 'quizzes', achievementKey: null, defaultTarget: 3, max: 50 },
  summaries: { label: 'Summaries created', icon: FileText, counterKey: 'summaries', achievementKey: null, defaultTarget: 5, max: 50 },
  posts: { label: 'Feed posts', icon: MessageSquare, counterKey: 'posts', achievementKey: null, defaultTarget: 3, max: 20 },
} as const;

type GoalType = keyof typeof GOAL_TYPES;

interface GoalItem {
  type: GoalType;
  target: number;
}

interface WeeklyGoalsData {
  goals: GoalItem[];
}

interface StatsPopupProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  counters?: any;
  achievements?: any;
}

const DEFAULT_GOALS: GoalItem[] = [
  { type: 'days', target: 5 },
  { type: 'quizzes', target: 3 },
  { type: 'flashcards', target: 5 },
];

export const StatsPopup = ({ userId, isOpen, onClose, counters, achievements }: StatsPopupProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  // OPTIMIZED: Use context data instead of duplicate Firestore reads
  const { weeklyCounters: contextWeeklyCounters, weeklyDays: contextWeeklyDays, refreshWeeklyCounters } = useUserData();
  const [goals, setGoals] = useState<GoalItem[]>(DEFAULT_GOALS);
  const [tempGoals, setTempGoals] = useState<GoalItem[]>(DEFAULT_GOALS);
  const [editingGoals, setEditingGoals] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);
  
  // Use context data for weekly stats
  const weeklyCounters = useMemo(() => {
    const { weekStartedAt, weeklyDays, ...counters } = contextWeeklyCounters || {};
    return counters as Record<string, number>;
  }, [contextWeeklyCounters]);
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
      // Use weekly days count instead of all-time
      return weeklyDays;
    }
    if (config.counterKey) {
      return weeklyCounters[config.counterKey] || 0;
    }
    return 0;
  };

  // Calculate weekly progress percentage
  useMemo(() => {
    if (goals.length === 0) return 0;
    const total = goals.reduce((sum, goal) => {
      const current = getValue(goal.type);
      const progress = Math.min(current, goal.target) / goal.target;
      return sum + (isNaN(progress) ? 0 : progress);
    }, 0);
    return Math.round((total / goals.length) * 100);
  }, [goals, counters, achievements]);

  // Streak and XP stats
  const streakCurrent = achievements?.streak_current || 0;
  const streakLongest = achievements?.streak_longest || 0;
  const xp = counters?.xp || 0;

  useEffect(() => {
    if (userId && isOpen) {
      loadWeeklyGoals();
      // OPTIMIZED: Use context refresh instead of duplicate read
      refreshWeeklyCounters();
    }
  }, [userId, isOpen]);

  const loadWeeklyGoals = async () => {
    if (!userId) return;
    
    // OPTIMIZATION: Try cache first to avoid Firestore read
    const cacheKey = `weeklyGoals_${userId}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached) as WeeklyGoalsData;
        if (Array.isArray(data.goals) && data.goals.length > 0) {
          const validGoals = data.goals.filter(g => g.type in GOAL_TYPES && typeof g.target === 'number');
          if (validGoals.length > 0) {
            setGoals(validGoals);
            setTempGoals(validGoals);
            return; // Use cached data, skip Firestore read
          }
        }
      }
    } catch {}
    
    // Fallback to Firestore if no cache
    try {
      const goalsRef = doc(db, 'users', userId, 'settings', 'weeklyGoals');
      const goalsSnap = await getDoc(goalsRef);
      if (goalsSnap.exists()) {
        const data = goalsSnap.data() as WeeklyGoalsData;
        if (Array.isArray(data.goals) && data.goals.length > 0) {
          const validGoals = data.goals.filter(g => g.type in GOAL_TYPES && typeof g.target === 'number');
          if (validGoals.length > 0) {
            setGoals(validGoals);
            setTempGoals(validGoals);
            // Cache for next time
            try { localStorage.setItem(cacheKey, JSON.stringify({ goals: validGoals })); } catch {}
            return;
          }
        }
      }
      // Use defaults if no valid data
      setGoals(DEFAULT_GOALS);
      setTempGoals(DEFAULT_GOALS);
    } catch (error) {
      console.error('Failed to load weekly goals:', error);
    }
  };

  const saveWeeklyGoals = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const goalsRef = doc(db, 'users', userId, 'settings', 'weeklyGoals');
      await setDoc(goalsRef, { goals: tempGoals });
      setGoals(tempGoals);
      setEditingGoals(false);
      // Update cache
      try { localStorage.setItem(`weeklyGoals_${userId}`, JSON.stringify({ goals: tempGoals })); } catch {}
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
    } finally {
      setLoading(false);
    }
  };

  const cancelEditGoals = () => {
    setTempGoals(goals);
    setEditingGoals(false);
  };

  const addGoal = () => {
    // Find first unused goal type
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

  const updateGoalType = (index: number, newType: GoalType) => {
    const updated = [...tempGoals];
    const config = GOAL_TYPES[newType];
    updated[index] = { type: newType, target: config.defaultTarget };
    setTempGoals(updated);
  };

  const updateGoalTarget = (index: number, target: number) => {
    const updated = [...tempGoals];
    const config = GOAL_TYPES[updated[index].type];
    updated[index] = { ...updated[index], target: Math.max(1, Math.min(config.max, target)) };
    setTempGoals(updated);
  };

  const goToStatsPage = () => {
    onClose();
    navigate('/account?tab=stats');
  };

  // Get available goal types (not already used)
  const getAvailableTypes = (currentType: GoalType): GoalType[] => {
    const usedTypes = new Set(tempGoals.map(g => g.type));
    return (Object.keys(GOAL_TYPES) as GoalType[]).filter(t => t === currentType || !usedTypes.has(t));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Your Stats
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Flame className="w-3 h-3 text-orange-500" />
                Current Streak
              </div>
              <div className="text-lg font-bold">{streakCurrent} days</div>
              <div className="text-[10px] text-muted-foreground">Best: {streakLongest} days</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Trophy className="w-3 h-3 text-yellow-500" />
                Total XP
              </div>
              <div className="text-lg font-bold">{xp.toLocaleString()}</div>
            </Card>
          </div>

          {/* Weekly Goals Progress */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                <span className="text-sm font-semibold">Weekly Goals</span>
              </div>
              {!editingGoals ? (
                <Button variant="ghost" size="sm" onClick={() => setEditingGoals(true)} className="h-7 px-2">
                  <Pencil className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={cancelEditGoals} className="h-7 px-2" disabled={loading}>
                    <X className="w-3 h-3" />
                  </Button>
                  <Button variant="default" size="sm" onClick={saveWeeklyGoals} className="h-7 px-2" disabled={loading}>
                    <Check className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {/* Dynamic Goals */}
              {(editingGoals ? tempGoals : goals).map((goal, index) => {
                const config = GOAL_TYPES[goal.type];
                const Icon = config.icon;
                const current = getValue(goal.type);
                const target = goal.target;
                const isComplete = current >= target;
                const progressValue = target > 0 ? (Math.min(current, target) / target) * 100 : 0;

                return (
                  <div key={goal.type} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      {editingGoals ? (
                        <>
                          <div className="flex items-center gap-1 flex-1">
                            <select
                              value={goal.type}
                              onChange={(e) => updateGoalType(index, e.target.value as GoalType)}
                              className="h-8 text-xs w-full min-w-0 rounded-md border border-input/80 bg-background px-2 py-1 
                                text-foreground
                                focus:outline-none focus:ring-1 focus:ring-ring
                                appearance-none cursor-pointer
                                bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')]
                                bg-no-repeat bg-[right_6px_center] bg-[length:10px]
                                pr-6"
                            >
                              {getAvailableTypes(goal.type).map(t => (
                                <option key={t} value={t}>
                                  {GOAL_TYPES[t].label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={1}
                              max={config.max}
                              value={tempGoals[index]?.target || config.defaultTarget}
                              onChange={(e) => updateGoalTarget(index, parseInt(e.target.value) || 1)}
                              className="w-16 h-8 text-xs text-right shrink-0"
                            />
                            {tempGoals.length > 1 && (
                              <Button variant="ghost" size="sm" onClick={() => removeGoal(index)} className="h-6 w-6 p-0">
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex items-center gap-1">
                            <Icon className="w-3 h-3" />
                            {config.label}
                          </span>
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
                        className={`h-2 ${isComplete ? '[&>div]:bg-green-500' : ''}`}
                        style={progressTrackStyle}
                        indicatorStyle={isComplete ? undefined : progressIndicatorStyle}
                      />
                    )}
                  </div>
                );
              })}

              {/* Add Goal Button (when editing) */}
              {editingGoals && tempGoals.length < Object.keys(GOAL_TYPES).length && (
                <Button variant="outline" size="sm" onClick={addGoal} className="w-full h-7 text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Add Goal
                </Button>
              )}
            </div>

            {/* Completion message */}
            {!editingGoals && goals.every(g => getValue(g.type) >= g.target) && goals.length > 0 && (
              <div className="mt-3 p-2 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-xs font-medium">
                  <Trophy className="w-4 h-4" />
                  🎉 All weekly goals completed!
                </div>
              </div>
            )}
          </Card>

          {/* Motivation */}
          <Card className="p-3 bg-primary/5 border-primary/20">
            <div className="text-xs text-center">
              <span className="font-medium">Keep up the great work!</span>
              <p className="text-muted-foreground mt-1">
                {streakCurrent > 0 
                  ? `You're on a ${streakCurrent}-day streak. Don't break it!`
                  : 'Start studying today to begin a new streak!'}
              </p>
            </div>
          </Card>

          {/* See More Button */}
          <Button variant="outline" className="w-full" onClick={goToStatsPage}>
            <span>See more statistics</span>
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { type GoalItem, type WeeklyGoalsData };
