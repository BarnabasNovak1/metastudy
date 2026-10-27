import { db } from "../../firebase";
import { doc, getDoc, setDoc, updateDoc, increment } from "firebase/firestore";

export type AchievementId =
  | "streak_1"
  | "streak_3"
  | "streak_10"
  | "streak_30"
  | "streak_50"
  | "streak_100"
  | "streak_200"
  | "streak_300"
  | "streak_400"
  | "streak_500"
  | "streak_600"
  | "streak_700"
  | "streak_800"
  | "streak_900"
  | "streak_1000"
  | "perfect_quiz"
  | "first_quiz"
  | "quiz_10"
  | "quiz_50"
  | "quiz_100"
  | "library_5_quizzes"
  | "library_20_quizzes"
  | "flashcard_master"
  | "first_flashcards"
  | "uploads_10"
  | "night_owl"
  | "quiz_master_10_90"
  | "sessions_20"
  | "flashcards_review_500"
  | "chat_questions_100"
  | "followups_10"
  | "deep_diver_5"
  | "flashcard_sets_5"
  // Feed & Challenges & Groups
  | "first_post"
  | "posts_10"
  | "posts_100"
  | "posts_1000"
  | "first_challenge_join"
  | "challenges_50"
  | "challenges_100"
  | "challenges_1000"
  | "first_group"
  | "groups_10"
  | "group_members_10"
  | "group_members_50"
  | "group_members_100"
  | "group_members_1000"
  
  // Career Launchpad
  | "first_resume"
  | "resume_export"
  | "linkedin_saved"
  | "interview_completed"
  | "career_plan_saved";

export const ALL_ACHIEVEMENTS: Record<AchievementId, { title: string; description: string }> = {
  streak_1: { title: "Day One", description: "Use metastudy-e1ba2.web.app for 1 day." },
  streak_3: { title: "Getting Warm", description: "3 days in a row." },
  streak_10: { title: "On a Roll", description: "10 days in a row." },
  streak_30: { title: "Elite Discipline", description: "Study daily for 30 days straight." },
  streak_50: { title: "Dedicated", description: "50 days in a row." },
  streak_100: { title: "Centurion", description: "100 days in a row." },
  streak_200: { title: "Committed", description: "200 days in a row." },
  streak_300: { title: "Relentless", description: "300 days in a row." },
  streak_400: { title: "Unstoppable", description: "400 days in a row." },
  streak_500: { title: "Halfway to Legend", description: "500 days in a row." },
  streak_600: { title: "Legend Rising", description: "600 days in a row." },
  streak_700: { title: "Marathoner", description: "700 days in a row." },
  streak_800: { title: "Enduring", description: "800 days in a row." },
  streak_900: { title: "Epic", description: "900 days in a row." },
  streak_1000: { title: "Ultimate User", description: "1000 days in a row." },
  perfect_quiz: { title: "Perfectionist", description: "Score 100% on a quiz." },
  first_quiz: { title: "First Steps", description: "Complete your first quiz." },
  quiz_10: { title: "Quizzer", description: "Complete 10 quizzes." },
  quiz_50: { title: "Quiz Grinder", description: "Complete 50 quizzes." },
  quiz_100: { title: "Quiz Machine", description: "Complete 100 quizzes." },
  library_5_quizzes: { title: "Collector", description: "Save 5 quizzes to your library." },
  library_20_quizzes: { title: "Archivist", description: "Save 20 quizzes to your library." },
  flashcard_master: { title: "Flashcard Master", description: "Master every card in a set." },
  first_flashcards: { title: "Starter Badge", description: "Generate your first flashcards." },
  uploads_10: { title: "Scholar Collector", description: "Upload 10+ documents." },
  night_owl: { title: "Night Owl", description: "Study after midnight." },
  quiz_master_10_90: { title: "Quiz Master", description: "Score ≥90% on 10 quizzes." },
  sessions_20: { title: "Persistent Learner", description: "Complete 20 study sessions." },
  flashcards_review_500: { title: "Memory Machine", description: "Review 500 flashcards." },
  chat_questions_100: { title: "AI Conversationalist", description: "Ask 100+ questions to the AI Tutor." },
  followups_10: { title: "Curiosity Unlocked", description: "Ask 10 follow-up questions." },
  deep_diver_5: { title: "Focused Thinker", description: "Ask 5 questions in the same thread." },
  flashcard_sets_5: { title: "Builder of Knowledge", description: "Create 5+ custom flashcard sets." },
  
  // Feed & Challenges & Groups
  first_post: { title: "First Post", description: "Posted to the Feed for the first time." },
  posts_10: { title: "Consistent Poster", description: "Posted to the Feed 10 times." },
  posts_100: { title: "Community Pillar", description: "Posted to the Feed 100 times." },
  posts_1000: { title: "Legendary Poster", description: "Posted to the Feed 1000 times." },
  first_challenge_join: { title: "Challenger", description: "Joined your first challenge." },
  challenges_50: { title: "Challenge Enthusiast", description: "Joined 50 challenges." },
  challenges_100: { title: "Challenge Veteran", description: "Joined 100 challenges." },
  challenges_1000: { title: "Challenge Machine", description: "Joined 1000 challenges." },
  first_group: { title: "Founder", description: "Created your first group." },
  groups_10: { title: "Community Builder", description: "Created 10 groups." },
  group_members_10: { title: "Rising Community", description: "Your group reached 10 members." },
  group_members_50: { title: "Thriving Community", description: "Your group reached 50 members." },
  group_members_100: { title: "Dominant Community", description: "Your group reached 100 members." },
  group_members_1000: { title: "Mega Community", description: "Your group reached 1000 members." },
  
  // Career Launchpad
  first_resume: { title: "First Resume", description: "Save your first resume from the Resume Canvas." },
  resume_export: { title: "PDF Ready", description: "Download a resume as PDF." },
  linkedin_saved: { title: "LinkedIn Writer", description: "Save your first LinkedIn post draft." },
  interview_completed: { title: "Interview Survivor", description: "Complete an AI interview session." },
  career_plan_saved: { title: "Planned Path", description: "Save a career plan with recommendations." },
};

const ACHIEVEMENT_XP: Record<AchievementId, number> = {
  streak_1: 10,
  streak_3: 20,
  streak_10: 50,
  streak_30: 120,
  streak_50: 200,
  streak_100: 350,
  streak_200: 600,
  streak_300: 900,
  streak_400: 1200,
  streak_500: 1600,
  streak_600: 2000,
  streak_700: 2500,
  streak_800: 3000,
  streak_900: 3500,
  streak_1000: 4000,
  perfect_quiz: 50,
  first_quiz: 15,
  quiz_10: 80,
  quiz_50: 250,
  quiz_100: 500,
  library_5_quizzes: 60,
  library_20_quizzes: 200,
  flashcard_master: 250,
  first_flashcards: 20,
  uploads_10: 100,
  night_owl: 20,
  quiz_master_10_90: 400,
  sessions_20: 120,
  flashcards_review_500: 300,
  chat_questions_100: 150,
  followups_10: 60,
  deep_diver_5: 60,
  flashcard_sets_5: 120,
  
  first_post: 40,
  posts_10: 120,
  posts_100: 500,
  posts_1000: 4000,
  first_challenge_join: 30,
  challenges_50: 200,
  challenges_100: 400,
  challenges_1000: 3500,
  first_group: 80,
  groups_10: 400,
  group_members_10: 100,
  group_members_50: 300,
  group_members_100: 800,
  group_members_1000: 5000,
  
  first_resume: 80,
  resume_export: 60,
  linkedin_saved: 80,
  interview_completed: 150,
  career_plan_saved: 120,
};

export type AchievementsDoc = {
  streak_current?: number;
  streak_longest?: number;
  last_visit_date?: string; // YYYY-MM-DD
  days_total?: number; // total unique days used
  earned?: Record<string, { earned_at: string }>;
};

function formatYMD(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export async function incrementCounterAndAwardOn(
  uid: string,
  counterKey: string,
  thresholds: Array<[number, AchievementId]>
): Promise<void> {
  const ref = doc(db, "users", uid, "meta", "counters");
  // Use atomic increment to avoid overwriting other fields (like uses_this_month)
  await setDoc(ref, { [counterKey]: increment(1) }, { merge: true });
  // Also track the weekly counter for weekly goals (handles week rollover reset)
  try { await incrementWeeklyCounter(uid, counterKey); } catch {}
  // OPTIMIZED: Only read back if there are thresholds to check
  if (thresholds.length > 0) {
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as any) : {};
    const current = Number(data[counterKey] || 0);
    for (const [n, id] of thresholds) {
      if (current === n) {
        await awardAchievement(uid, id);
      }
    }
  }
}

// Action-based XP awarding
export type ActionKind = 'chat' | 'summary' | 'flashcards' | 'quiz';
export function computeActionXP(kind: ActionKind, meta: any = {}): number {
  try {
    switch (kind) {
      case 'chat': {
        // Light reward per successful assistant response
        return 1;
      }
      case 'summary': {
        const t = String(meta.summaryType || '').toLowerCase();
        const base = t === 'detailed' || t === 'academic' ? 12 : t === 'notes' ? 10 : t === 'key_points' ? 9 : 8; // brief default 8
        const wcRaw = Number(meta.wordCount || 0);
        const wc = Number.isFinite(wcRaw) ? Math.max(0, wcRaw) : 0;
        const bonus = Math.min(4, Math.floor(wc / 250)); // up to +4 for longer inputs
        return base + bonus;
      }
      case 'flashcards': {
        const nRaw = Number(meta.cardCount ?? meta.count ?? 10);
        const n = Number.isFinite(nRaw) ? Math.max(1, nRaw) : 10;
        // Scale gently with size; cap to avoid jumps
        const base = 6; // small set
        const tiers = Math.min(5, Math.floor(n / 10)); // 0..5 for up to 50 cards
        return base + tiers * 2; // 6,8,10,12,14,16
      }
      case 'quiz': {
        const qRaw = Number(meta.questionCount ?? meta.count ?? 5);
        const q = Number.isFinite(qRaw) ? Math.max(1, qRaw) : 5;
        const base = 7; // quizzes are harder than flashcards summaries
        const tiers = Math.min(5, Math.floor(q / 10)); // up to 50
        let xp = base + tiers * 3; // 7,10,13,16,19,22
        if (String(meta.quizMode||'mcq') === 'short') xp += 2; // short-answer a bit harder to generate/grade
        if (meta.includeEssay) xp += 3;
        return Math.min(25, xp);
      }
      default:
        return 0;
    }
  } catch { return 0; }
}

export async function awardActionXP(uid: string, kind: ActionKind, meta?: any): Promise<void> {
  const amt = computeActionXP(kind, meta);
  if (amt > 0) await addXP(uid, amt);
}

// XP and Rank System
export function getRankTitle(xp: number): string {
  // Harder ranks to reach
  if (xp >= 20000) return "Legendary Scholar";
  if (xp >= 9000) return "Master Scholar";
  if (xp >= 3000) return "Rising Scholar";
  if (xp >= 1000) return "Knowledge Seeker";
  if (xp >= 300) return "Dedicated Student";
  return "Curious Learner";
}

export async function addXP(uid: string, amount: number): Promise<void> {
  if (!amount || !isFinite(amount)) return;
  const ref = doc(db, "users", uid, "meta", "counters");
  const safeAmount = Math.max(0, Math.floor(amount));
  
  // OPTIMIZED: Use increment() instead of read+write (saves 1 read per XP gain!)
  await updateDoc(ref, { 
    xp: increment(safeAmount) 
  });
  
  // Note: Level-up detection now happens in components via UserDataContext
  // watching the xp value change, rather than here in the transaction
}

// Leveling system (harder):
// Requirement to reach next level starts at 50 XP and increases by +20 each level.
// Level 1 requires 50, level 2 +70 (total 120), level 3 +90 (total 210), etc.
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  const a1 = 50; // first level delta
  const d = 20;  // increment per level
  // Sum of arithmetic series: n/2 * [2a1 + (n-1)d]
  const n = level;
  const total = (n * (2 * a1 + (n - 1) * d)) / 2;
  return Math.floor(total);
}

export function getLevelInfo(xp: number): { level: number; current: number; required: number; progress: number } {
  const safeXp = Math.max(0, Math.floor(xp || 0));
  // Find highest level such that xpForLevel(level) <= xp
  let lo = 0, hi = 10000; // generous upper bound
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (xpForLevel(mid) <= safeXp) lo = mid; else hi = mid - 1;
  }
  const level = lo;
  const base = xpForLevel(level);
  // Delta to next level must match the xpForLevel curve exactly
  const nextTotal = xpForLevel(level + 1);
  const nextReq = Math.max(1, nextTotal - base);
  const current = Math.max(0, safeXp - base);
  const required = nextReq;
  const progress = required > 0 ? Math.min(1, current / required) : 1;
  return { level, current, required, progress };
}

function isNextDay(prev: string, curr: string): boolean {
  const [py, pm, pd] = prev.split("-").map(Number);
  const prevDate = new Date(py, pm - 1, pd);
  const next = new Date(prevDate);
  next.setDate(prevDate.getDate() + 1);
  return formatYMD(next) === curr;
}

export async function recordDailyVisit(uid: string): Promise<void> {
  const today = formatYMD();

  // Night Owl - any activity between midnight and 5am local time
  try {
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) {
      await awardAchievement(uid, "night_owl");
    }
  } catch {}

  // Always update weekly days (no cache check - ensure it works)
  try {
    const weeklyRef = doc(db, "users", uid, "meta", "weeklyCounters");
    const currentMonday = getMondayTimestamp();
    const weeklySnap = await getDoc(weeklyRef);
    
    console.log('[recordDailyVisit] today:', today, 'currentMonday:', currentMonday);
    
    if (weeklySnap.exists()) {
      const weeklyData = weeklySnap.data() as any;
      const storedWeekStart = Number(weeklyData.weekStartedAt || 0);
      const weeklyDays: string[] = Array.isArray(weeklyData.weeklyDays) ? weeklyData.weeklyDays : [];
      
      console.log('[recordDailyVisit] storedWeekStart:', storedWeekStart, 'weeklyDays:', weeklyDays);
      
      // Check if same week (storedWeekStart should equal currentMonday for same week)
      if (storedWeekStart === currentMonday) {
        // Same week - add today to unique days set if not already present
        if (!weeklyDays.includes(today)) {
          const newDays = [...weeklyDays, today];
          console.log('[recordDailyVisit] Same week, adding today. New weeklyDays:', newDays);
          await setDoc(weeklyRef, { weeklyDays: newDays }, { merge: true });
        } else {
          console.log('[recordDailyVisit] Today already in weeklyDays');
        }
      } else {
        // New week or first time - reset with just today
        console.log('[recordDailyVisit] New week (stored:', storedWeekStart, 'vs current:', currentMonday, '), resetting');
        await setDoc(weeklyRef, { ...buildWeeklyReset(weeklyData, currentMonday), weeklyDays: [today] }, { merge: true });
      }
    } else {
      // Initialize weekly counters with today
      console.log('[recordDailyVisit] No doc exists, initializing weeklyCounters');
      await setDoc(weeklyRef, { weekStartedAt: currentMonday, weeklyDays: [today] }, { merge: true });
    }
  } catch (e) {
    console.error('[recordDailyVisit] Failed to update weekly days:', e);
  }
  
  // Check localStorage for daily visit cache (only for streak tracking, not weekly days)
  const cacheKey = `daily_visit_${uid}`;
  let alreadyRecordedToday = false;
  
  try {
    alreadyRecordedToday = localStorage.getItem(cacheKey) === today;
  } catch {}
  
  // If daily visit already recorded, skip streak updates
  if (alreadyRecordedToday) {
    return;
  }
  
  const ref = doc(db, "users", uid, "meta", "achievements");
  const snap = await getDoc(ref);
  let data: AchievementsDoc = snap.exists() ? (snap.data() as AchievementsDoc) : {};
  const last = data.last_visit_date;
  
  // If already counted today in Firestore, just update cache and return
  if (last === today) {
    try { localStorage.setItem(cacheKey, today); } catch {}
    return;
  }
  
  let curr = data.streak_current || 0;
  let days = Number(data.days_total || 0);
  if (!last) {
    curr = 1;
    days = 1;
  } else if (isNextDay(last, today)) {
    curr = (curr || 0) + 1;
    days = days + 1;
  } else {
    curr = 1;
    days = days + 1; // new unique day, but not consecutive
  }
  const longest = Math.max(curr, data.streak_longest || 0);
  data = { ...data, last_visit_date: today, streak_current: curr, streak_longest: longest, days_total: days };
  await setDoc(ref, data, { merge: true });
  
  // Cache today's visit to avoid future reads
  try { localStorage.setItem(cacheKey, today); } catch {}

  // Streak achievements thresholds
  const thresholds: Array<[number, AchievementId]> = [
    [1, "streak_1"],
    [3, "streak_3"],
    [10, "streak_10"],
    [30, "streak_30"],
    [50, "streak_50"],
    [100, "streak_100"],
    [200, "streak_200"],
    [300, "streak_300"],
    [400, "streak_400"],
    [500, "streak_500"],
    [600, "streak_600"],
    [700, "streak_700"],
    [800, "streak_800"],
    [900, "streak_900"],
    [1000, "streak_1000"],
  ];
  for (const [n, id] of thresholds) {
    if (curr === n) await awardAchievement(uid, id);
  }
}

export async function awardAchievement(uid: string, id: AchievementId): Promise<void> {
  const ref = doc(db, "users", uid, "meta", "achievements");
  const snap = await getDoc(ref);
  const base: AchievementsDoc = snap.exists() ? (snap.data() as AchievementsDoc) : {};
  const earned = base.earned || {};
  if (earned[id]) return; // already earned
  earned[id] = { earned_at: new Date().toISOString() };
  await setDoc(ref, { ...base, earned }, { merge: true });
  try {
    // Notify UI listeners in the browser to show a celebration banner
    const meta = ALL_ACHIEVEMENTS[id];
    const detail = { id, title: meta?.title, description: meta?.description };
    window.dispatchEvent(new CustomEvent('achievement-earned', { detail }));
  } catch {}
  const bonus = ACHIEVEMENT_XP[id] || 0;
  if (bonus > 0) {
    await addXP(uid, bonus);
  }
}

export async function getAchievements(uid: string): Promise<{ data: AchievementsDoc; all: typeof ALL_ACHIEVEMENTS }>{
  const ref = doc(db, "users", uid, "meta", "achievements");
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as AchievementsDoc) : {};
  return { data, all: ALL_ACHIEVEMENTS };
}

// Simple counter-based awarding helper using a separate counters doc
// OPTIMIZED: Only read back if threshold > 0
export async function incrementCounterAndMaybeAward(
  uid: string,
  counterKey: string,
  threshold: number,
  achievementId: AchievementId
): Promise<void> {
  const ref = doc(db, "users", uid, "meta", "counters");
  await setDoc(ref, { [counterKey]: increment(1) }, { merge: true });
  if (threshold > 0) {
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as any) : {};
    const current = Number(data[counterKey] || 0);
    if (current >= threshold) {
      await awardAchievement(uid, achievementId);
    }
  }
}

// Simple counter increment without achievement check (for weekly goals tracking)
// OPTIMIZED: No read-back needed - just atomic increment (saves 1 read per call)
// Also increments weekly counters for weekly goals tracking
export async function incrementCounter(uid: string, counterKey: string): Promise<void> {
  const ref = doc(db, "users", uid, "meta", "counters");
  await setDoc(ref, { [counterKey]: increment(1), sessions: increment(1) }, { merge: true });
  await incrementWeeklyCounter(uid, counterKey);
  // "Complete 20 study sessions" - every tool use counts as a session
  try {
    const snap = await getDoc(ref);
    const current = Number((snap.data() as any)?.sessions || 0);
    if (current === 20) await awardAchievement(uid, "sessions_20");
  } catch {}
}

// Increments the weekly counter, resetting all counters if the week rolled over
export async function incrementWeeklyCounter(uid: string, counterKey: string): Promise<void> {
  const weeklyRef = doc(db, "users", uid, "meta", "weeklyCounters");
  const mondayTs = getMondayTimestamp();
  const weeklySnap = await getDoc(weeklyRef);
  const weeklyData = weeklySnap.exists() ? (weeklySnap.data() as any) : {};
  if (Number(weeklyData.weekStartedAt || 0) !== mondayTs) {
    await setDoc(weeklyRef, { ...buildWeeklyReset(weeklyData, mondayTs), [counterKey]: 1 }, { merge: true });
  } else {
    await setDoc(weeklyRef, {
      [counterKey]: increment(1),
      weekStartedAt: mondayTs
    }, { merge: true });
  }
}

// Zero all numeric weekly counter fields (flashcards, quizzes, summaries, posts,
// and any future numeric counters) and stamp the new week start. weeklyDays is
// handled separately by recordDailyVisit.
function buildWeeklyReset(weeklyData: any, mondayTs: number): Record<string, any> {
  const reset: Record<string, any> = { weekStartedAt: mondayTs };
  for (const [k, v] of Object.entries(weeklyData || {})) {
    if (k !== 'weekStartedAt' && typeof v === 'number') reset[k] = 0;
  }
  return reset;
}

// Get timestamp of the most recent Monday at midnight (UTC)
export function getMondayTimestamp(): number {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Days since Monday (Sunday = 6 days back)
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff, 0, 0, 0, 0));
  return monday.getTime();
}

// Add a value to a unique set and award if threshold of unique items met
// OPTIMIZED: Use arrayUnion to avoid overwriting other fields
export async function addToSetAndMaybeAward(
  uid: string,
  setKey: string,
  value: string,
  threshold: number,
  achievementId: AchievementId
): Promise<void> {
  const ref = doc(db, "users", uid, "meta", "counters");
  // First check if value already exists to avoid unnecessary write
  const snap = await getDoc(ref);
  const base = snap.exists() ? (snap.data() as any) : {};
  const arr: string[] = Array.isArray(base[setKey]) ? base[setKey] : [];
  if (!arr.includes(value)) {
    // Use setDoc with only the specific field to avoid overwriting other fields
    const next = [...arr, value];
    await setDoc(ref, { [setKey]: next }, { merge: true });
    if (next.length >= threshold) {
      await awardAchievement(uid, achievementId);
    }
  }
}
