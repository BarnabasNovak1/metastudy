// Per-achievement emoji + accent tile color classes
export interface AchievementVisual {
  emoji: string;
  cls: string;
}

export const ACHIEVEMENT_ICONS: Record<string, AchievementVisual> = {
  perfect_quiz: { emoji: '💯', cls: 'bg-yellow-500/15' },
  first_quiz: { emoji: '✅', cls: 'bg-green-500/15' },
  quiz_10: { emoji: '🎯', cls: 'bg-blue-500/15' },
  quiz_50: { emoji: '🎖️', cls: 'bg-indigo-500/15' },
  quiz_100: { emoji: '🏆', cls: 'bg-purple-500/15' },
  quiz_master_10_90: { emoji: '🧠', cls: 'bg-fuchsia-500/15' },
  library_5_quizzes: { emoji: '📚', cls: 'bg-teal-500/15' },
  library_20_quizzes: { emoji: '🗄️', cls: 'bg-teal-500/15' },
  first_flashcards: { emoji: '🗂️', cls: 'bg-sky-500/15' },
  flashcard_sets_5: { emoji: '🗃️', cls: 'bg-sky-500/15' },
  flashcard_master: { emoji: '👑', cls: 'bg-amber-500/15' },
  flashcards_review_500: { emoji: '🔁', cls: 'bg-emerald-500/15' },
  uploads_10: { emoji: '📤', cls: 'bg-cyan-500/15' },
  night_owl: { emoji: '🦉', cls: 'bg-indigo-500/15' },
  sessions_20: { emoji: '⏱️', cls: 'bg-orange-500/15' },
  chat_questions_100: { emoji: '💬', cls: 'bg-blue-500/15' },
  followups_10: { emoji: '❓', cls: 'bg-violet-500/15' },
  deep_diver_5: { emoji: '🤿', cls: 'bg-purple-500/15' },
  first_post: { emoji: '✍️', cls: 'bg-green-500/15' },
  posts_10: { emoji: '📰', cls: 'bg-blue-500/15' },
  posts_100: { emoji: '📡', cls: 'bg-orange-500/15' },
  posts_1000: { emoji: '📣', cls: 'bg-red-500/15' },
  first_challenge_join: { emoji: '⚔️', cls: 'bg-slate-500/15' },
  challenges_50: { emoji: '🥈', cls: 'bg-amber-500/15' },
  challenges_100: { emoji: '🏆', cls: 'bg-yellow-500/15' },
  challenges_1000: { emoji: '👑', cls: 'bg-yellow-500/15' },
  first_group: { emoji: '👥', cls: 'bg-emerald-500/15' },
  groups_10: { emoji: '🏘️', cls: 'bg-emerald-500/15' },
  group_members_10: { emoji: '🏠', cls: 'bg-teal-500/15' },
  group_members_50: { emoji: '🏘️', cls: 'bg-teal-500/15' },
  group_members_100: { emoji: '🏙️', cls: 'bg-cyan-500/15' },
  group_members_1000: { emoji: '🌆', cls: 'bg-blue-600/15' },
  first_resume: { emoji: '📄', cls: 'bg-sky-500/15' },
  resume_export: { emoji: '📥', cls: 'bg-sky-500/15' },
  linkedin_saved: { emoji: '💼', cls: 'bg-blue-600/15' },
  interview_completed: { emoji: '🎤', cls: 'bg-rose-500/15' },
  career_plan_saved: { emoji: '🧭', cls: 'bg-violet-500/15' },
};

// Streak achievements escalate in emoji and intensity as the tier gets harder:
// candle -> campfire -> fire -> fireworks -> lightning -> star -> rocket -> gem -> crown -> trophy
const STREAK_VISUALS: Record<string, AchievementVisual> = {
  streak_1:    { emoji: '🕯️', cls: 'bg-amber-500/15' },
  streak_3:    { emoji: '🔥', cls: 'bg-orange-500/15' },
  streak_10:   { emoji: '🔥', cls: 'bg-red-500/20 ring-1 ring-red-500/30' },
  streak_30:   { emoji: '🎇', cls: 'bg-gradient-to-br from-rose-500/25 to-pink-500/25 ring-1 ring-rose-500/40' },
  streak_50:   { emoji: '🎆', cls: 'bg-gradient-to-br from-pink-500/25 to-fuchsia-500/25 ring-1 ring-fuchsia-500/40' },
  streak_100:  { emoji: '⚡', cls: 'bg-gradient-to-br from-fuchsia-500/25 to-purple-500/25 ring-1 ring-purple-500/50 shadow-sm shadow-purple-500/30' },
  streak_200:  { emoji: '⚡', cls: 'bg-gradient-to-br from-purple-500/25 to-violet-500/25 ring-1 ring-violet-500/50 shadow-sm shadow-violet-500/30' },
  streak_300:  { emoji: '💥', cls: 'bg-gradient-to-br from-violet-500/25 to-indigo-500/25 ring-2 ring-indigo-500/40 shadow-md shadow-indigo-500/30' },
  streak_400:  { emoji: '✨', cls: 'bg-gradient-to-br from-indigo-500/25 to-blue-500/25 ring-2 ring-blue-500/40 shadow-md shadow-blue-500/30' },
  streak_500:  { emoji: '🌟', cls: 'bg-gradient-to-br from-blue-500/25 to-sky-500/25 ring-2 ring-sky-500/50 shadow-md shadow-sky-500/40' },
  streak_600:  { emoji: '🚀', cls: 'bg-gradient-to-br from-sky-500/25 to-cyan-500/25 ring-2 ring-cyan-400/50 shadow-lg shadow-cyan-500/40' },
  streak_700:  { emoji: '☄️', cls: 'bg-gradient-to-br from-cyan-500/25 to-teal-500/25 ring-2 ring-teal-400/50 shadow-lg shadow-teal-500/40' },
  streak_800:  { emoji: '💎', cls: 'bg-gradient-to-br from-teal-500/25 to-emerald-500/25 ring-2 ring-emerald-400/60 shadow-lg shadow-emerald-500/50' },
  streak_900:  { emoji: '👑', cls: 'bg-gradient-to-br from-amber-500/30 to-yellow-500/30 ring-2 ring-amber-400/60 shadow-lg shadow-amber-500/50' },
  streak_1000: { emoji: '🏆', cls: 'bg-gradient-to-br from-yellow-400/40 to-amber-500/40 ring-2 ring-yellow-400/80 shadow-xl shadow-yellow-500/50' },
};

export function getAchievementVisual(id: string): AchievementVisual {
  if (id.startsWith('streak_')) {
    return STREAK_VISUALS[id] || { emoji: '🔥', cls: 'bg-amber-500/15' };
  }
  return ACHIEVEMENT_ICONS[id] || { emoji: '🏆', cls: 'bg-muted' };
}
