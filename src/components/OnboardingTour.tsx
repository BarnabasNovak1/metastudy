import { useState, useEffect, useCallback } from 'react';
import Joyride, { ACTIONS, CallBackProps, STATUS, Step } from 'react-joyride';
import { useTheme } from 'next-themes';
import { useUserData } from '@/contexts/UserDataContext';
import { Button } from '@/components/ui/button';
import { HelpCircle, RotateCcw, ChevronLeft, ChevronRight, Check, Circle } from 'lucide-react';
import { Input } from '@/components/ui/input';

// ==================== TOUR STYLING ====================
// Paper-and-ink theme: bordered tooltip, hard offset shadow, green/amber accents.
const joyrideStyles = (isDark: boolean) => ({
  options: {
    primaryColor: isDark ? '#3cb878' : '#1e7a4f',
    backgroundColor: isDark ? '#1c2721' : '#faf7ef',
    textColor: isDark ? '#ece5d3' : '#1a2620',
    arrowColor: isDark ? '#1c2721' : '#faf7ef',
    overlayColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 10000,
    width: 'min(380px, 92vw)',
  },
  spotlight: {
    borderRadius: 8,
  },
  tooltip: {
    borderRadius: 8,
    padding: 'clamp(12px, 3vw, 20px)',
    maxWidth: 'min(380px, 92vw)',
    width: '100%',
    border: isDark ? '2px solid #8a8270' : '2px solid #1a2620',
    boxShadow: isDark ? '6px 6px 0 #000' : '6px 6px 0 rgba(26,38,32,0.9)',
    fontFamily: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  },
  tooltipContainer: {
    textAlign: 'left' as const,
    padding: 0,
  },
  tooltipTitle: {
    fontSize: 'clamp(14px, 3.5vw, 16px)',
    fontWeight: 700,
    marginBottom: 6,
    color: isDark ? '#ece5d3' : '#1a2620',
  },
  tooltipContent: {
    fontSize: 'clamp(12px, 3vw, 14px)',
    lineHeight: 1.5,
    color: isDark ? '#b3ab97' : '#4a534d',
    wordBreak: 'break-word' as const,
  },
  buttonNext: {
    backgroundColor: isDark ? '#3cb878' : '#1e7a4f',
    color: isDark ? '#101a15' : '#ffffff',
    borderRadius: 6,
    border: isDark ? '2px solid #8a8270' : '2px solid #1a2620',
    boxShadow: isDark ? '3px 3px 0 #000' : '3px 3px 0 rgba(26,38,32,0.9)',
    padding: 'clamp(6px, 2vw, 10px) clamp(12px, 3vw, 18px)',
    fontSize: 'clamp(12px, 3vw, 14px)',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  buttonBack: {
    color: isDark ? '#b3ab97' : '#4a534d',
    marginRight: 8,
    fontSize: 'clamp(12px, 3vw, 14px)',
    fontWeight: 600,
  },
  buttonSkip: {
    color: isDark ? '#b3ab97' : '#4a534d',
    fontSize: 'clamp(11px, 2.5vw, 13px)',
  },
  buttonClose: {
    color: isDark ? '#ece5d3' : '#1a2620',
  },
  tooltipFooter: {
    marginTop: 12,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
});

// ==================== DEMO DATA (Elementary Level) ====================
const DEMO_FLASHCARDS = [
  { front: "How many legs does a spider have?", back: "8 legs! Spiders are arachnids, not insects." },
  { front: "What planet do we live on?", back: "Earth, the third planet from the Sun!" },
  { front: "What do plants need to grow?", back: "Water, sunlight, and soil (with nutrients)." },
];

const DEMO_QUIZ_MC = {
  question: "What color do you get when you mix red and yellow?",
  options: ["Orange", "Purple", "Green", "Pink"],
  correct: 0,
};

const DEMO_QUIZ_FILL = {
  question: "There are ____ days in a week.",
  answer: "7",
};

const DEMO_QUIZ_SHORT = {
  question: "What happens to water when it gets very cold?",
  sampleAnswer: "When water gets very cold (below 32°F or 0°C), it freezes and turns into ice. The water molecules slow down and form a solid structure.",
};

// ==================== INLINE DEMO COMPONENTS FOR TOUR ====================
// These render directly inside tour tooltips

function InlineFlashcardDemo() {
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const card = DEMO_FLASHCARDS[cardIndex];

  return (
    <div className="space-y-3 w-full min-w-[280px]">
      <p className="text-xs text-muted-foreground">Tap the card to flip it!</p>
      <div
        onClick={() => setIsFlipped(!isFlipped)}
        className="cursor-pointer p-4 rounded-lg border-2 border-dashed min-h-[100px] flex flex-col items-center justify-center text-center transition-all hover:border-primary/50"
        style={{ background: isFlipped ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
      >
        <div className="text-[10px] text-muted-foreground mb-1">{isFlipped ? '📖 Answer' : '❓ Question'} • {cardIndex + 1}/{DEMO_FLASHCARDS.length}</div>
        <p className="text-sm font-medium">{isFlipped ? card.back : card.front}</p>
      </div>
      <div className="flex justify-center gap-2">
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setIsFlipped(false); setCardIndex((cardIndex - 1 + DEMO_FLASHCARDS.length) % DEMO_FLASHCARDS.length); }}>
          <ChevronLeft className="w-3 h-3" />
        </Button>
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setIsFlipped(!isFlipped)}>
          <RotateCcw className="w-3 h-3 mr-1" /> Flip
        </Button>
        <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { setIsFlipped(false); setCardIndex((cardIndex + 1) % DEMO_FLASHCARDS.length); }}>
          <ChevronRight className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function InlineQuizMC() {
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  return (
    <div className="space-y-3 w-full min-w-[280px]">
      <p className="text-sm font-medium">{DEMO_QUIZ_MC.question}</p>
      <div className="space-y-2">
        {DEMO_QUIZ_MC.options.map((opt, i) => (
          <div
            key={i}
            onClick={() => { if (!showResult) setSelected(i); }}
            className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer transition-all ${
              showResult 
                ? i === DEMO_QUIZ_MC.correct 
                  ? 'bg-green-500/10 border-green-500' 
                  : selected === i 
                    ? 'bg-red-500/10 border-red-500' 
                    : 'opacity-50'
                : selected === i 
                  ? 'border-primary bg-primary/5' 
                  : 'hover:border-primary/50'
            }`}
          >
            <Circle className={`w-3 h-3 ${selected === i ? 'fill-current' : ''}`} />
            {String.fromCharCode(65 + i)}) {opt}
            {showResult && i === DEMO_QUIZ_MC.correct && <Check className="w-3 h-3 ml-auto text-green-500" />}
          </div>
        ))}
      </div>
      {selected !== null && !showResult && (
        <Button size="sm" className="text-xs h-7" onClick={() => setShowResult(true)}>Check Answer</Button>
      )}
      {showResult && (
        <p className="text-xs text-muted-foreground">
          {selected === DEMO_QUIZ_MC.correct ? '✅ Correct!' : `❌ The answer is ${String.fromCharCode(65 + DEMO_QUIZ_MC.correct)}) ${DEMO_QUIZ_MC.options[DEMO_QUIZ_MC.correct]}`}
        </p>
      )}
    </div>
  );
}

function InlineQuizFill() {
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const isCorrect = answer.trim().toLowerCase() === DEMO_QUIZ_FILL.answer.toLowerCase();

  return (
    <div className="space-y-3 w-full min-w-[280px]">
      <p className="text-sm font-medium">{DEMO_QUIZ_FILL.question}</p>
      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type your answer..."
        className={`text-sm h-8 ${showResult ? (isCorrect ? 'border-green-500' : 'border-red-500') : ''}`}
        disabled={showResult}
      />
      {answer.trim() && !showResult && (
        <Button size="sm" className="text-xs h-7" onClick={() => setShowResult(true)}>Check Answer</Button>
      )}
      {showResult && (
        <p className="text-xs text-muted-foreground">
          {isCorrect ? '✅ Correct!' : `❌ The answer is "${DEMO_QUIZ_FILL.answer}"`}
        </p>
      )}
    </div>
  );
}

function InlineQuizShort() {
  const [answer, setAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);

  return (
    <div className="space-y-3 w-full min-w-[280px]">
      <p className="text-sm font-medium">{DEMO_QUIZ_SHORT.question}</p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Write your answer..."
        className="w-full p-2 border rounded text-xs min-h-[60px] resize-none bg-background"
        disabled={showResult}
      />
      {answer.trim() && !showResult && (
        <Button size="sm" className="text-xs h-7" onClick={() => setShowResult(true)}>Submit</Button>
      )}
      {showResult && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">📝 Sample Answer:</p>
          <p className="text-xs p-2 bg-muted/50 rounded">{DEMO_QUIZ_SHORT.sampleAnswer}</p>
          <p className="text-[10px] text-muted-foreground">💡 AI grades your answer in the real app!</p>
        </div>
      )}
    </div>
  );
}

// ==================== FEATURE-SPECIFIC TOUR DEFINITIONS ====================
export const FEATURE_TOURS: Record<string, Step[]> = {
  chat: [
    { target: '[data-tour="chat-personality"]', content: 'Choose different AI personalities: Friendly Professor explains concepts clearly, Casual Tutor is relaxed, Socratic Tutor asks guiding questions, and more!', title: '🎭 AI Personalities', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="chat-input"]', content: 'Type your question or topic here. Be specific for better answers!', title: '💬 Ask a Question', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="chat-attach"]', content: 'Attach documents here! Supported: PDF, DOCX, TXT, images (PNG, JPG), and more. The AI will analyze and discuss the content with you.', title: '📎 Attach Documents', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="chat-send"]', content: 'Click send or press Enter to submit your message. The AI will respond in seconds!', title: '📤 Send Message', disableBeacon: true, placement: 'auto' },
  ],
  summarizer: [
    { target: '[data-tour="summarizer-tabs"]', content: 'Switch between Summarizer (for text/documents) and My Saves (your saved summaries).', title: '📑 Summarizer Tabs', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="summarizer-input"]', content: 'Paste your text here, or upload a document (PDF, DOCX, TXT supported). You can also drag and drop files!', title: '📝 Input Text', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="summarizer-format"]', content: 'Choose your summary style: Brief Summary (quick 2-3 sentences), Detailed (comprehensive), Study Notes (structured with bullets), Key Points (main ideas only), or Academic (formal tone).', title: '📋 Summary Type', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="summarizer-generate"]', content: 'Click to generate your AI-powered summary!', title: '✨ Generate Summary', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="summarizer-saves-tab"]', content: 'Access all your saved summaries here. You can search, filter, and re-use them anytime.', title: '💾 My Saves', disableBeacon: true, placement: 'auto' },
  ],
  flashcards: [
    { target: '[data-tour="flashcards-tabs"]', content: 'Switch between Generate (AI creates flashcards for you) and My Flashcards (your saved decks).', title: '🃏 Flashcards Tabs', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="flashcards-manual"]', content: 'Want to create flashcards manually? Click "Create Manually" to expand this section and enter your own questions and answers. The AI generator is below this section.', title: '✏️ Manual Flashcards Builder', disableBeacon: true, placement: 'auto', offset: 10 },
    { target: '[data-tour="flashcards-input"]', content: 'Or paste your notes here and let AI generate flashcards automatically!', title: '🤖 AI Generator', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="flashcards-generate"]', content: 'Click to generate AI-powered flashcards from your content!', title: '✨ Generate Cards', disableBeacon: true, placement: 'auto' },
    { target: 'body', content: 'FLASHCARD_DEMO_STEP', title: '📚 Try It: Flashcard Demo', disableBeacon: true, placement: 'center', data: { isFlashcardDemo: true } },
    { target: '[data-tour="flashcards-saved-tab"]', content: 'All your saved flashcard decks are here. Click any deck to study or edit it.', title: '💾 My Flashcards', disableBeacon: true, placement: 'auto' },
  ],
  quiz: [
    { target: '[data-tour="quiz-tabs"]', content: 'Switch between Generate (AI creates quizzes for you) and My Quizzes (your saved quizzes).', title: '📋 Quiz Tabs', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="quiz-manual"]', content: 'Want to create quiz questions manually? Click "Create Manually" to expand this section and enter your own questions. The AI generator is below this section.', title: '✏️ Manual Quiz Builder', disableBeacon: true, placement: 'auto', offset: 10 },
    { target: '[data-tour="quiz-input"]', content: 'Or paste your study material here and let AI create quiz questions automatically!', title: '🤖 AI Generator', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="quiz-generate"]', content: 'Click to generate your AI-powered quiz!', title: '✨ Generate Quiz', disableBeacon: true, placement: 'auto' },
    { target: 'body', content: 'QUIZ_DEMO_MC', title: '🎯 Try It: Multiple Choice', disableBeacon: true, placement: 'center', data: { isQuizDemoMC: true } },
    { target: 'body', content: 'QUIZ_DEMO_FILL', title: '✏️ Try It: Fill in the Blank', disableBeacon: true, placement: 'center', data: { isQuizDemoFill: true } },
    { target: 'body', content: 'QUIZ_DEMO_SHORT', title: '📝 Try It: Short Answer', disableBeacon: true, placement: 'center', data: { isQuizDemoShort: true } },
    { target: '[data-tour="quiz-saved-tab"]', content: 'Access all your saved quizzes here. Retake them anytime to test your knowledge! Share quizzes to the Feed to compete with others and see leaderboards.', title: '💾 My Quizzes', disableBeacon: true, placement: 'auto' },
  ],
  helper: [
    { target: '[data-tour="helper-tabs"]', content: 'Switch between Create Plan (generate lesson plans), View Plans (study your plans), and My Plans (saved plans).', title: '🎓 Lesson Generator Tabs', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="helper-topic"]', content: 'Enter your topic or learning objective. Be specific about what you want to learn!', title: '📚 Topic/Objective', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="helper-duration"]', content: 'Set your study duration. How long do you have to learn this topic?', title: '⏱️ Study Duration', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="helper-options"]', content: 'Choose what to include: Flashcards, Quizzes, Homework, Practice Problems, and more.', title: '📝 Plan Options', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="helper-generate"]', content: 'Click to generate a comprehensive study plan tailored to your needs!', title: '✨ Generate Plan', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="helper-saved-tab"]', content: 'Access all your saved lesson plans here. Track your progress and revisit topics.', title: '💾 My Plans', disableBeacon: true, placement: 'auto' },
  ],
  career: [
    { target: '[data-tour="career-tabs"]', content: 'Career Launchpad has 4 powerful tools: Resume Builder, Interview Prep, LinkedIn Posts, and Career Planner.', title: '💼 Career Tools', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="career-resume"]', content: 'Build a professional resume with AI assistance. Upload your current resume or start fresh!', title: '📄 Resume Builder', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="career-interview"]', content: 'Practice job interviews with AI. Get realistic questions and feedback on your answers.', title: '🎤 Interview Prep', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="career-linkedin"]', content: 'Generate professional LinkedIn posts, connection messages, and profile summaries.', title: '💼 LinkedIn Content', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="career-planner"]', content: 'Get personalized career recommendations, skill gap analysis, and development roadmaps.', title: '🗺️ Career Planner', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="career-saves-tab"]', content: 'All your saved resumes, interview sessions, LinkedIn posts, and career plans are stored here for easy access.', title: '💾 My Saves', disableBeacon: true, placement: 'auto' },
  ],
  feed: [
    { target: '[data-tour="feed-tabs"]', content: 'Browse community posts or your study groups. Community posts are shared publicly with everyone, while group posts are only visible inside that group.', title: '📱 Feed vs Groups', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-posts"]', content: '📰 COMMUNITY FEED: Study materials shared publicly by everyone. Save useful flashcards, quizzes, and summaries to your library!\n\n👥 GROUP FEED: Click "Groups" to see posts shared only inside your study groups.', title: '📰 Community vs Group Posts', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-my-posts"]', content: 'Click "My Posts" to filter and see only YOUR shared content. Great for managing what you\'ve shared, editing posts, or checking engagement on your study materials!', title: '👤 My Posts Filter', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-share"]', content: 'Share your own flashcards, quizzes, and summaries with the community!', title: '📤 Share Content', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-groups"]', content: 'Study groups are private spaces for you and your study partners. Inside a group you get its own feed and member list.', title: '👥 Study Groups', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-create-group"]', content: '➕ CREATE A GROUP:\n\n1. Click "Create"\n2. Enter a group name (e.g., "Bio 101 Study Squad")\n3. Add a description and choose Private if you want invite-only\n4. Share your invite code with friends\n\nGroups let you share content privately with your study buddies!', title: '🆕 Create a Group', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-group-settings"]', content: '🔑 YOUR GROUP CODE: Click the ⚙️ settings icon next to any group you own or are in. The invite code is right there to copy and share with friends!', title: '🔑 Find Your Invite Code', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-join-code"]', content: '🎟️ GOT A CODE? Click "Join by code" and paste the 6-character code a friend shared and you\'re in instantly, even for private groups!', title: '�️ Join with a Code', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-discover-groups"]', content: '🔍 DISCOVER GROUPS: Browse public groups to join instantly, or request to join private ones (the owner or an admin approves).', title: '🔍 Discover Groups', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="feed-join-challenge"]', content: 'Click on any challenge card to join it! Once joined, complete the content to earn points. Note: Leaderboards are only available for Quiz challenges. Flashcards and Lessons don\'t have leaderboards.', title: '🎯 Join a Challenge', disableBeacon: true, placement: 'auto' },
  ],
  // Adaptive Tutor tour
  tutor: [
    { target: '[data-tour="tutor-lesson-gen"]', content: 'Scroll down for the Lesson Generator: turn any topic into a full lesson with flashcards, quizzes, and practice problems, then practice it with the tutor above.', title: '🎓 Lesson Generator', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="tutor-new"]', content: 'Start a diagnostic session here. The tutor builds learning objectives from YOUR material, then adapts each question to what you actually understand.', title: '🧠 Adaptive Tutor', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="tutor-setup-source"]', content: 'Pick saved summaries or paste notes. The tutor grounds every question and explanation in this material, not generic trivia.', title: '📚 Source Material', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="tutor-question"]', content: 'Answer questions one at a time. After each answer you get feedback that targets your specific misconception, then the next question adapts.', title: '❓ Answer & Adapt', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="tutor-mastery"]', content: 'Each concept gets a mastery score: Needs review (below 50), Developing (50-79), or Understood (80+). You can revisit missed concepts in a review session.', title: '📊 Concept Mastery', disableBeacon: true, placement: 'auto' },
  ],
  // Management tab tour
  account: [
    { target: '[data-tour="account-tabs"]', content: 'Navigate between Management, Friends, Achievements, and Statistics tabs. Each tab has different features!', title: '⚙️ Account Navigation', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-usage"]', content: 'Management tab: view your plan, usage stats, billing, and account settings.', title: '📊 Management Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-friends"]', content: 'Friends tab: find users, send friend requests, and manage your connections.', title: '👥 Friends Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-achievements"]', content: 'Achievements tab: view your XP, level progress, streaks, and unlock badges.', title: '🏆 Achievements Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-stats"]', content: 'Statistics tab: see detailed charts of your study activity, trends, and weekly goals.', title: '📈 Statistics Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-profile"]', content: 'Update your profile photo, display name, and username here.', title: '👤 Your Profile', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-plan-usage"]', content: 'View your current plan, monthly quota, usage this month, and add-on uses. Track when your usage resets!', title: '📋 Plan & Usage', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-billing"]', content: 'Manage your subscription, update payment method, or cancel your plan through the billing portal.', title: '💳 Manage Billing', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-danger-zone"]', content: 'Delete your account permanently. This removes all your data and cancels any active subscription.', title: '⚠️ Danger Zone', disableBeacon: true, placement: 'auto' },
  ],
  // Friends tab tour
  'account-friends': [
    { target: '[data-tour="account-tabs"]', content: 'You\'re on the Friends tab! Navigate between Management, Friends, Achievements, and Statistics.', title: '⚙️ Account Navigation', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-friends"]', content: 'Friends tab is selected. Manage your study connections here.', title: '👥 Friends Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="friends-list"]', content: 'Your Friends list shows all your connections. Click any friend to view their profile, mark favorites with ⭐, or remove/block users.', title: '👥 Your Friends', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="friends-search"]', content: 'Use the search box to find other users by username. Send friend requests and manage incoming/outgoing requests here.', title: '🔍 Find & Requests', disableBeacon: true, placement: 'auto' },
  ],
  // Achievements tab tour
  'account-achievements': [
    { target: '[data-tour="account-tabs"]', content: 'You\'re on the Achievements tab! Navigate between Management, Friends, Achievements, and Statistics.', title: '⚙️ Account Navigation', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-achievements"]', content: 'Achievements tab is selected. Track your progress and earn badges!', title: '🏆 Achievements Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="achievements-xp"]', content: 'Your XP and level are shown here. Earn XP by studying. Complete quizzes, flashcards, lessons, and more!', title: '⭐ XP & Level', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="achievements-streak"]', content: 'View your study streak! Study every day to build your streak and unlock special achievements.', title: '🔥 Streaks', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="achievements-badges"]', content: 'Unlock achievement badges by reaching milestones. Collect them all to show off your dedication!', title: '🏅 Badges', disableBeacon: true, placement: 'auto' },
  ],
  // Statistics tab tour
  'account-stats': [
    { target: '[data-tour="account-tabs"]', content: 'You\'re on the Statistics tab! Navigate between Management, Friends, Achievements, and Statistics.', title: '⚙️ Account Navigation', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="account-stats"]', content: 'Statistics tab is selected. Dive deep into your study data!', title: '📈 Statistics Tab', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="stats-overview"]', content: 'Quick stats at a glance: Study Time (total minutes studied), Sessions (how many times you studied), Current Streak (consecutive days), and Total XP earned.', title: '📊 Overview Stats', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="stats-charts"]', content: 'Visual charts! The bar chart shows your daily study activity. The pie chart shows which features you use most (Chat, Flashcards, Quiz, etc.).', title: '📈 Activity Charts', disableBeacon: true, placement: 'auto' },
    { target: '[data-tour="stats-goals"]', content: 'Set weekly goals for study days, sessions, and minutes. Track your progress with the progress bars. Click Edit to customize your targets!', title: '🎯 Weekly Goals', disableBeacon: true, placement: 'auto' },
  ],
};

const TOUR_STEPS: Step[] = [
  {
    target: '[data-tour="chat-tab"]',
    content: 'Start conversations with AI tutors. Choose from different personalities like a friendly professor or casual tutor!',
    title: '💬 AI Chat',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="summarizer-tab"]',
    content: 'Upload documents, PDFs, or paste text to get AI-powered summaries in various formats.',
    title: '📝 Summarizer',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="flashcards-tab"]',
    content: 'Create flashcard decks from your notes or let AI generate them automatically. Study with spaced repetition!',
    title: '🃏 Flashcards',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="quiz-tab"]',
    content: 'Generate quizzes from any topic. Multiple choice, fill-in-the-blank, and short answer questions.',
    title: '📋 Quiz Generator',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="tutor-tab"]',
    content: 'Your AI tutor lives here: generate full lessons on any topic, then practice them with questions that adapt to what you understand.',
    title: '🧠 Adaptive Tutor',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="career-tab"]',
    content: 'Build resumes, practice interviews, and get career guidance powered by AI.',
    title: '💼 Career Tools',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="feed-tab"]',
    content: 'Browse shared study materials, join study groups, and compete in challenges with other students!',
    title: '📱 Study Feed',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="friends-button"]',
    content: 'Connect with friends, share study materials, and see who\'s studying!',
    title: '👥 Friends',
    disableBeacon: true,
    placement: 'auto',
  },
  {
    target: '[data-tour="account-menu"]',
    content: 'View your usage, achievements, and manage your account settings here.',
    title: '⚙️ Account',
    disableBeacon: true,
    placement: 'auto',
  },
];

const TOUR_STORAGE_KEY = 'metastudy_tour_completed';
const JUST_SIGNED_UP_KEY = 'metastudy_just_signed_up';

interface OnboardingTourProps {
  forceRun?: boolean;
  onComplete?: () => void;
}

export function OnboardingTour({ forceRun = false, onComplete }: OnboardingTourProps) {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const { resolvedTheme } = useTheme();
  const { profile } = useUserData();
  const [isDark, setIsDark] = useState(false);

  // Institution users must confirm email before the tutorial counts as "played" -
  // wait for profile.emailConfirmedAt (the EmailVerificationGate sits over /study
  // until then, and we don't want the tour firing behind it). If the profile
  // never loads (regular user, empty doc), don't block forever - grace period.
  const [profileGraceExpired, setProfileGraceExpired] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setProfileGraceExpired(true), 4000);
    return () => window.clearTimeout(t);
  }, []);
  const isInstitutionUser = !!String((profile as any)?.institutionId || '').trim();
  const emailConfirmed = !!(profile as any)?.emailConfirmedAt;
  const profileReady = (profile && Object.keys(profile).length > 0) || profileGraceExpired;
  
  // Fast theme detection - updates immediately when theme changes
  useEffect(() => {
    const checkTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    checkTheme();
    // Also observe class changes for instant updates
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  useEffect(() => {
    // Force run from Account page "Tutorial" button
    if (forceRun) {
      setRun(true);
      setStepIndex(0);
      return;
    }

    // Only auto-play tutorial if user JUST signed up (not on regular login)
    const justSignedUp = localStorage.getItem(JUST_SIGNED_UP_KEY);
    const hasCompleted = localStorage.getItem(TOUR_STORAGE_KEY);

    // Hold the flag until the profile loads and (for institution users) the
    // email is confirmed - don't consume it while the verification gate is up.
    if (!profileReady) return;
    if (isInstitutionUser && !emailConfirmed) return;

    if (justSignedUp) {
      localStorage.removeItem(JUST_SIGNED_UP_KEY);
    }

    // Only auto-start if just signed up AND hasn't completed tutorial before
    if (justSignedUp && !hasCompleted) {
      const timer = setTimeout(() => setRun(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [forceRun, profileReady, isInstitutionUser, emailConfirmed]);

  const handleCallback = (data: CallBackProps) => {
    const { status, type, index, action } = data;

    if (type === 'step:after') {
      setStepIndex(index + 1);
    }

    // Close on X button click (same as skip)
    if (action === ACTIONS.CLOSE) {
      setRun(false);
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
      onComplete?.();
      return;
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
      onComplete?.();
    }
  };

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      stepIndex={stepIndex}
      callback={handleCallback}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      scrollOffset={120}
      spotlightClicks
      disableOverlayClose
      styles={joyrideStyles(isDark)}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Get Started!',
        next: 'Next',
        skip: 'Skip Tutorial',
      }}
    />
  );
}

export function useTourReset() {
  return () => {
    localStorage.removeItem(TOUR_STORAGE_KEY);
    window.location.reload();
  };
}

// ==================== FEATURE HELP BUTTON ====================
interface FeatureHelpButtonProps {
  currentTab: string;
}

// Map tab names to feature tour keys
const TAB_TO_FEATURE: Record<string, string> = {
  chat: 'chat',
  summarizer: 'summarizer',
  flashcards: 'flashcards',
  quiz: 'quiz',
  quizzes: 'quiz',
  helper: 'helper',
  plans: 'tutor',
  career: 'career',
  feed: 'feed',
  tutor: 'tutor',
  account: 'account',
  // Account sub-tabs
  'account-usage': 'account',
  'account-friends': 'account-friends',
  'account-achievements': 'account-achievements',
  'account-stats': 'account-stats',
};

export function FeatureHelpButton({ currentTab }: FeatureHelpButtonProps) {
  const [runTour, setRunTour] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [tourSteps, setTourSteps] = useState<Step[]>([]);
  const [showWaitMessage, setShowWaitMessage] = useState(false);
  const { resolvedTheme } = useTheme();
  const [isDark, setIsDark] = useState(false);
  
  // Fast theme detection - updates immediately when theme changes
  useEffect(() => {
    const checkTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  // Check if loading overlay is active
  const isLoadingActive = useCallback(() => {
    // Check for loading overlay in DOM (it has z-[60] class)
    const overlay = document.querySelector('.fixed.inset-0.z-\\[60\\]');
    return !!overlay;
  }, []);

  // Check if user is in flashcard study mode (viewing a deck)
  const isInFlashcardStudyMode = useCallback(() => {
    // Check for "Back to Library" button which only appears when viewing a deck
    return Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Back to Library'));
  }, []);

  // Check if user is in quiz study mode (taking a quiz)
  const isInQuizStudyMode = useCallback(() => {
    // Check for elements that only appear when taking a quiz or viewing results
    const buttons = Array.from(document.querySelectorAll('button'));
    const hasResultsButtons = buttons.some(btn => 
      btn.textContent?.includes('Back to My Quizzes') || 
      btn.textContent?.includes('Retake Quiz') ||
      btn.textContent?.includes('New Quiz')
    );
    // Check for "Retake" and "Exit" buttons which appear when taking a quiz
    const hasTakingQuizButtons = buttons.some(btn => btn.textContent?.trim() === 'Retake') &&
                                  buttons.some(btn => btn.textContent?.trim() === 'Exit');
    // Check for "Question X of Y" text
    const hasQuestionCounter = !!document.querySelector('h1')?.textContent?.match(/Question \d+ of \d+/);
    return hasResultsButtons || hasTakingQuizButtons || hasQuestionCounter;
  }, []);

  // Auto-start tour for current tab when help button is clicked
  const startCurrentTabTour = useCallback(() => {
    // If loading is active, show wait message instead
    if (isLoadingActive()) {
      setShowWaitMessage(true);
      setTimeout(() => setShowWaitMessage(false), 3000);
      return;
    }
    // Reset any existing tour first - IMPORTANT: reset stepIndex to 0 for mobile
    setRunTour(false);
    setStepIndex(0);
    setTourSteps([]);
    
    const featureId = TAB_TO_FEATURE[currentTab] || 'chat';
    let baseSteps = FEATURE_TOURS[featureId];
    
    // If user is inside flashcard study mode, only show demo step
    if (featureId === 'flashcards' && isInFlashcardStudyMode()) {
      baseSteps = baseSteps.filter((step: any) => step.data?.isFlashcardDemo);
    }
    
    // If user is inside quiz study mode, only show demo steps
    if (featureId === 'quiz' && isInQuizStudyMode()) {
      baseSteps = baseSteps.filter((step: any) => step.data?.isQuizDemoMC || step.data?.isQuizDemoFill || step.data?.isQuizDemoShort);
    }
    
    if (baseSteps && baseSteps.length > 0) {
      // Replace placeholder content with actual inline demo components
      const steps = baseSteps.map(step => {
        const stepData = (step as any)?.data;
        if (stepData?.isFlashcardDemo) {
          return { ...step, content: <InlineFlashcardDemo /> };
        }
        if (stepData?.isQuizDemoMC) {
          return { ...step, content: <InlineQuizMC /> };
        }
        if (stepData?.isQuizDemoFill) {
          return { ...step, content: <InlineQuizFill /> };
        }
        if (stepData?.isQuizDemoShort) {
          return { ...step, content: <InlineQuizShort /> };
        }
        return step;
      });
      
      // Small delay to ensure clean state, reset stepIndex again right before starting
      setTimeout(() => {
        setStepIndex(0);
        setTourSteps(steps);
        setTimeout(() => setRunTour(true), 50);
      }, 50);
    }
  }, [currentTab, isInFlashcardStudyMode, isInQuizStudyMode, isLoadingActive]);

  const handleTourCallback = useCallback((data: CallBackProps) => {
    const { status, action, index, type } = data;

    // Handle step navigation - NEXT goes forward, PREV goes back.
    // Feed tour: some steps live inside the Groups view, others in the main
    // feed - switch the feed tab first, then advance after React re-renders.
    if (type === 'step:after') {
      const nextIndex = action === ACTIONS.PREV ? Math.max(0, index - 1) : index + 1;
      const nextTarget = String((tourSteps[nextIndex] as any)?.target || '');

      let navTab: string | null = null;
      if (/feed-(create-group|group-settings|join-code|discover-groups|groups)/.test(nextTarget)) navTab = 'groups';
      else if (/feed-(tabs|posts|my-posts|share|join-challenge)/.test(nextTarget)) navTab = 'for-you';

      if (navTab) {
        window.dispatchEvent(new CustomEvent('tour-feed-nav', { detail: navTab }));
        // Wait for the view to mount its elements before spotlighting them
        setTimeout(() => setStepIndex(nextIndex), 400);
      } else {
        setStepIndex(nextIndex);
      }
    }
    
    // Helper to scroll to top for account pages
    const scrollToTopIfAccount = () => {
      if (currentTab.startsWith('account')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    
    // Close on X button click (same as skip)
    if (action === ACTIONS.CLOSE) {
      setRunTour(false);
      setStepIndex(0);
      setTourSteps([]);
      scrollToTopIfAccount();
      return;
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRunTour(false);
      setStepIndex(0);
      setTourSteps([]);
      scrollToTopIfAccount();
    }
  }, [currentTab, tourSteps]);

  // Get feature name for tooltip
  const getFeatureName = () => {
    const featureId = TAB_TO_FEATURE[currentTab] || 'chat';
    const names: Record<string, string> = {
      chat: 'AI Chat',
      summarizer: 'Summarizer',
      flashcards: 'Flashcards',
      quiz: 'Quiz',
      helper: 'Lesson Generator',
      career: 'Career Launchpad',
      feed: 'Study Feed',
      tutor: 'Adaptive Tutor',
      account: 'Account',
      'account-friends': 'Friends',
      'account-achievements': 'Achievements',
      'account-stats': 'Statistics',
    };
    return names[featureId] || 'Feature';
  };

  return (
    <>
      {/* Help Button - Fixed bottom right */}
      <div className="fixed bottom-4 right-4 z-[70]">
        {/* Wait message popup */}
        {showWaitMessage && (
          <span className="absolute -top-10 right-0 pointer-events-none whitespace-nowrap text-xs sm:text-sm font-bold bg-secondary text-secondary-foreground px-3 py-1.5 border-2 border-foreground hard-shadow-sm animate-usage-float">
            Please wait...
          </span>
        )}
        <Button
          variant="default"
          size="icon"
          className={`h-9 w-9 sm:h-10 sm:w-10 bg-secondary text-secondary-foreground border-2 border-foreground hard-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none group transition-all ${runTour ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          onClick={startCurrentTabTour}
          aria-label={`Help with ${getFeatureName()}`}
          title={`Learn how to use ${getFeatureName()}`}
        >
          <HelpCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
        </Button>
      </div>

      {/* Feature-specific Joyride Tour */}
      {tourSteps.length > 0 && (
        <Joyride
          steps={tourSteps}
          run={runTour}
          stepIndex={stepIndex}
          callback={handleTourCallback}
          continuous
          showProgress
          showSkipButton
          scrollToFirstStep
          scrollOffset={120}
          spotlightClicks
          disableOverlayClose
          styles={joyrideStyles(isDark)}
          locale={{
            back: 'Back',
            close: 'Close',
            last: 'Got it!',
            next: 'Next',
            skip: 'Skip',
          }}
        />
      )}
    </>
  );
}

