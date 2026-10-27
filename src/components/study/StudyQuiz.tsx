import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import { useUserData } from "@/contexts/UserDataContext";
import { useNavGuard } from "@/hooks/use-nav-guard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { db } from "../../../firebase";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Eye, Pencil, Trash2, Plus, BookOpen, Loader2, FileText, X, Menu, CheckCircle2, Play, ListChecks, Square, CheckSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup } from "@/components/ui/radio-group";
import { extractTextFromFile } from "@/lib/extractTextFromFile";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { collection, addDoc, serverTimestamp, getDocs, setDoc, doc, query, where, orderBy, updateDoc, deleteDoc, getDoc, limit, writeBatch } from "firebase/firestore";
import { incrementMonthlyUsage } from "@/lib/usage";
import { awardAchievement, incrementCounterAndMaybeAward, incrementCounterAndAwardOn, addXP, awardActionXP, incrementCounter } from "@/lib/achievements";
import { startToolSession, endToolSession } from "@/lib/session";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { CrossCreatePicker } from "@/components/CrossCreatePicker";
import LoadingOverlay from "@/components/LoadingOverlay";
import { ReferenceAnswerEditor } from "@/components/study/ReferenceAnswerEditor";
import { getReferenceAnswer, gradeQuizAnswers, isShortAnswerQuestion } from "@/lib/quiz-grading";

interface Question {
  id: string;
  question: string;
  question_type: string;
  correct_answer: string;
  reference_answer?: string;
  options?: { [key: string]: string };
  explanation?: string;
}

interface ManualQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'short_answer';
  A: string;
  B: string;
  C: string;
  D: string;
  correct: 'A' | 'B' | 'C' | 'D';
  shortAnswer: string;
  pendingReview: boolean;
}

const newManualQuestion = (): ManualQuestion => ({
  id: crypto.randomUUID(), question: '', type: 'multiple_choice',
  A: '', B: '', C: '', D: '', correct: 'A', shortAnswer: '', pendingReview: false,
});

// Helper to normalize math delimiters for KaTeX
const normalizeForMath = (s: string) => {
  let out = s || "";
  out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  out = out.replace(/\*\*/g, "");
  // Prevent currency like "$100" or "$5" from accidentally starting KaTeX inline math.
  // This is a common cause of "words stuck together" when KaTeX renders normal prose in math mode.
  out = out.replace(/(^|[^\\$])\$(\d+(?:\.\d+)?)(?=[\s,.;:!?)]|$)/g, "$1\\$$2");
  out = out.replace(/```(?:latex)?\s*([\s\S]*?)```/gi, (m, inner) => {
    const t = String(inner || "");
    if (/(\\\[|\\\(|\$\$|\\begin\{)/.test(t)) return t;
    return m;
  });
  out = out.replace(/^\s{4,}(?=\\\[|\\\]|\\\(|\\\)|\$\$|\\begin\{|\\end\{)/gm, "");
  out = out.replace(/\\+\[/g, "$$").replace(/\\+\]/g, "$$");
  out = out.replace(/\\+\(/g, "$").replace(/\\+\)/g, "$");
  out = out.replace(/([^\n])\$\$/g, "$1\n$$");
  out = out.replace(/\$\$([^\n])/g, "$$\n$1");
  out = out.replace(/\$(\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*)\$/g, (_m, inner) => `$$${inner}$$`);
  out = out.replace(/(^|\n)\s*(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g, (_m, prefix, env) => `${prefix}$$${env}$$`);
  const latexizeInline = (expr: string) => {
    let e = String(expr || "").trim();
    e = e.replace(/\s+/g, " ");
    e = e.replace(/\b([A-Za-z])_([A-Za-z0-9]+)\b/g, "$1_{$2}");
    e = e.replace(/\b([A-Za-z])([0-9]+)\b/g, "$1_{$2}");
    e = e.replace(/\bln\s*\(/g, "\\ln(");
    e = e.replace(/\blog\s*\(/g, "\\log(");
    e = e.replace(/\s*\*\s*/g, " \\cdot ");
    e = e.replace(/%/g, "\\%");
    e = e.replace(/\[/g, "\\left[").replace(/\]/g, "\\right]");
    return e;
  };
  const maybeWrapFormula = (line: string) => {
    if (!line) return line;
    if (/[\$]|\\\(|\\\[|\\begin\{/.test(line)) return line;

    const m = line.match(/^(\s*(?:[-*+]\s+)?(?:[A-D]\.)?\s*)(.*)$/);
    const prefix = m ? m[1] : "";
    const rest = m ? m[2] : line;
    const idx = rest.indexOf(",");
    const candidate = idx >= 0 ? rest.slice(0, idx) : rest;
    const suffix = idx >= 0 ? rest.slice(idx) : "";

    const looksLikeFormula = /\=/.test(candidate) && /[0-9()\[\]\/\*%+-]/.test(candidate);
    if (!looksLikeFormula) return line;

    // If candidate includes normal prose + an equation, only wrap the equation part.
    const hasWords = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(candidate);
    if (!hasWords) {
      const wrapped = `$${latexizeInline(candidate)}$`;
      return `${prefix}${wrapped}${suffix}`;
    }

    const lower = candidate.toLowerCase();
    let start = -1;
    const asIdx = lower.lastIndexOf(' as ');
    if (asIdx >= 0) start = asIdx + 4;
    if (start < 0) {
      const colonIdx = candidate.lastIndexOf(':');
      if (colonIdx >= 0) start = colonIdx + 1;
    }
    if (start < 0) {
      const varMatch = candidate.match(/\b[A-Za-z][A-Za-z0-9_{}^\\]*\s*(?==)/);
      if (varMatch && typeof varMatch.index === 'number') start = varMatch.index;
    }
    if (start < 0) {
      const parIdx = candidate.indexOf('(');
      if (parIdx >= 0) start = parIdx;
    }
    if (start < 0) {
      const wrapped = `$${latexizeInline(candidate)}$`;
      return `${prefix}${wrapped}${suffix}`;
    }

    const before = candidate.slice(0, start);
    const exprRaw = candidate.slice(start);
    const expr = exprRaw.trim();
    if (!expr) return line;
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    const wrapped = `$${latexizeInline(expr)}$`;
    return `${prefix}${before}${sep}${wrapped}${suffix}`;
  };
  out = out
    .split("\n")
    .map((ln) => maybeWrapFormula(ln))
    .join("\n");
  out = out.replace(/(\n\s*){3,}/g, "\n\n");
  return out;
};

export const StudyQuiz = forwardRef<{ refreshQuizzes: () => void }, { userId: string }>(({ userId }, ref) => {
  const { toast } = useToast();
  const gate = usePlanGate();
  const userData = useUserData();
  const [content, setContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const FUN_FACTS: string[] = [
    "Honey never spoils.",
    "Bananas are berries, but strawberries aren't.",
    "Octopuses have three hearts.",
    "A day on Venus is longer than a year on Venus.",
    "There are more stars in the universe than grains of sand on Earth.",
    "Hot water can freeze faster than cold water (Mpemba effect).",
    "Sharks existed before trees.",
    "Wombat poop is cube-shaped.",
    "The Eiffel Tower can be 15 cm taller in summer.",
    "Lightning can heat air to five times hotter than the sun.",
    "The shortest war lasted 38 minutes (Anglo-Zanzibar War).",
    "Humans share ~60% of their DNA with bananas.",
    "Some turtles can breathe through their butts.",
    "Oxford University is older than the Aztec Empire.",
    "Sea otters hold hands while sleeping.",
    "A group of flamingos is called a flamboyance.",
    "Koalas sleep up to 22 hours a day.",
    "Bees can recognize human faces.",
    "There’s a species of jellyfish that is biologically immortal.",
    "Your nose can detect over 1 trillion scents.",
    "Saturn could float in water (if you had a big enough tub).",
    "Tomatoes were once thought to be poisonous in Europe.",
    "The heart of a blue whale is the size of a small car.",
    "A bolt of lightning contains enough energy to toast 100k slices of bread.",
    "Dolphins have names for each other.",
    "Mosquitoes are the deadliest animals to humans.",
    "Peanuts are legumes, not nuts.",
    "The first computer bug was a moth.",
    "The moon is moving away from Earth about 3.8 cm per year.",
    "Cows have best friends and get stressed when separated.",
    "Humans are the only animals that blush.",
    "The tongue is not mapped in taste zones; all tastes can be sensed everywhere.",
    "Polar bear fur is transparent, not white.",
    "Horses and cows can sleep standing up.",
    "There are more possible chess games than atoms in the observable universe.",
    "Pringles cans are not made of pure cardboard-they’re composite packaging.",
    "Butterflies taste with their feet.",
    "Scotland’s national animal is the unicorn.",
    "The inventor of the frisbee was turned into a frisbee after he died.",
    "Humans and giraffes have the same number of neck vertebrae (seven).",
    "Blueberries aren’t actually blue-they’re deep purple.",
    "Alaska is the westernmost and easternmost U.S. state (Aleutian Islands cross the 180° meridian).",
    "Cleopatra lived closer to the iPhone than to the building of the pyramids.",
    "Some metals explode on contact with water (e.g., sodium).",
    "The dot over the letter ‘i’ is called a tittle.",
    "A day on Mars is about 24 hours and 39 minutes.",
    "Rainbows can occur at night (moonbows).",
    "You can’t hum while holding your nose closed.",
    "Avocados are toxic to many animals but healthy for humans.",
    "The longest English word has 189,819 letters (protein nickname: Titin)."
  ];
  const [, setFunFact] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<{ [key: number]: string }>({});
  const [showResults, setShowResults] = useState(false);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [quizMode, setQuizMode] = useState<'mcq'|'short'>('mcq');
  const [includeEssay, setIncludeEssay] = useState<boolean>(false);
  const [fillMode, setFillMode] = useState<'none'|'25'|'50'|'75'|'only'>('none');
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isGrading, setIsGrading] = useState(false);
  const [savedQuizzes, setSavedQuizzes] = useState<{ 
    id: string; 
    title: string; 
    created_at: string; 
    questionCount: number; 
    originalCreator?: string;
    savedFrom?: string;
  }[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{ id: string; score: number; total_questions: number; created_at?: string }[]>([]);
  const [shortScores, setShortScores] = useState<number[]>([]);
  const [shortFeedbacks, setShortFeedbacks] = useState<string[]>([]);
  const [expectedAnswers, setExpectedAnswers] = useState<string[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [loadingPreview] = useState(false);
  const [tab, setTab] = useState<string>(() => {
    try { return sessionStorage.getItem('quiz_active_tab') || 'generate'; } catch { return 'generate'; }
  });
  useEffect(() => { try { sessionStorage.setItem('quiz_active_tab', tab); } catch {} }, [tab]);
  const [bestScores, setBestScores] = useState<Record<string, { best: number; total: number }>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>("");
  const [confirmHasFeedPost, setConfirmHasFeedPost] = useState(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsMeta] = useState<{ id: string; title: string } | null>(null);
  const [reviewingAttempt, setReviewingAttempt] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pendingActionRef = useRef<null | (() => void)>(null);
  const pendingResetRef = useRef<null | (() => void)>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wordLimit, setWordLimit] = useState<number>(3000);
  const [monthlyQuota, setMonthlyQuota] = useState<number>(0);
  const [usesBlocked, setUsesBlocked] = useState<boolean>(false);
  const [hintsCount, setHintsCount] = useState<{ [key: number]: number }>({});
  const [eliminatedOptions, setEliminatedOptions] = useState<{ [key: number]: string[] }>({});
  const isBusy = isGenerating || loadingPreview;
  const canUseQuiz = !gate.loading && gate.quizAccess;
  const [crossOpen, setCrossOpen] = useState(false);
  const crossMetaRef = useRef<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualQuizOpen, setManualQuizOpen] = useState(() => {
    try { return localStorage.getItem('quiz_manual_builder_open') === 'true'; } catch { return false; }
  });
  const [aiQuizOpen, setAiQuizOpen] = useState(() => {
    try { const saved = localStorage.getItem('quiz_ai_generator_open'); return saved === null ? true : saved === 'true'; } catch { return true; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('quiz_manual_builder_open', String(manualQuizOpen));
      localStorage.setItem('quiz_ai_generator_open', String(aiQuizOpen));
    } catch {}
  }, [manualQuizOpen, aiQuizOpen]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedQuizzes, setSelectedQuizzes] = useState<Set<string>>(new Set());
  const [manualQuestions, setManualQuestions] = useState<ManualQuestion[]>(() => [newManualQuestion()]);
  const [savingManualQuiz, setSavingManualQuiz] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  
  // Simulate generation progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isBusy) {
      interval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);
    } else {
      setGenerationProgress(0);
    }
    return () => clearInterval(interval);
  }, [isBusy]);

  // Load attempts for the Results dialog (when opened from My Quizzes)
  useEffect(() => {
    const run = async () => {
      if (!resultsOpen || !resultsMeta?.id || !userId) return;
      try {
        const attemptsRef = collection(db, 'users', userId, 'quiz_attempts');
        // Try ordered load (may require index)
        try {
          const q1 = query(
            attemptsRef,
            where('quiz_id', '==', resultsMeta.id),
            orderBy('created_at', 'desc'),
            limit(25)
          );
          const s1 = await getDocs(q1);
          setAttempts(s1.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any);
        } catch {
          // Fallback without orderBy
          const q2 = query(
            attemptsRef,
            where('quiz_id', '==', resultsMeta.id),
            limit(25)
          );
          const s2 = await getDocs(q2);
          setAttempts(s2.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any);
        }
      } catch (e) {
        console.error('Results load attempts failed', e);
      }
    };
    run();
  }, [resultsOpen, resultsMeta?.id, userId]);

  const reviewAttempt = async (quizIdToReview: string, attemptId: string) => {
    try {
      if (!userId || !quizIdToReview || !attemptId) return;
      setReviewingAttempt(true);
      // Load attempt
      const aRef = doc(db, 'users', userId, 'quiz_attempts', attemptId);
      const aSnap = await getDoc(aRef);
      if (!aSnap.exists()) {
        toast({ title: 'Not found', description: 'Attempt could not be found', variant: 'destructive' });
        return;
      }
      const attempt = aSnap.data() as any;
      let ansRaw: any[] = [];
      if (Array.isArray(attempt.answers)) ansRaw = attempt.answers;
      else if (Array.isArray(attempt.user_answers)) ansRaw = attempt.user_answers;
      else if (Array.isArray(attempt.selections)) ansRaw = attempt.selections;
      else if (Array.isArray(attempt.responses)) ansRaw = attempt.responses;
      else if (attempt.answers && typeof attempt.answers === 'object') {
        // Preserve unanswered positions rather than shifting later responses.
        Object.entries(attempt.answers).forEach(([key, value]) => {
          const index = Number(key);
          if (Number.isInteger(index) && index >= 0) ansRaw[index] = value;
        });
      }
      // Load quiz doc directly (avoid relying on async state)
      const qRef = doc(db, 'users', userId, 'quizzes', quizIdToReview);
      const qSnap = await getDoc(qRef);
      if (!qSnap.exists()) {
        toast({ title: 'Not found', description: 'Quiz not found', variant: 'destructive' });
        return;
      }
      const qData = qSnap.data() as any;
      const quizQs = (qData.questions || []) as Question[];

      // answers are indexed; guard length and normalize using quizQs
      const hydrated: { [key: number]: string } = {};
      const toLetter = (idx: number) => ['A','B','C','D'][idx] || '';
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      (quizQs || []).forEach((q: any, i: number) => {
        const a = ansRaw[i];
        if (a == null) { hydrated[i] = ''; return; }
        if (q.question_type === 'multiple_choice') {
          const rawOpts = (q.options ?? {}) as any;
          // Build a unified letter->text map even if options is an array
          const opts: Record<string,string> = {};
          if (Array.isArray(rawOpts)) {
            rawOpts.forEach((text: any, idx: number) => { const L = toLetter(idx); if (L) opts[L] = String(text ?? ''); });
          } else if (typeof rawOpts === 'object') {
            Object.entries(rawOpts).forEach(([k,v]) => { opts[k.toUpperCase()] = String((v as any) ?? ''); });
          }
          let letter = '';
          if (typeof a === 'string') {
            const up = a.trim().toUpperCase();
            if (opts[up]) {
              letter = up;
            } else {
              // match by text
              const target = norm(a);
              const found = Object.entries(opts).find(([, text]) => norm(String(text||'')) === target);
              if (found) letter = found[0];
            }
          } else if (typeof a === 'number') {
            const L = toLetter(a);
            if (opts[L]) letter = L;
          } else if (typeof a === 'object' && a) {
            const maybeKey = String((a.key ?? a.id ?? a.option ?? '')).toUpperCase();
            if (maybeKey && opts[maybeKey]) {
              letter = maybeKey;
            } else if (a.text) {
              const target = norm(String(a.text||''));
              const found = Object.entries(opts).find(([, text]) => norm(String(text||'')) === target);
              if (found) letter = found[0];
            }
          }
          hydrated[i] = letter || '';
        } else {
          // short/fill: keep as text
          hydrated[i] = String(a ?? '');
        }
      });
      // Set component state to render consistent read-only results
      setSelectedQuizId(quizIdToReview);
      setQuizId(quizIdToReview);
      setQuizTitle(qData.title || '');
      setQuestions(quizQs);
      try {
        const savedMode = (qData.mode === 'short' ? 'short' : qData.mode === 'mcq' ? 'mcq' : null) as ('mcq'|'short'|null);
        if (savedMode) setQuizMode(savedMode);
      } catch {}
      setAnswers(hydrated);
      setShortScores(Array.isArray(attempt.short_scores) ? attempt.short_scores : []);
      setShortFeedbacks(Array.isArray(attempt.short_feedbacks) ? attempt.short_feedbacks : []);
      setExpectedAnswers(Array.isArray(attempt.expected_answers)
        ? attempt.expected_answers
        : quizQs.map(q => isShortAnswerQuestion(q) ? getReferenceAnswer(q) : ''));
      setShowResults(true);
      setCurrentQuestionIndex(0);
      setTab('library');
      setResultsOpen(false);
    } catch (e: any) {
      toast({ title: 'Unable to review', description: e?.message || 'This attempt cannot be reviewed', variant: 'destructive' });
    } finally {
      setReviewingAttempt(false);
    }
  };

  // Restore AI quiz draft on mount (mobile resilience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('quiz_draft');
      if (!raw) return;
      const d = JSON.parse(raw || '{}');
      let restored = false;
      if (typeof d.quizTitle === 'string') { setQuizTitle(d.quizTitle); restored = true; }
      if (typeof d.content === 'string') { setContent(d.content); restored = true; }
      if (d.quizMode && (d.quizMode === 'mcq' || d.quizMode === 'short')) { setQuizMode(d.quizMode); restored = true; }
      if (d.fillMode && (d.fillMode === 'none' || d.fillMode === '25' || d.fillMode === '50' || d.fillMode === '75' || d.fillMode === 'only')) { setFillMode(d.fillMode); restored = true; }
      if (restored) { toast({ title: 'Draft restored', description: 'Recovered your previous quiz inputs.' }); }
      localStorage.removeItem('quiz_draft');
    } catch {}
  }, []);

  const createFlashcardsFromQuiz = async (quizId: string, title: string) => {
    try {
      const docRef = doc(db, 'users', userId, 'quizzes', quizId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        toast({ title: 'Error', description: 'Quiz not found', variant: 'destructive' });
        return;
      }

      const data = docSnap.data();
      const questions = data.questions || [];
      
      // Transform quiz questions into flashcards
      const flashcards = questions.map((q: Question, index: number) => ({
        id: `card-${index}-${Date.now()}`,
        front: q.question,
        back: q.question_type === 'multiple_choice' 
          ? (q.options ? q.options[q.correct_answer] : q.correct_answer)
          : q.correct_answer,
        explanation: q.explanation,
        tags: ['from-quiz'],
        created_at: serverTimestamp()
      }));

      // Count this cross-generation as a usage; gate on limit
      try { await incrementMonthlyUsage(userId); } catch (e: any) {
        toast({ title: 'Limit reached', description: (e?.message || 'You have reached your monthly limit.'), variant: 'destructive' });
        return;
      }

      // Save to flashcards collection
      const flashcardSetId = `set-${quizId}-${Date.now()}`;
      await setDoc(doc(db, 'users', userId, 'flashcards', flashcardSetId), {
        id: flashcardSetId,
        title: `${title}, Flashcards`,
        description: `Created from quiz: ${title}`,
        flashcards,
        created_at: serverTimestamp(),
        question_count: flashcards.length,
        source_quiz: quizId
      });

      toast({ 
        title: 'Flashcards Created', 
        description: `Created ${flashcards.length} flashcards from your quiz` 
      });

      // Navigate to flashcards page if available
      if ((window as any).navigateToFlashcards) {
        (window as any).navigateToFlashcards(flashcardSetId);
      }

    } catch (error: any) {
      toast({ 
        title: 'Error', 
        description: error.message || 'Failed to create flashcards', 
        variant: 'destructive' 
      });
    }
  };

  const createSummaryFromQuiz = async (quizId: string, title: string) => {
    try {
      const docRef = doc(db, 'users', userId, 'quizzes', quizId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        toast({ title: 'Error', description: 'Quiz not found', variant: 'destructive' });
        return;
      }

      const data = docSnap.data();
      const questions = data.questions || [];
      
      // Extract key topics from questions
      const topics = questions.map((q: Question) => q.question).join('\n');
      
      // Generate summary using your API
      const response = await fetch(`${API_BASE}/generate-summary`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          content: topics,
          title: `Summary: ${title}`,
          format: 'bullet_points'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }

      const summaryData = await response.json();
      
      // Save summary
      const summaryId = `summary-${quizId}-${Date.now()}`;
      await setDoc(doc(db, 'users', userId, 'summaries', summaryId), {
        id: summaryId,
        title: `Summary: ${title}`,
        content: summaryData.summary,
        source_quiz: quizId,
        created_at: serverTimestamp(),
        word_count: summaryData.summary?.split(' ').length || 0
      });

      toast({ 
        title: 'Summary Created', 
        description: 'Generated a summary from your quiz content' 
      });

    } catch (error: any) {
      toast({ 
        title: 'Error', 
        description: error.message || 'Failed to create summary', 
        variant: 'destructive' 
      });
    }
  };

  const createEssayFromQuiz = async (quizId: string, title: string) => {
    try {
      const docRef = doc(db, 'users', userId, 'quizzes', quizId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        toast({ title: 'Error', description: 'Quiz not found', variant: 'destructive' });
        return;
      }

      const data = docSnap.data();
      const questions = data.questions || [];
      
      // Use questions as essay prompt
      const essayPrompt = `Write a comprehensive essay covering the following topics from the quiz "${title}":\n\n${
        questions.map((q: Question, i: number) => `${i + 1}. ${q.question}`).join('\n')
      }`;

      // Count essay generation as usage
      try {
        await incrementMonthlyUsage(userId, { inputChars: Math.max(1, essayPrompt.length) });
      } catch (e: any) {
        toast({ title: 'Limit reached', description: (e?.message || 'You have reached your monthly limit.'), variant: 'destructive' });
        return;
      }

      // Generate essay using your API
      const response = await fetch(`${API_BASE}/generate-essay`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          prompt: essayPrompt,
          title: `Essay: ${title}`,
          word_count: 1000
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate essay');
      }

      const essayData = await response.json();
      
      // Save essay
      const essayId = `essay-${quizId}-${Date.now()}`;
      await setDoc(doc(db, 'users', userId, 'essays', essayId), {
        id: essayId,
        title: `Essay: ${title}`,
        content: essayData.essay,
        prompt: essayPrompt,
        source_quiz: quizId,
        created_at: serverTimestamp(),
        word_count: essayData.essay?.split(' ').length || 0
      });

      toast({ 
        title: 'Essay Created', 
        description: 'Generated an essay from your quiz topics' 
      });

    } catch (error: any) {
      toast({ 
        title: 'Error', 
        description: error.message || 'Failed to create essay', 
        variant: 'destructive' 
      });
    }
  };

  const dispatchFromQuiz = async (quizId: string, title: string, type: 'flashcards' | 'summary' | 'essay' | 'outline' | 'questions') => {
    switch (type) {
      case 'flashcards':
        await createFlashcardsFromQuiz(quizId, title);
        break;
      case 'summary':
        await createSummaryFromQuiz(quizId, title);
        break;
      case 'essay':
        await createEssayFromQuiz(quizId, title);
        break;
      case 'questions':
        toast({ title: 'Coming Soon', description: 'Practice questions generation will be available soon' });
        break;
      case 'outline':
        toast({ title: 'Coming Soon', description: 'Outline generation will be available soon' });
        break;
      default:
        toast({ title: 'Error', description: 'Unknown creation type', variant: 'destructive' });
    }
  };

  const { showAnimation: showUsageAnim, triggerAnimation: triggerUsageAnim } = useUsageAnimation();

  const generateQuiz = async () => {
    if (importingFile) {
      toast({ title: "Still reading file", description: "Please wait for the file to finish importing.", variant: "destructive" });
      return;
    }
    if (!canUseQuiz) {
      toast({ title: "Upgrade required", description: "Quiz generator is available on Basic and higher plans.", variant: "destructive" });
      return;
    }
    if (!content.trim()) {
      toast({ title: "Error", description: "Please enter some content", variant: "destructive" });
      return;
    }

    if (!quizTitle.trim()) {
      toast({ title: "Error", description: "Please enter a quiz title", variant: "destructive" });
      return;
    }

    // Local short-context guard for large counts to avoid unnecessary requests and usage charges
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    if (questionCount >= 30 && words < 5) {
      toast({ title: "Context too short", description: "Please provide a bit more content for 30+ questions.", variant: "destructive" });
      return;
    }

    setFunFact(FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)]);
    setIsGenerating(true);
    try {
      setUnsavedChanges(true);

      // Helpers
      const toLetter = (idx: number) => ["A","B","C","D"][idx] || String.fromCharCode(65+idx);
      const normalizeQuestion = (q: any): Question | null => {
        const text = (q.question || q.prompt || "").toString().trim();
        if (!text) return null;

        // Gather options from various shapes
        let optionsArr: string[] = [];
        if (Array.isArray(q.options)) {
          optionsArr = q.options.map((o: any) => (typeof o === 'string' ? o : (o?.text ?? ''))).filter((s: string) => !!s);
        } else if (q.options && typeof q.options === 'object') {
          const entries = Object.entries(q.options).map(([k,v]) => [k, (v as any)?.text ?? (v as any) ?? ""]).filter(([,v]) => (v as string).toString().trim());
          // sort by key if keys are letters/numbers
          entries.sort((a,b) => a[0].toString().localeCompare(b[0].toString()));
          optionsArr = entries.map(([,v]) => (v as string).toString());
        }
        // Fallback: some APIs may return choices or answers array
        if (!optionsArr.length && Array.isArray(q.choices)) {
          optionsArr = q.choices.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).filter(Boolean);
        }

        // Need at least 2 options; take up to 4
        optionsArr = optionsArr.filter(Boolean).slice(0, 4);
        if (optionsArr.length < 2) return null;

        // Determine correct answer letter by either given key or matching text
        const correctRaw = (q.correct_answer ?? q.answer ?? q.correct ?? '').toString();
        let correctIndex = -1;
        // If correct is a letter-like index
        const upper = correctRaw.toUpperCase();
        const letterIdx = ["A","B","C","D"].indexOf(upper);
        if (letterIdx >= 0 && letterIdx < optionsArr.length) {
          correctIndex = letterIdx;
        } else {
          // try to match by option text (case-insensitive)
          const norm = (s: string) => s.toLowerCase().replace(/\s+/g,' ').trim();
          const target = norm(correctRaw);
          correctIndex = optionsArr.findIndex((opt) => norm(opt) === target);
        }
        if (correctIndex < 0) {
          // Fallback: assume first option is correct if backend did not specify
          correctIndex = 0;
        }

        // Build A-D options object
        const optObj: { [key: string]: string } = {};
        optionsArr.forEach((opt, idx) => { optObj[toLetter(idx)] = opt; });

        return {
          id: (q.id || cryptoRandomId()),
          question: text,
          question_type: 'multiple_choice',
          options: optObj,
          correct_answer: toLetter(correctIndex),
          explanation: (q.explanation || q.rationale || '').toString() || undefined,
        } as Question;
      };

      const cryptoRandomId = () => Math.random().toString(36).slice(2);

      // Batch until we have enough questions (cap retries to avoid loops)
      const collected: Question[] = [];
      const seen = new Set<string>();
      let tries = 0;
      while (collected.length < questionCount && tries < 3) {
        const remaining = Math.max(1, questionCount - collected.length);
        // Cap per-request count to avoid backend limits (e.g., 20-25)
        const perRequest = Math.min(remaining, 25);
        const endpoint = quizMode === 'short' ? `${API_BASE}/quiz/generate-short-answers` : `${API_BASE}/generate-quiz`;
        const payload = {
          title: quizTitle,
          content,
          questionCount: perRequest,
          includeEssay: quizMode === 'short' ? includeEssay : undefined,
          includeFillBlank: fillMode !== 'none',
          fillBlankMode: fillMode,
          userId, // Server tracks usage
        } as any;
        const resp = await fetch(endpoint, { method:'POST', headers: await getAuthHeaders(), body: JSON.stringify(payload) });
        let data: any = null; try { data = await resp.json(); } catch {}
        if (!resp.ok || (data && data.error)) {
          if (resp.status === 400 && (data?.error === 'context_too_short')) {
            throw new Error('Context too short for the requested number of questions. Please add more content.');
          }
          if (resp.status === 403) {
            toast({ title: 'Limit reached', description: (data?.error || 'You have reached your monthly limit.'), variant: 'destructive' });
            break;
          }
          throw new Error((data && (data.error || data.message)) || 'Failed to generate quiz');
        }
        // Usage is now tracked server-side
        // Expect questions array
        let normalized: Question[] = [];
        if (quizMode === 'short') {
          normalized = (data.questions || []).map((q: any): Question => {
            const referenceAnswer = getReferenceAnswer(q);
            if (!referenceAnswer) throw new Error('A generated question is missing its expected answer. Please regenerate the quiz.');
            return {
              id: cryptoRandomId(),
              question: String(q.question || q.prompt || ''),
              question_type: 'short_answer',
              correct_answer: referenceAnswer,
              reference_answer: referenceAnswer,
            };
          });
        } else {
          normalized = (data.questions || []).map((q: any) => normalizeQuestion(q)).filter(Boolean) as Question[];
        }
        for (const q of normalized) {
          const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
          if (!seen.has(key)) {
            seen.add(key);
            collected.push(q);
            if (collected.length >= questionCount) break;
          }
        }
        tries++;
        if (normalized.length === 0) break;
      }

      if (collected.length === 0) throw new Error("No questions could be generated. Try adding more context or reducing the count.");
      if (collected.length < questionCount) {
        // Create variants of existing questions to reach target count by shuffling options and rephrasing label
        const rand = <T,>(arr: T[]) => arr.map((v) => ({ v, r: Math.random() })).sort((a,b)=>a.r-b.r).map(({v})=>v);
        const variants: Question[] = [];
        let vIndex = 1;
        while (collected.length + variants.length < questionCount) {
          const base = collected[(collected.length + variants.length) % collected.length];
          if (!base.options) break;
          const entries = Object.entries(base.options);
          const shuffled = rand(entries);
          const optObj: { [k: string]: string } = {};
          shuffled.forEach(([_, text], idx) => { optObj[toLetter(idx)] = text; });
          const correctText = base.options[base.correct_answer];
          const newCorrectIdx = shuffled.findIndex(([, text]) => text === correctText);
          if (newCorrectIdx < 0) break;
          variants.push({
            id: `${base.id}-v${vIndex}`,
            question: `${base.question} (variant ${vIndex})`,
            question_type: 'multiple_choice',
            options: optObj,
            correct_answer: toLetter(newCorrectIdx),
            explanation: base.explanation,
          });
          vIndex++;
          if (vIndex > questionCount * 2) break; // safety
        }

        const finalQs = [...collected, ...variants].slice(0, questionCount);
        if (finalQs.length < questionCount) {
          toast({ title: "Max questions available", description: `Only ${finalQs.length} questions could be produced from the provided content.`, });
        } else {
          toast({ title: "Filled with variants", description: `Some questions were varied to reach ${questionCount}.`, });
        }
        setQuestions(finalQs);
      } else {
        setQuestions(collected.slice(0, questionCount));
      }
      setUnsavedChanges(true);
      // Auto-save quiz immediately
      const id = cryptoRandomId();
      setQuizId(id);
      await setDoc(doc(db, "users", userId, "quizzes", id), {
        id,
        title: quizTitle || "Untitled Quiz",
        created_at: serverTimestamp(),
        questionCount: (collected.length >= questionCount ? questionCount : collected.length),
        questions: (collected.length >= questionCount ? collected.slice(0, questionCount) : collected),
        mode: quizMode,
      });
      // Auto-save completed; clear unsaved flag to avoid leave prompts
      setUnsavedChanges(false);
      // Immediately reflect the new quiz in sidebar and My Quizzes
      try {
        const created_at = new Date().toISOString();
        const qCount = (collected.length >= questionCount ? questionCount : collected.length);
        const newItem = { id, title: quizTitle || "Untitled Quiz", created_at, questionCount: qCount } as { id: string; title: string; created_at: string; questionCount: number };
        setSavedQuizzes(prev => [newItem, ...prev]);
        setBestScores(prev => ({ ...prev, [id]: { best: 0, total: qCount } }));
        // No need to refetch from Firestore, we have the data
      } catch {}
      // Skip expensive achievement check on every generation
      // try {
      //   const qRef = collection(db, "users", userId, "quizzes");
      //   const qSnap = await getDocs(qRef);
      //   const n = qSnap.size;
      //   if (n === 5) { try { await awardAchievement(userId, "library_5_quizzes"); } catch {} }
      //   if (n === 20) { try { await awardAchievement(userId, "library_20_quizzes"); } catch {} }
      // } catch {}
      toast({ title: "Success", description: "Quiz generated and saved!" });
      triggerUsageAnim();
      try { await awardActionXP(userId, 'quiz', { questionCount, quizMode, includeEssay }); } catch {}
      // Track quiz creation for weekly goals
      try { await incrementCounter(userId, 'quizzes'); } catch {}
      // Keep the active quiz's title and mode for submission and results.
      try {
        setContent("");
        setQuestionCount(5);
        setIncludeEssay(false);
        setFillMode('none');
        try { localStorage.removeItem('quiz_draft'); } catch {}
      } catch {}
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to generate quiz", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  
  const deleteQuiz = async (id: string) => {
    console.log("Attempting to delete quiz:", id);
    const prevQuizzes = savedQuizzes;

    try {
      if (!userId) {
        console.error("deleteQuiz: no userId");
        toast({ title: "Error", description: "No user, please sign in again.", variant: "destructive" });
        return;
      }
      if (!id) {
        console.error("deleteQuiz: no id");
        toast({ title: "Error", description: "Missing quiz id", variant: "destructive" });
        return;
      }
      
      // Optimistic: remove from UI instantly, restore on failure
      setSavedQuizzes(prev => prev.filter(q => q.id !== id));
      setBestScores(prev => { const next = { ...prev }; delete next[id]; return next; });
      if (selectedQuizId === id) {
        setSelectedQuizId(null);
        setQuestions([]);
        setAnswers({});
        setShowResults(false);
        setQuizId(null);
        setQuizTitle("");
      }

      // First, check if the quiz exists (skip this read if we already know it exists in the list)
      const quizRef = doc(db, "users", userId, "quizzes", id);
      
      // Delete attempts for this quiz using batch (reduces writes)
      try {
        const attemptsRef = collection(db, "users", userId, "quiz_attempts");
        const q = query(attemptsRef, where("quiz_id", "==", id));
        const aSnap = await getDocs(q);
        console.log(`Found ${aSnap.docs.length} attempts to delete`);
        
        const batch = writeBatch(db);
        if (aSnap.docs.length > 0) {
          aSnap.docs.forEach((d) => {
            batch.delete(doc(db, "users", userId, "quiz_attempts", d.id));
          });
        }
        // Delete quiz itself in the same batch
        batch.delete(quizRef);
        await batch.commit();
        console.log("Batch deleted quiz and", aSnap.docs.length, "attempts");
      } catch (attemptsError: any) {
        console.warn("Failed to batch delete:", attemptsError.message);
        // Fallback to simple delete if batch fails
        await deleteDoc(quizRef);
      }
      
      console.log("Quiz document deleted successfully");
      
      // Delete associated feed post if exists
      try {
        const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", id), where("ownerId", "==", userId), limit(1));
        const feedSnap = await getDocs(feedQuery);
        for (const feedDoc of feedSnap.docs) {
          // Delete subcollections first (parallel)
          await Promise.all(['reactions', 'comments', 'runs'].map(async (sub) => {
            const subSnap = await getDocs(collection(db, "feed_posts", feedDoc.id, sub));
            await Promise.all(subSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
          }));
          await deleteDoc(feedDoc.ref);
          console.log("Deleted associated feed post:", feedDoc.id);
        }
      } catch (e) { console.warn("Failed to delete feed post:", e); }
      
      console.log("Quiz deletion completed successfully");
      toast({ title: "Deleted", description: "Quiz removed successfully" });

    } catch (e: any) {
      setSavedQuizzes(prevQuizzes);
      console.error("Failed to delete quiz:", e);
      toast({ 
        title: "Error", 
        description: `Failed to delete quiz: ${e.message || "Unknown error"}`, 
        variant: "destructive" 
      });
    }
  };

  const requestDeleteQuiz = async (id: string, title: string) => {
    console.log("Delete requested for quiz:", { id, title });
    setConfirmId(id);
    setConfirmTitle(title || "this quiz");
    // Check if there's an associated feed post
    let hasFeedPost = false;
    try {
      const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", id), where("ownerId", "==", userId), limit(1));
      const feedSnap = await getDocs(feedQuery);
      hasFeedPost = !feedSnap.empty;
    } catch {}
    setConfirmHasFeedPost(hasFeedPost);
    setConfirmOpen(true);
    console.log("Confirmation dialog opened, hasFeedPost:", hasFeedPost);
  };

  const toggleQuizSelection = (id: string) => {
    setSelectedQuizzes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteQuizzes = async () => {
    if (selectedQuizzes.size === 0) return;
    try {
      setDeleting(true);
      const batch = writeBatch(db);
      
      for (const quizId of selectedQuizzes) {
        // Get attempts for each quiz
        try {
          const attemptsRef = collection(db, "users", userId, "quiz_attempts");
          const q = query(attemptsRef, where("quiz_id", "==", quizId));
          const aSnap = await getDocs(q);
          aSnap.docs.forEach(d => batch.delete(doc(db, "users", userId, "quiz_attempts", d.id)));
        } catch {}
        // Delete quiz
        batch.delete(doc(db, "users", userId, "quizzes", quizId));
      }
      
      await batch.commit();
      
      // Update UI
      setSavedQuizzes(prev => prev.filter(q => !selectedQuizzes.has(q.id)));
      setBestScores(prev => {
        const next = { ...prev };
        selectedQuizzes.forEach(id => delete next[id]);
        return next;
      });
      
      toast({ title: "Success", description: `Deleted ${selectedQuizzes.size} quiz${selectedQuizzes.size === 1 ? '' : 'zes'}` });
      setSelectedQuizzes(new Set());
      setSelectionMode(false);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to delete quizzes", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const openRename = (id: string, currentTitle: string) => {
    setRenameId(id);
    setRenameTitle(currentTitle || "");
    setRenameOpen(true);
  };

  const duplicateAsOtherMode = async (id: string) => {
    try {
      const dref = doc(db, "users", userId, "quizzes", id);
      const ds = await getDoc(dref);
      if (!ds.exists()) return toast({ title: 'Error', description: 'Quiz not found', variant: 'destructive' });
      const data = ds.data() as any;
      const currentMode = (data.mode === 'short' ? 'short' : 'mcq') as 'mcq'|'short';
      const toMode = currentMode === 'mcq' ? 'short' : 'mcq';
      const titleBase = String(data.title || 'Untitled Quiz');
      const newId = Math.random().toString(36).slice(2);

      let newItemCount = 0;
      
      if (toMode === 'short') {
        const sourceQs = (data.questions || []) as any[];
        const converted = sourceQs.map((q: any) => {
          const referenceAnswer = isShortAnswerQuestion(q)
            ? getReferenceAnswer(q)
            : String(q.options?.[q.correct_answer] || '');
          return {
            id: Math.random().toString(36).slice(2),
            question: String(q?.question || ''),
            question_type: 'short_answer',
            correct_answer: referenceAnswer,
            reference_answer: referenceAnswer,
          };
        }).filter((q: any) => q.question);
        
        newItemCount = converted.length;
        
        await setDoc(doc(db, 'users', userId, 'quizzes', newId), {
          id: newId,
          title: `${titleBase} (Short Answer)`,
          created_at: serverTimestamp(),
          questionCount: newItemCount,
          questions: converted,
          mode: 'short',
        });
        toast({ title: 'Duplicated', description: 'Created Short Answer copy' });
      } else {
        // Generate MCQs from existing short-answer questions by using them as content
        const sourceQs = (data.questions || []) as any[];
        const content = sourceQs.map(q => String(q?.question || '')).filter(Boolean).join('\n');
        const qCount = Math.max(1, Math.min(20, sourceQs.length || 5));
        // Usage is tracked server-side
        const endpoint = `${API_BASE}/generate-quiz`;
        const payload = { title: `${titleBase} (MCQ)`, content, questionCount: qCount, userId };
        const resp = await fetch(endpoint, { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify(payload) });
        const gen = await resp.json();
        if (resp.status === 403) {
          toast({ title: 'Limit reached', description: (gen?.error || 'You have reached your monthly limit.'), variant: 'destructive' });
          return;
        }
        if (!resp.ok || gen.error) throw new Error(gen.error || 'Failed to generate MCQ copy');
        const normalized = Array.isArray(gen.questions) ? gen.questions : [];
        
        newItemCount = normalized.length;

        await setDoc(doc(db, 'users', userId, 'quizzes', newId), {
          id: newId,
          title: `${titleBase} (MCQ)`,
          created_at: serverTimestamp(),
          questionCount: newItemCount,
          questions: normalized,
          mode: 'mcq',
        });
        toast({ title: 'Duplicated', description: 'Created Multiple Choice copy' });
      }

      // Update sidebar list quickly (Optimistic Update)
      try {
        const created_at = new Date().toISOString();
        const newItem = { 
          id: newId, 
          title: toMode === 'short' ? `${titleBase} (Short Answer)` : `${titleBase} (MCQ)`, 
          created_at, 
          questionCount: newItemCount
        } as { id: string; title: string; created_at: string; questionCount: number };
        setSavedQuizzes(prev => [newItem, ...prev]);
      } catch {}
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to duplicate', variant: 'destructive' });
    }
  };

  const saveRename = async () => {
    if (!renameId) {
      console.log("saveRename: no renameId");
      return;
    }
    const next = renameTitle.trim();
    if (!next) {
      console.log("saveRename: empty title");
      return;
    }
    console.log("saveRename: starting rename", { renameId, next });
    
    try {
      await updateDoc(
        doc(db, "users", userId, "quizzes", renameId),
        { title: next.substring(0, 80) }
      );
      console.log("saveRename: Firestore update complete");
      
      // Update local state immediately
      setSavedQuizzes(prev => prev.map(q => 
        q.id === renameId ? { ...q, title: next.substring(0, 80) } : q
      ));
      
      if (quizId === renameId) setQuizTitle(next.substring(0, 80));
      
      toast({ title: "Renamed", description: "Quiz title updated" });
      setRenameOpen(false);
      setRenameId(null);
      setRenameTitle("");
      
      // Reload in background to ensure consistency
      loadSavedQuizzes().catch(console.error);
      
    } catch (e: any) {
      console.error("saveRename: error", e);
      toast({ title: "Error", description: e.message || "Failed to rename quiz", variant: "destructive" });
    }
  };

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const lev = (a: string, b: string) => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 1) return 2; // early exit for >1 edits
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const temp = dp[j];
        if (a[i - 1] === b[j - 1]) dp[j] = prev;
        else dp[j] = 1 + Math.min(prev, dp[j - 1], dp[j]);
        prev = temp;
      }
    }
    return dp[n];
  };
  const approxEqual = (a: string, b: string) => {
    const A = normalize(a);
    const B = normalize(b);
    if (!A && !B) return true;
    if (A === B) return true;
    return lev(A, B) <= 1;
  };
  const isCorrect = (q: Question, ans: string) => {
    if (q.question_type === "multiple_choice") {
      // Accept letter key match or exact option text match (case-insensitive)
      if (!q.options) return false;
      const letter = ans.trim().toUpperCase();
      if (letter === q.correct_answer.toUpperCase()) return true;
      const optionText = q.options[letter];
      if (optionText && normalize(optionText) === normalize(q.options[q.correct_answer] || "")) return true;
      return false;
    }
    // Short/fill: accept multiple alternatives split by | or / in correct_answer, with tolerance (<=1 edit)
    const candidates = q.correct_answer.split(/\||\//).map((t) => t);
    return candidates.some((cand) => approxEqual(cand, ans));
  };

  const submitQuiz = async () => {
    if (!quizId || isGrading) return;
    // Determine grading per question so mixed quizzes keep their choice answers.
    const isShortAnswerQuiz = questions.some(isShortAnswerQuestion);
    
    if (isShortAnswerQuiz) {
      setIsGrading(true);
      try {
        const data = await gradeQuizAnswers(quizTitle, questions, answers, index => {
          const question = questions[index];
          const correct = isCorrect(question, answers[index] || '');
          return {
            score: correct ? ((hintsCount[index] || 0) >= 2 ? 50 : 100) : 0,
            feedback: correct ? 'Correct answer.' : 'Incorrect answer.',
            expectedAnswer: question.options?.[question.correct_answer] || question.correct_answer,
          };
        });
        const items = data.items;
        
        const perScores = items.map(it => Number(it.score || 0));
        const perFeedbacks = items.map(it => String(it.feedback || ''));
        const perExpected = items.map(it => it.expectedAnswer);
        
        setShortScores(perScores);
        setShortFeedbacks(perFeedbacks);
        setExpectedAnswers(perExpected);
        
        const overall = Number(data.overall ?? Math.round(perScores.reduce((a,b)=>a+b,0) / Math.max(1, perScores.length)));
        
        // Save attempt
        await addDoc(collection(db, 'users', userId, 'quiz_attempts'), {
          quiz_id: quizId,
          score: overall,
          total_questions: questions.length,
          answers,
          short_scores: perScores,
          short_feedbacks: perFeedbacks,
          expected_answers: perExpected,
          created_at: serverTimestamp(),
        });
        
        // Update best score on quiz doc (short answer uses 0-100 scale)
        try {
          const qref = doc(db, 'users', userId, 'quizzes', quizId);
          const qsnap = await getDoc(qref);
          const qdata = qsnap.exists() ? (qsnap.data() as any) : {};
          const prevBest = Number(qdata.best_score || 0);
          const prevTotal = Number(qdata.best_total || 0);
          if (overall > prevBest) {
            await setDoc(qref, { best_score: overall, best_total: 100 }, { merge: true });
            setBestScores((prev) => ({ ...prev, [quizId]: { best: overall, total: 100 } }));
          } else if (!prevTotal) {
            // Ensure best_total is present for UI consistency
            await setDoc(qref, { best_total: 100 }, { merge: true });
            setBestScores((prev) => ({ ...prev, [quizId]: { best: prev[quizId]?.best || 0, total: 100 } }));
          }
        } catch {}
        
        try { await addXP(userId, Math.max(1, Math.round(overall/10))); } catch {}

        // Quiz completion + mastery achievements (overall is out of 100)
        try {
          await incrementCounterAndAwardOn(userId, 'quizzes_completed', [
            [1, 'first_quiz'], [10, 'quiz_10'], [50, 'quiz_50'], [100, 'quiz_100'],
          ]);
        } catch {}
        if (overall >= 90) {
          try { await incrementCounterAndMaybeAward(userId, 'quizzes_90plus', 10, 'quiz_master_10_90'); } catch {}
          if (overall >= 100) { try { await awardAchievement(userId, "perfect_quiz"); } catch {} }
        }

        setShowResults(true);
        toast({ title: 'Graded', description: `Overall ${overall}/100 with feedback` });
      } catch (e:any) {
        toast({ title: 'Error', description: e.message || 'Failed to grade answers', variant: 'destructive' });
      } finally {
        setIsGrading(false);
      }
    } else {
      let score = 0;
      questions.forEach((q, i) => {
        if (isCorrect(q, answers[i] || "")) {
          const used = hintsCount[i] || 0;
          if (used >= 2) score += 0.5; else score += 1;
        }
      });
      try {
        await addDoc(collection(db, "users", userId, "quiz_attempts"), {
          quiz_id: quizId,
          score,
          total_questions: questions.length,
          answers: answers,
          created_at: serverTimestamp(),
        });
        if (questions.length > 0 && score === questions.length) {
          try { await awardAchievement(userId, "perfect_quiz"); } catch {}
        }
        // Quiz completion + mastery achievements
        try {
          await incrementCounterAndAwardOn(userId, 'quizzes_completed', [
            [1, 'first_quiz'], [10, 'quiz_10'], [50, 'quiz_50'], [100, 'quiz_100'],
          ]);
        } catch {}
        if (questions.length > 0 && (score / questions.length) >= 0.9) {
          try { await incrementCounterAndMaybeAward(userId, 'quizzes_90plus', 10, 'quiz_master_10_90'); } catch {}
        }
        try {
          const base = questions.length > 0 ? Math.max(1, Math.round((score / questions.length) * 10)) : 1;
          await addXP(userId, base + (score === questions.length ? 5 : 0));
        } catch {}
        // Update best score on quiz doc (MCQ uses PERCENT out of 100 for consistency)
        try {
          const qref = doc(db, 'users', userId, 'quizzes', quizId);
          const qsnap = await getDoc(qref);
          const qdata = qsnap.exists() ? (qsnap.data() as any) : {};
          const prevBest = Number(qdata.best_score || 0); // interpret as percent when best_total==100
          const prevTotal = Number(qdata.best_total || 0);
          const total = questions.length;
          const percent = total > 0 ? Math.round((score / total) * 100) : 0;
          if (percent > prevBest || prevTotal !== 100) {
            await setDoc(qref, { best_score: percent, best_total: 100 }, { merge: true });
            setBestScores((prev) => ({ ...prev, [quizId]: { best: percent, total: 100 } }));
          } else if (!prevTotal) {
            await setDoc(qref, { best_total: 100 }, { merge: true });
            setBestScores((prev) => ({ ...prev, [quizId]: { best: prev[quizId]?.best || 0, total: 100 } }));
          }
        } catch {}
        setShowResults(true);
        const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
        toast({ title: "Results saved", description: `Score: ${pct}%` });
      } catch (e: any) {
        toast({ title: "Error", description: e.message || "Failed to save quiz results", variant: "destructive" });
      }
    }
  };

  const redoShortQuestion = async (index: number) => {
    if (!questions[index] || !isShortAnswerQuestion(questions[index]) || isGrading) return;
    setIsGrading(true);
    try {
      const resp = await fetch(`${API_BASE}/quiz/grade-short-answer`, {
        method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify({
          title: quizTitle,
          question: questions[index]?.question || '',
          answer: answers[index] || '',
          referenceAnswer: getReferenceAnswer(questions[index]),
        })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Failed to grade');
      const s = Number(data.score || 0);
      const f = String(data.feedback || '');
      setShortScores(prev => {
        const next = [...prev]; next[index] = s; return next;
      });
      setShortFeedbacks(prev => {
        const next = [...prev]; next[index] = f; return next;
      });
      setExpectedAnswers(prev => {
        const next = [...prev]; next[index] = data.expectedAnswer || getReferenceAnswer(questions[index]); return next;
      });
      toast({ title:'Regraded', description:`Q${index+1}: ${s}/100` });
    } catch (e:any) {
      toast({ title:'Error', description: e.message || 'Failed to regrade', variant:'destructive' });
    } finally {
      setIsGrading(false);
    }
  };

  const resetQuiz = () => {
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setShowResults(false);
    setQuizId(null);
    setQuizTitle("");
    setQuestionCount(5);
    setTab("library");
    setHintsCount({});
    setEliminatedOptions({});
    setShortScores([]);
    setShortFeedbacks([]);
    setExpectedAnswers([]);
    setIsGrading(false);
  };

  const retakeQuiz = () => {
    setAnswers({});
    setCurrentQuestionIndex(0);
    setShowResults(false);
    setHintsCount({});
    setEliminatedOptions({});
    setShortScores([]);
    setShortFeedbacks([]);
    setExpectedAnswers([]);
    setIsGrading(false);
  };

  const newQuiz = () => {
    setContent("");
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setShowResults(false);
    setQuizId(null);
    setQuizTitle("");
    setQuestionCount(5);
    setTab("generate");
    setHintsCount({});
    setEliminatedOptions({});
    setShortScores([]);
    setShortFeedbacks([]);
    setExpectedAnswers([]);
    setIsGrading(false);
  };

  const backToMySets = () => {
    setShowResults(false);
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setTab("library");
    setHintsCount({});
    setEliminatedOptions({});
    setShortScores([]);
    setShortFeedbacks([]);
    setExpectedAnswers([]);
    setIsGrading(false);
  };

  
  const loadSavedQuizzes = async (silent = false) => {
    if (!silent) setLoadingQuizzes(true);
    try {
      const qRef = collection(db, "users", userId, "quizzes");
      const snap = await getDocs(query(qRef, orderBy("created_at", "desc"), limit(50)));
      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data.title,
          created_at: data.created_at || "",
          questionCount: data.questionCount || (data.questions?.length ?? 0),
          best_score: data.best_score || 0,
          best_total: data.best_total || (data.questions?.length ?? 0),
          originalCreator: data.originalCreator || data.createdBy,
          savedFrom: data.savedFrom,
        };
      });
      setSavedQuizzes(list);
      // Build bestScores map from quiz docs to avoid scanning attempts
      const map: Record<string, { best: number; total: number }> = {};
      list.forEach((q) => {
        map[q.id] = { best: q.best_score || 0, total: q.best_total || (q.questionCount || 0) };
      });
      setBestScores(map);
    } catch (error) {
      console.error("Failed to load saved quizzes:", error);
    } finally {
      if (!silent) setLoadingQuizzes(false);
    }
  };

  // Expose refresh method to parent component
  useImperativeHandle(ref, () => ({
    refreshQuizzes: () => loadSavedQuizzes(true)
  }));

  const loadQuiz = async (id: string) => {
    try {
      // Load quiz doc directly
      const dref = doc(db, "users", userId, "quizzes", id);
      const ds = await getDoc(dref);
      if (!ds.exists()) return;
      const data = ds.data() as any;
      setQuizId(id);
      setQuizTitle(data.title || "");
      setQuestions((data.questions || []) as Question[]);
      // Lock rendering mode to the saved quiz's mode (or infer from questions)
      try {
        const savedMode = (data.mode === 'short' ? 'short' : data.mode === 'mcq' ? 'mcq' : null) as ('mcq'|'short'|null);
        if (savedMode) {
          setQuizMode(savedMode);
        } else {
          const qs = (data.questions || []) as any[];
          const inferred = qs.some(q => q?.question_type === 'short_answer' || !q?.options) ? 'short' : 'mcq';
          setQuizMode(inferred as 'mcq'|'short');
        }
      } catch {}
      setAnswers({});
      setShowResults(false);
      setCurrentQuestionIndex(0);
      setSelectedQuizId(id);
      setHintsCount({});
      setEliminatedOptions({});
      setShortScores([]);
      setShortFeedbacks([]);
      setExpectedAnswers([]);
      setIsGrading(false);

      // Load attempts for this quiz with graceful fallback if composite index is missing
      const attemptsRef = collection(db, "users", userId, "quiz_attempts");
      try {
        const q = query(attemptsRef, where("quiz_id", "==", id), orderBy("created_at", "desc"));
        const aSnap = await getDocs(q);
        setAttempts(aSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any);
      } catch (e: any) {
        try {
          const q2 = query(attemptsRef, where("quiz_id", "==", id));
          const aSnap2 = await getDocs(q2);
          const arr = aSnap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
          // Sort client-side by created_at desc if present
          arr.sort((a: any, b: any) => {
            const at = a.created_at?.seconds ? a.created_at.seconds : 0;
            const bt = b.created_at?.seconds ? b.created_at.seconds : 0;
            return bt - at;
          });
          setAttempts(arr as any);
          
        } catch {}
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to load quiz", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (userId) loadSavedQuizzes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Allow other tools (e.g., Feed) to open a specific saved quiz by ID
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const quizIdFromEvent = e?.detail?.quizId as string;
        if (!quizIdFromEvent || !userId) return;
        loadQuiz(quizIdFromEvent).catch(() => {});
      } catch {}
    };
    window.addEventListener('study-open-quiz', handler as any);
    return () => window.removeEventListener('study-open-quiz', handler as any);
  }, [userId]);

  // Listen for cross-actions to create a quiz from other tools
  useEffect(() => {
    const onCross = (e: any) => {
      try {
        const detail = e?.detail || {};
        if (!detail || String(detail.type).toLowerCase() !== 'quiz') return;
        const incoming = detail.payload || {};
        let src = String(incoming.text || '').trim();
        if (!src && Array.isArray(incoming.cards)) {
          // Build content from cards
          src = (incoming.cards as Array<{front?:string;question?:string;back?:string;answer?:string}>)
            .map(c => `Q: ${String(c.front||c.question||'').trim()}\nA: ${String(c.back||c.answer||'').trim()}`)
            .join('\n\n');
        }
        if (!src) return;
        setTab('generate');
        setContent(src);
        const titleHint = String(incoming?.meta?.title || incoming?.title || '').trim();
        if (titleHint) setQuizTitle(titleHint.substring(0, 80));
        // Apply incoming options
        try {
          const qc = Number(incoming.questionCount);
          if ([5,10,15,20].includes(qc)) setQuestionCount(qc as any);
          if (incoming.quizMode === 'short' || incoming.quizMode === 'mcq') setQuizMode(incoming.quizMode);
          if (typeof incoming.includeEssay === 'boolean') setIncludeEssay(!!incoming.includeEssay);
        } catch {}
        crossMetaRef.current = { from: detail.source || 'unknown', scope: detail.scope || 'all' };
        setCrossOpen(true);
      } catch {}
    };
    window.addEventListener('study-cross-action' as any, onCross as any);
    return () => window.removeEventListener('study-cross-action' as any, onCross as any);
  }, []);

  // Listen for create-from events
  useEffect(() => {
    const handleCreateFrom = async (e: any) => {
      const detail = e.detail;
      if (!detail || !quizId) return;

      try {
        await dispatchFromQuiz(quizId, quizTitle, detail.type);
      } catch (error: any) {
        toast({ 
          title: 'Error', 
          description: error.message || 'Failed to create resource', 
          variant: 'destructive' 
        });
      }
    };

    window.addEventListener('study-create-from', handleCreateFrom);
    return () => window.removeEventListener('study-create-from', handleCreateFrom);
  }, [quizId, quizTitle]);

  // OPTIMIZED: Load usage and block inputs from context instead of separate Firestore reads
  // This eliminates 2 reads per component mount
  useEffect(() => {
    if (!userId) return;
    const plan = userData.plan || 'free';
    const wl = typeof userData.profile?.word_limit === 'number' 
      ? userData.profile.word_limit 
      : (plan === 'pro' ? 15000 : plan === 'advanced' ? 7000 : plan === 'basic' ? 5000 : 3000);
    setWordLimit(wl);
    const mq = typeof userData.profile?.monthly_quota === 'number' ? userData.profile.monthly_quota : 0;
    setMonthlyQuota(mq);
  }, [userId, userData.plan, userData.profile?.word_limit, userData.profile?.monthly_quota]);

  useEffect(() => {
    if (!userId) return;
    const uses = typeof userData.counters?.uses_this_month === 'number' ? userData.counters.uses_this_month : 0;
    const extra = typeof userData.counters?.extra_uses_balance === 'number' ? userData.counters.extra_uses_balance : 0;
    const quota = typeof monthlyQuota === 'number' ? monthlyQuota : 0;
    setUsesBlocked(quota > 0 ? (uses >= quota && extra <= 0) : false);
  }, [userId, monthlyQuota, userData.counters?.uses_this_month, userData.counters?.extra_uses_balance]);

  // Track session duration for Quiz
  useEffect(() => {
    if (!userId) return;
    startToolSession(userId, "quiz");
    return () => { endToolSession(userId, "quiz"); };
  }, [userId]);

  useNavGuard(unsavedChanges, (proceed, reset) => {
    pendingActionRef.current = proceed;
    pendingResetRef.current = reset;
    setLeaveOpen(true);
  });

  // Notify top-level Study tabs about unsaved changes
  useEffect(() => {
    const ev = new CustomEvent('study-unsaved-changes', { detail: { tool: 'quiz', value: unsavedChanges } });
    window.dispatchEvent(ev);
  }, [unsavedChanges]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const captureLinkClicks = (ev: Event) => {
      if (!unsavedChanges) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (anchor && anchor.href) {
        ev.preventDefault();
        pendingActionRef.current = () => { window.location.href = anchor.href; };
        setLeaveOpen(true);
      }
    };
    window.addEventListener("click", captureLinkClicks, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("click", captureLinkClicks, true);
    };
  }, [unsavedChanges]);

  if (questions.length > 0 && !showResults) {
    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

    return (
    <div className="max-w-7xl mx-auto relative px-3 md:px-0 overflow-x-hidden md:overflow-x-auto" aria-busy={loadingPreview}>
      <LoadingOverlay open={loadingPreview} title="Working…" subtitle="This may take up to a minute or two. Please don't refresh." progress={loadingPreview ? generationProgress : undefined} />
      
      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto pointer-events-auto">
            <div className="flex items-center justify-between mb-2 sticky top-0 z-[90] bg-background/95 backdrop-blur py-2 pointer-events-auto">
              <div>
                <h3 className="text-lg font-semibold">Recent Quizzes</h3>
                <p className="text-xs text-muted-foreground">{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTab('generate'); setManualQuizOpen(true); setAiQuizOpen(false); setSidebarOpen(false); }}
                  aria-label="New quiz"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div>
              {loadingQuizzes ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedQuizzes.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No quizzes yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedQuizzes.slice(0, 10).map((quiz) => (
                    <div key={quiz.id} className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedQuizId === quiz.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}>
                      <button
                        onClick={() => {
                          const run = () => { loadQuiz(quiz.id); setSidebarOpen(false); };
                          if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="font-medium text-sm truncate" title={quiz.title}>{quiz.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {quiz.questionCount} questions • Best: {(() => {
                            const b = (bestScores as any)[quiz.id];
                            const best = (b?.best ?? (quiz as any).best_score) as number | undefined;
                            const total = (b?.total ?? (quiz as any).best_total ?? quiz.questionCount) as number | undefined;
                            if (typeof best === 'number' && typeof total === 'number' && total > 0) {
                              return total === 100 ? Math.round(best) + '%' : Math.round((best / total) * 100) + '%';
                            }
                            return 'N/A';
                          })()}
                          {(quiz.savedFrom === "feed" || quiz.savedFrom === "challenge") && quiz.originalCreator && (
                            <span className="block text-xs text-muted-foreground mt-1">
                              saved from feed, made by @{quiz.originalCreator}
                            </span>
                          )}
                        </p>
                      </button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Mobile sidebar Rename clicked", quiz.id); 
                        openRename(quiz.id, quiz.title); 
                      }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Mobile sidebar Delete clicked", quiz.id); 
                        requestDeleteQuiz(quiz.id, quiz.title); 
                      }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

        <div className="flex gap-6 min-w-0">
        {/* Recent Quizzes Sidebar */}
        <div className="hidden md:block w-64 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Quizzes</CardTitle>
              <CardDescription>{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingQuizzes ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : savedQuizzes.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No quizzes yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedQuizzes.map((q) => (
                    <div
                      key={q.id}
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedQuizId === q.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        const run = () => { setTab('library'); loadQuiz(q.id); };
                        if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                      }}
                      role="button"
                    >
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={q.title}>{q.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {q.questionCount} questions
                          {(() => {
                            const b = (bestScores as any)[q.id];
                            const best = (b?.best ?? (q as any).best_score) as number | undefined;
                            const total = (b?.total ?? (q as any).best_total ?? q.questionCount) as number | undefined;
                            if (typeof best === 'number' && typeof total === 'number' && total > 0) {
                              return ' • Best: ' + (total === 100 ? Math.round(best) : Math.round((best / total) * 100)) + '%';
                            }
                            return '';
                          })()}
                          {(q.savedFrom === "feed" || q.savedFrom === "challenge") && q.originalCreator ? (
                            <span className="block">saved from feed, made by @{q.originalCreator}</span>
                          ) : null}
                        </p>
                      </div>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Desktop sidebar Rename clicked", q.id); 
                        openRename(q.id, q.title); 
                      }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Desktop sidebar Delete clicked", q.id); 
                        requestDeleteQuiz(q.id, q.title); 
                      }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cross-action confirm dialog */}
          <Dialog open={crossOpen} onOpenChange={setCrossOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a Quiz from incoming content?</DialogTitle>
              </DialogHeader>
              <div className="text-sm text-muted-foreground">This will generate a quiz from the provided source.</div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCrossOpen(false)}>Cancel</Button>
                <Button onClick={() => { setCrossOpen(false); try { generateQuiz(); } catch {} }}>Generate</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {selectedQuizId && attempts.length > 0 && (
            <Card className="p-4 mt-4">
              <h4 className="text-sm font-semibold mb-2">Previous Scores</h4>
              <div className="space-y-1 text-sm">
                {attempts.map((a) => {
                  const ts = (a as any).created_at;
                  const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
                  const isShort = !!(a as any).short_scores;
                  const pct = isShort
                    ? Math.round(Number(a.score || 0))
                    : Math.round(((Number(a.score || 0) / Math.max(1, Number(a.total_questions || 0))) * 100));
                  return (
                    <div key={a.id} className="flex justify-between">
                      <span>{d.toLocaleDateString()}</span>
                      <span>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-6">
          <div className="border-b border-border/50 px-6 py-4 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold">Question {currentQuestionIndex + 1} of {questions.length}</h1>
              <div className="flex gap-2">
                <Button variant="outline" disabled={isGrading} onClick={retakeQuiz}>Retake</Button>
                <Button
                  variant="outline"
                  disabled={isGrading}
                  onClick={() => {
                    if (unsavedChanges) {
                      pendingActionRef.current = resetQuiz;
                      pendingResetRef.current = () => {};
                      setLeaveOpen(true);
                    } else {
                      resetQuiz();
                    }
                  }}
                >
                  Exit
                </Button>
              </div>
            </div>
            <Progress 
              value={progress} 
              className="mt-4" 
              style={!isDark ? { backgroundColor: '#FEF8CA' } : undefined}
              indicatorStyle={isDark ? { backgroundColor: '#FEF8CA' } : undefined}
            />
          </div>

          <div className="w-full max-w-2xl mx-auto space-y-6">
            <Card className="p-8">
              <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {normalizeForMath(String(currentQuestion.question || ''))}
                </ReactMarkdown>
              </div>

              {!isShortAnswerQuestion(currentQuestion) && currentQuestion.options && (
                <div className="mb-4">
                  <span className="mr-2">Remove answer:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const used = hintsCount[currentQuestionIndex] || 0;
                      if (used >= 2) return;
                      const keys = Object.keys(currentQuestion.options || {});
                      const correct = currentQuestion.correct_answer;
                      const already = new Set((eliminatedOptions[currentQuestionIndex] || []));
                      const candidates = keys.filter((k) => k !== correct && !already.has(k));
                      if (candidates.length === 0) return;
                      const remove = candidates[Math.floor(Math.random() * candidates.length)];
                      setEliminatedOptions((prev) => ({
                        ...prev,
                        [currentQuestionIndex]: [ ...(prev[currentQuestionIndex] || []), remove ],
                      }));
                      setHintsCount((prev) => ({ ...prev, [currentQuestionIndex]: used + 1 }));
                    }}
                    disabled={isGrading || (hintsCount[currentQuestionIndex] || 0) >= 2}
                  >
                    💡 50/50 Help
                  </Button>
                  {(hintsCount[currentQuestionIndex] || 0) > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">We removed one incorrect option ({hintsCount[currentQuestionIndex]}/2).</p>
                  )}
                </div>
              )}
              
              {isShortAnswerQuestion(currentQuestion) && (
                <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    💡 <strong>Tip:</strong> Write your answer in your own words. The AI will evaluate your response for accuracy and understanding, not exact wording.
                  </p>
                </div>
              )}

              {!isShortAnswerQuestion(currentQuestion) && currentQuestion.options ? (
                <RadioGroup
                  value={answers[currentQuestionIndex] || ""}
                  onValueChange={(value) => setAnswers({ ...answers, [currentQuestionIndex]: value })}
                >
                  <div className="space-y-3">
                    {Object.entries(currentQuestion.options).map(([key, value]) => {
                      const eliminated = (eliminatedOptions[currentQuestionIndex] || []).includes(key);
                      const disabled = eliminated || isGrading;
                      return (
                        <label key={key} className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                          <input
                            type="radio"
                            className="hidden"
                            disabled={disabled}
                            checked={(answers[currentQuestionIndex] || "") === key}
                            onChange={() => setAnswers({ ...answers, [currentQuestionIndex]: key })}
                          />
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${((answers[currentQuestionIndex] || "") === key) ? 'border-primary' : 'border-muted-foreground/40'}`}>
                            <div className={`w-2 h-2 rounded-full ${((answers[currentQuestionIndex] || "") === key) ? 'bg-primary' : 'bg-transparent'}`} />
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="shrink-0">{key}.</span>
                            <span className="text-sm prose dark:prose-invert max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{ p: ({ children }) => <span>{children}</span> }}
                              >
                                {normalizeForMath(String(value || ''))}
                              </ReactMarkdown>
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </RadioGroup>
              ) : (
                (() => {
                  const isFillBlank = isShortAnswerQuestion(currentQuestion) && /_{3,}/.test(String(currentQuestion.question || ''));
                  if (isFillBlank) {
                    return (
                      <div className="space-y-2">
                        <Input
                          value={answers[currentQuestionIndex] || ""}
                          onChange={(e) => setAnswers({ ...answers, [currentQuestionIndex]: e.target.value })}
                          placeholder="Fill in the blank"
                          disabled={isGrading}
                        />
                        <p className="text-xs text-muted-foreground">Spelling tolerance: minor typos and case differences are accepted.</p>
                      </div>
                    );
                  }
                  return (
                    <Textarea
                      value={answers[currentQuestionIndex] || ""}
                      onChange={(e) => setAnswers({ ...answers, [currentQuestionIndex]: e.target.value })}
                      placeholder="Type your answer..."
                      disabled={isGrading}
                      className="min-h-[120px]"
                    />
                  );
                })()
              )}
            </Card>

            <div className="flex justify-between">
              <Button
                onClick={() => setCurrentQuestionIndex(currentQuestionIndex - 1)}
                disabled={isGrading || currentQuestionIndex === 0}
                variant="outline"
              >
                Previous
              </Button>
              {currentQuestionIndex === questions.length - 1 ? (
                <Button onClick={submitQuiz} disabled={isGrading}>
                  {isGrading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Grading...
                    </>
                  ) : (
                    'Submit Quiz'
                  )}
                </Button>
              ) : (
                <Button disabled={isGrading} onClick={() => setCurrentQuestionIndex(currentQuestionIndex + 1)}>Next</Button>
              )}
            </div>
          </div>
        </div>
        </div>
        {/* Leave Confirm Dialog (active branch) */}
        <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure you don't want to save?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <p>If you navigate away without saving, it will be lost.</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setLeaveOpen(false); pendingActionRef.current = null; const r = pendingResetRef.current; pendingResetRef.current = null; r && r(); }}>Stay</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setLeaveOpen(false);
                  setUnsavedChanges(false);
                  const fn = pendingActionRef.current; pendingActionRef.current = null; const r = pendingResetRef.current; pendingResetRef.current = null; r && r(); fn && fn();
                }}
              >
                Leave without saving
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog (active branch) */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Quiz</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Quiz title" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button onClick={saveRename}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm Dialog (active branch) */}
        <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open && !deleting) { setConfirmOpen(false); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Quiz?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <p>You can't undo this action.</p>
              <p className="text-sm text-muted-foreground truncate">{confirmTitle}</p>
              {confirmHasFeedPost && (
                <p className="text-sm text-destructive font-medium mt-2">⚠️ This will also delete the associated feed post.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { if (!deleting) setConfirmOpen(false); }}>No, keep it</Button>
              <Button
                variant="destructive"
                disabled={!confirmId || deleting}
                onClick={async () => {
                  if (!confirmId || deleting) return;
                  try {
                    setDeleting(true);
                    await deleteQuiz(confirmId);
                    setConfirmOpen(false);
                  } finally {
                    setDeleting(false);
                    setConfirmId(null);
                    setConfirmTitle("");
                  }
                }}
              >
                {deleting ? <><Loader2 className='w-4 h-4 mr-2 animate-spin' />Deleting...</> : 'Yes, delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Results Dialog for saved quizzes */
        /* Shows best attempt first and allows reviewing an attempt */}
        <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Results{resultsMeta?.title ? `, ${resultsMeta.title}` : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto text-sm">
              {attempts.length === 0 ? (
                <p className="text-muted-foreground">No attempts found.</p>
              ) : (
                (() => {
                  const list = [...attempts];
                  const pct = (a: any) => {
                    if (a?.short_scores) return (a.score || 0) / 100;
                    const tot = a?.total_questions || 0; return tot > 0 ? (a.score || 0) / tot : 0;
                  };
                  list.sort((x, y) => pct(y) - pct(x));
                  return list.map((a, idx) => {
                    const ts: any = (a as any).created_at;
                    const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
                    const label = (a as any).short_scores ? `${a.score}/100` : `${a.score}/${a.total_questions}`;
                    return (
                      <div
                        key={a.id}
                        className="flex items-center justify-between border rounded p-2 cursor-pointer hover:bg-muted/40"
                        onClick={() => reviewAttempt(resultsMeta?.id || '', (a as any).id)}
                        role="button"
                        tabIndex={0}
                      >
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {d.toLocaleString()}
                            {idx === 0 && (<span className="text-xs px-1.5 py-0.5 rounded bg-green-600/10 text-green-700 dark:text-green-400">Best</span>)}
                          </div>
                          <div className="text-muted-foreground">Score: {label}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" disabled={reviewingAttempt} onClick={() => reviewAttempt(resultsMeta?.id || '', (a as any).id)}>Review</Button>
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setResultsOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (showResults) {
    const score = questions.reduce((acc, q, i) => {
      if (quizMode === 'short') return acc; // computed separately
      if (!isCorrect(q, answers[i] || "")) return acc;
      const used = (hintsCount[i] || 0);
      if (used >= 2) return acc + 0.5;
      return acc + 1;
    }, 0);
    const keyId = quizId || selectedQuizId || '';
    const bestMeta = keyId ? (bestScores[keyId] as any) : undefined;
    return (
      <div className="max-w-7xl mx-auto">
        {/* Sidebar menu button - mobile only */}
        <div className="md:hidden flex items-center justify-between mb-4">
          <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-4 h-4 mr-2" />
            Menu
          </Button>
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <>
            <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto pointer-events-auto">
              <div className="flex items-center justify-between mb-2 sticky top-0 z-[90] bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-2 pointer-events-auto">
                <div>
                  <h3 className="text-lg font-semibold">Recent Quizzes</h3>
                  <p className="text-xs text-muted-foreground">{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</p>
                </div>
                <Button variant="ghost" size="icon" className="pointer-events-auto" onClick={() => setSidebarOpen(false)}>
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <div>
                {loadingQuizzes ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : savedQuizzes.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8 px-4">No Quizzes yet</p>
                ) : (
                  <div className="space-y-1">
                    {savedQuizzes.slice(0, 10).map((quiz) => (
                      <div
                        key={quiz.id}
                        className={`flex items-center gap-2 px-4 py-3 hover:bg-accent transition-colors ${
                          selectedQuizId === quiz.id ? 'bg-accent' : ''
                        }`}
                      >
                        <button
                          onClick={() => {
                            const run = () => {
                              loadQuiz(quiz.id);
                              setSidebarOpen(false);
                            };
                            if (unsavedChanges) {
                              pendingActionRef.current = run;
                              setLeaveOpen(true);
                            } else {
                              run();
                            }
                          }}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="font-medium text-sm truncate" title={quiz.title}>{quiz.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {quiz.questionCount} questions
                            {(quiz.savedFrom === "feed" || quiz.savedFrom === "challenge") && quiz.originalCreator && (
                              <span className="block text-xs text-muted-foreground mt-1">
                                saved from feed, made by @{quiz.originalCreator}
                              </span>
                            )}
                          </p>
                        </button>
                        <Button variant="ghost" size="sm" onClick={(e) => { 
                          e.stopPropagation(); 
                          console.log("Results page mobile sidebar Rename clicked", quiz.id); 
                          openRename(quiz.id, quiz.title); 
                        }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={(e) => { 
                          e.stopPropagation(); 
                          console.log("Results page mobile sidebar Duplicate clicked", quiz.id); 
                          duplicateAsOtherMode(quiz.id); 
                        }}>
                          Duplicate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={(e) => { 
                          e.stopPropagation(); 
                          console.log("Results page mobile sidebar Delete clicked", quiz.id); 
                          requestDeleteQuiz(quiz.id, quiz.title); 
                        }}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex gap-6">
        <div className="hidden md:block w-64 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Quizzes</CardTitle>
              <CardDescription>{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingQuizzes ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedQuizzes.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No quizzes yet</p>
              ) : (
                <div className="space-y-1">
                  {savedQuizzes.slice(0, 10).map((qz) => (
                    <div
                      key={qz.id}
                      className={`flex items-center gap-2 px-4 py-3 hover:bg-accent transition-colors ${selectedQuizId===qz.id?'bg-accent':''}`}
                    >
                      <button onClick={() => loadQuiz(qz.id)} className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="font-medium text-sm truncate" title={qz.title}>{qz.title}</p>
                        </div>
                      </button>
                      <Button variant="ghost" size="sm" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Results page desktop sidebar Rename clicked", qz.id); 
                        openRename(qz.id, qz.title); 
                      }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Results page desktop sidebar Delete clicked", qz.id); 
                        requestDeleteQuiz(qz.id, qz.title); 
                      }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {selectedQuizId && attempts.length > 0 && (
            <Card className="p-4 mt-4">
              <h4 className="text-sm font-semibold mb-2">Previous Scores</h4>
              <div className="space-y-1 text-sm">
                {attempts.map((a) => {
                  const ts = (a as any).created_at;
                  const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
                  return (
                    <div key={a.id} className="flex justify-between">
                      <span>{d.toLocaleDateString()}</span>
                      <span>{(a as any).short_scores ? `${a.score}/100` : `${a.score}/${a.total_questions}`}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-6 overflow-x-hidden">
          <div className="border-b border-border/50 px-3 sm:px-6 py-4 rounded-lg bg-muted/30">
            <h1 className="text-lg sm:text-xl font-semibold mb-3">Quiz Results</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={retakeQuiz}>Retake</Button>
              <Button variant="outline" size="sm" onClick={newQuiz}>New Quiz</Button>
              <Button variant="outline" size="sm" onClick={backToMySets}>My Quizzes</Button>
            </div>
          </div>
          <div className="max-w-2xl mx-auto space-y-6">
            <Card className="p-8 text-center">
              <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
              {(quizMode === 'short' || shortScores.length > 0) ? (
                <>
                  <h2 className="text-3xl font-bold mb-1">
                    {shortScores.length > 0 
                      ? Math.round(shortScores.reduce((a, b) => a + b, 0) / shortScores.length)
                      : 0}%
                  </h2>
                  {bestMeta && (
                    <p className="text-sm text-muted-foreground mb-1">Best: {bestMeta.best}%</p>
                  )}
                  <p className="text-muted-foreground mb-6">Average Score</p>
                </>
              ) : (
                <>
                  <h2 className="text-3xl font-bold mb-1">{Number(score.toFixed(2))} / {questions.length}</h2>
                  {bestMeta && (
                    <p className="text-sm text-muted-foreground mb-1">Best: {bestMeta.best}/{bestMeta.total || questions.length}</p>
                  )}
                  <p className="text-muted-foreground mb-6">{((score / questions.length) * 100).toFixed(0)}% Correct</p>
                </>
              )}
              <div className="flex gap-2 justify-center flex-wrap">
                <Button onClick={retakeQuiz}>Retake This Quiz</Button>
                
              </div>
            </Card>
            <div className="space-y-4">
              <h3 className="font-semibold">Review Answers</h3>
              {questions.map((question, index) => {
                // For short answer quizzes, use AI score to determine correct/incorrect (score >= 60 is passing)
                const isShortMode = isShortAnswerQuestion(question);
                const shortScore = shortScores[index] ?? 0;
                const isAnswerCorrect = isShortMode ? shortScore >= 60 : isCorrect(question, answers[index] || "");
                
                return (
                <Card key={question.id} className={`p-6 ${isAnswerCorrect ? "border-green-500/50" : "border-red-500/50"}`}>
                  <div className="space-y-3">
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {normalizeForMath(`${index + 1}. ${String(question.question || '')}`)}
                      </ReactMarkdown>
                    </div>
                    <div className="text-sm">
                      <p>
                        <span className="text-muted-foreground">Your answer: </span>
                        <span className={isAnswerCorrect ? "text-green-500" : "text-red-500"}>
                          {isShortMode
                            ? (answers[index] || "Not answered")
                            : (question.options
                                ? (question.options[answers[index] || ""] || (answers[index] || "Not answered"))
                                : (answers[index] || "Not answered"))}
                        </span>
                      </p>
                      {(quizMode === 'short' || shortScores.length > 0) ? (
                        <div className="space-y-3">
                          <p className="text-sm"><span className="text-muted-foreground">Score:</span> <span className="font-medium">{shortScores[index] ?? '-'}/100</span></p>
                          {shortFeedbacks[index] && (
                            <div className="p-3 rounded-lg bg-muted">
                              <p className="text-sm whitespace-pre-wrap">{shortFeedbacks[index]}</p>
                            </div>
                          )}
                          {expectedAnswers[index] && (
                            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                              <p className="text-sm">
                                <span className="font-medium text-green-800 dark:text-green-300">{getReferenceAnswer(question) ? 'Grading reference answer:' : 'Expected answer example:'}</span>
                                <br />
                                <span className="text-green-700 dark:text-green-400">{expectedAnswers[index]}</span>
                              </p>
                              <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                                Note: Your answer doesn't need to match exactly. The AI evaluates for accuracy and understanding.
                              </p>
                            </div>
                          )}
                          {isShortMode && <Button variant="outline" size="sm" disabled={isGrading} onClick={() => redoShortQuestion(index)}>Regrade this answer</Button>}
                        </div>
                      ) : (
                        <>
                          {!isCorrect(question, answers[index] || "") && (
                            <p>
                              <span className="text-muted-foreground">Correct answer: </span>
                              <span className="text-green-500 prose dark:prose-invert max-w-none">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                  components={{ p: ({ children }) => <span>{children}</span> }}
                                >
                                  {normalizeForMath(String(question.options ? (question.options[question.correct_answer] || question.correct_answer) : question.correct_answer))}
                                </ReactMarkdown>
                              </span>
                            </p>
                          )}
                          {question.explanation && (
                            <div className="text-muted-foreground mt-2 prose dark:prose-invert max-w-none">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                              >
                                {normalizeForMath(String(question.explanation || ''))}
                              </ReactMarkdown>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              );
              })}
            </div>
          </div>
        </div>
        </div>
        <CrossCreatePicker
          userId={userId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialTab="flashcards"
          allowedTabs={["chat","summary","flashcards","quizzes","plans"]}
        />
      </div>
    );
  }

  // Default generator UI with sidebar
  return (
    <div className="max-w-7xl mx-auto relative" aria-busy={isBusy}>
      <LoadingOverlay open={isBusy} title="Working…" subtitle="This may take up to a minute or two. Please don't refresh." progress={isBusy ? generationProgress : undefined} />
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)}>
          <Menu className="w-4 h-4 mr-2" />
          Menu
        </Button>
      </div>

      {/* Mobile sidebar drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto pointer-events-auto">
            <div className="flex items-center justify-between mb-2 sticky top-0 z-[90] bg-background/95 backdrop-blur py-2 pointer-events-auto">
              <div>
                <h3 className="text-lg font-semibold">Recent Quizzes</h3>
                <p className="text-xs text-muted-foreground">{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTab('generate'); setManualQuizOpen(true); setAiQuizOpen(false); setSidebarOpen(false); }}
                  aria-label="New quiz"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div>
              {loadingQuizzes ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedQuizzes.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No Quizzes yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedQuizzes.slice(0, 10).map((quiz) => (
                    <div key={quiz.id} className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedQuizId === quiz.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}>
                      <button
                        onClick={() => {
                          const run = () => {
                            loadQuiz(quiz.id);
                            setSidebarOpen(false);
                          };
                          if (unsavedChanges) {
                            pendingActionRef.current = run;
                            setLeaveOpen(true);
                          } else {
                            run();
                          }
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="font-medium text-sm truncate" title={quiz.title}>{quiz.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {quiz.questionCount} questions
                          {(quiz.savedFrom === "feed" || quiz.savedFrom === "challenge") && quiz.originalCreator && (
                            <span className="block text-xs text-muted-foreground mt-1">
                              saved from feed, made by @{quiz.originalCreator}
                            </span>
                          )}
                        </p>
                      </button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Results view mobile sidebar Rename clicked", quiz.id); 
                        openRename(quiz.id, quiz.title); 
                      }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { 
                        e.stopPropagation(); 
                        console.log("Results view mobile sidebar Delete clicked", quiz.id); 
                        requestDeleteQuiz(quiz.id, quiz.title); 
                      }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-6 min-w-0">
      <div className="hidden md:block w-64 flex-shrink-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Quizzes</CardTitle>
            <CardDescription>{savedQuizzes.length} quiz{savedQuizzes.length === 1 ? '' : 'zes'}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loadingQuizzes ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : savedQuizzes.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-8 px-4">No quizzes yet</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {savedQuizzes.map((q) => (
                  <div
                    key={q.id}
                    className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedQuizId === q.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                    onClick={() => {
                      const run = () => { setTab('library'); loadQuiz(q.id); };
                      if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                    }}
                    role="button"
                  >
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-medium text-sm truncate" title={q.title}>{q.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {q.questionCount} questions
                      </p>
                    </div>
                    <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { 
                      e.stopPropagation(); 
                      console.log("Main view desktop sidebar Rename clicked", q.id); 
                      openRename(q.id, q.title); 
                    }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { 
                      e.stopPropagation(); 
                      console.log("Main view desktop sidebar Delete clicked", q.id); 
                      requestDeleteQuiz(q.id, q.title); 
                    }}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {selectedQuizId && attempts.length > 0 && (
          <Card className="p-4 mt-4">
            <h4 className="text-sm font-semibold mb-2">Previous Scores</h4>
            <div className="space-y-1 text-sm">
              {attempts.map((a) => {
                const ts = (a as any).created_at;
                const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
                return (
                  <div key={a.id} className="flex justify-between">
                    <span>{d.toLocaleDateString()}</span>
                    <span>{(a as any).short_scores ? `${a.score}/100` : `${a.score}/${a.total_questions}`}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            if (v === 'generate') {
              setSelectedQuizId(null);
              setQuizId(null);
              setQuestions([]);
              setAnswers({});
              setShowResults(false);
              setUnsavedChanges(false);
              setManualQuizOpen(true);
              setAiQuizOpen(false);
            }
          }}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2" data-tour="quiz-tabs">
            <TabsTrigger value="generate">
              <Plus className="w-4 h-4 mr-2" />
              Create
            </TabsTrigger>
            <TabsTrigger value="library" data-tour="quiz-saved-tab">
              <BookOpen className="w-4 h-4 mr-2" />
              My Quizzes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-6 mt-6">
            <Card data-tour="quiz-manual" className="border-primary/40 bg-primary/5 shadow-sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2"><Pencil className="h-5 w-5" /> Create your own quiz</span>
                  <Button variant={manualQuizOpen ? "outline" : "default"} size="sm" onClick={() => setManualQuizOpen(prev => { const next = !prev; setAiQuizOpen(!next); return next; })}>{manualQuizOpen ? 'Hide builder' : 'Create manually'}</Button>
                </CardTitle>
                <CardDescription>Write your questions, choose the answers, and make it yours. Short responses are graded by AI against your sample answers.</CardDescription>
              </CardHeader>
              {manualQuizOpen && (
                <CardContent className="space-y-4">
                  <fieldset disabled={savingManualQuiz} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="manual-title" className="text-sm font-medium">Quiz Title</Label>
                      <Input id="manual-title" maxLength={500} value={quizTitle} onChange={(e)=>setQuizTitle(e.target.value)} placeholder="e.g., Custom Practice Quiz" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Questions</Label>
                      <div className="text-xs text-muted-foreground">Add multiple-choice and/or short answer questions</div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {manualQuestions.map((q, idx) => (
                      <Card key={q.id} className="p-4">
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Question {idx+1}</Label>
                            <Input maxLength={12000} value={q.question} onChange={(e)=>{
                              const v=[...manualQuestions]; v[idx] = { ...v[idx], question: e.target.value }; setManualQuestions(v);
                            }} placeholder="Type the question" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">Type</Label>
                            <Select disabled={savingManualQuiz} value={q.type} onValueChange={(val)=>{ const v=[...manualQuestions]; v[idx] = { ...v[idx], type: val as ManualQuestion['type'], pendingReview: false }; setManualQuestions(v); }}>
                              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                                <SelectItem value="short_answer">Short Answer</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {q.type === 'multiple_choice' ? (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {(['A','B','C','D'] as const).map((k) => (
                                  <div key={k}>
                                    <Label className="text-xs">Option {k}</Label>
                                    <Input value={q[k]} onChange={(e)=>{ const v=[...manualQuestions]; (v[idx] as any)[k] = e.target.value; setManualQuestions(v); }} placeholder={`Answer ${k}`} />
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Correct</Label>
                                <Select disabled={savingManualQuiz} value={q.correct} onValueChange={(val)=>{ const v=[...manualQuestions]; v[idx] = { ...v[idx], correct: val as any }; setManualQuestions(v); }}>
                                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="A">A</SelectItem>
                                    <SelectItem value="B">B</SelectItem>
                                    <SelectItem value="C">C</SelectItem>
                                    <SelectItem value="D">D</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          ) : (
                            <ReferenceAnswerEditor
                              question={q.question}
                              title={quizTitle}
                              value={q.shortAnswer}
                              disabled={savingManualQuiz}
                              onChange={shortAnswer => setManualQuestions(prev => prev.map(item => item.id === q.id ? { ...item, shortAnswer } : item))}
                              onReviewChange={pendingReview => setManualQuestions(prev => {
                                if (!prev.some(item => item.id === q.id && item.pendingReview !== pendingReview)) return prev;
                                return prev.map(item => item.id === q.id ? { ...item, pendingReview } : item);
                              })}
                            />
                          )}
                          {manualQuestions.length > 1 && (
                            <Button variant="ghost" size="sm" onClick={()=>{ setManualQuestions(prev => prev.filter((_,i)=>i!==idx)); }}>Remove</Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={()=> setManualQuestions(prev => [...prev, newManualQuestion()])}>Add Question</Button>
                    <Button size="sm" disabled={savingManualQuiz || manualQuestions.some(q => q.type === 'short_answer' && q.pendingReview)} onClick={async ()=>{
                      if (savingManualQuiz || manualQuestions.some(q => q.type === 'short_answer' && q.pendingReview)) return;
                      const prepared = manualQuestions.map(m => ({
                        ...m,
                        options: [m.A, m.B, m.C, m.D].filter(s=>s && s.trim()),
                        short: (m.shortAnswer || '').trim()
                      }));
                      const valid = prepared.filter(m => m.question.trim() && (
                        (m.type === 'multiple_choice' && m.options.length >= 2 && m[m.correct].trim()) ||
                        (m.type === 'short_answer' && m.short.length > 0)
                      ));
                      if (!quizTitle.trim()) { toast({ title:'Title required', variant:'destructive' }); return; }
                      if (valid.length !== prepared.length) { toast({ title:'Complete every question', description: 'Each short-answer question needs a sample answer. Multiple-choice questions need at least two options and a selected correct answer. Complete or remove unfinished questions.', variant:'destructive' }); return; }
                      setSavingManualQuiz(true);
                      try {
                        const id = Math.random().toString(36).slice(2);
                        const qs = valid.map((m, i) => {
                          if (m.type === 'short_answer') {
                            return { id: `${id}-${i}`, question: m.question.trim(), question_type: 'short_answer', correct_answer: m.short, reference_answer: m.short };
                          }
                          const letters = ['A','B','C','D'];
                          const optObj: { [k:string]: string } = {};
                          letters.forEach((L) => { const val = (m as any)[L]; if (val && val.trim()) optObj[L] = val; });
                          const corr = (m.correct in optObj) ? m.correct : (Object.keys(optObj)[0] as any);
                          return { id: `${id}-${i}`, question: m.question.trim(), question_type: 'multiple_choice', options: optObj, correct_answer: corr } as any;
                        });
                        const hasMC = qs.some(q => q.question_type === 'multiple_choice');
                        const hasShort = qs.some(q => q.question_type === 'short_answer');
                        const mode = hasMC && hasShort ? 'mixed' : (hasShort ? 'short' : 'mcq');
                        await setDoc(doc(db, 'users', userId, 'quizzes', id), {
                          id,
                          title: quizTitle.trim(),
                          created_at: serverTimestamp(),
                          questionCount: qs.length,
                          questions: qs,
                          mode,
                        });
                        setSavedQuizzes(prev => [{ id, title: quizTitle.trim(), created_at: new Date().toISOString(), questionCount: qs.length }, ...prev]);
                        // Start quiz immediately
                        setSelectedQuizId(id);
                        setQuizId(id);
                        setQuestions(qs as any);
                        setQuizMode(hasShort && !hasMC ? 'short' : 'mcq');
                        setAnswers({});
                        setShortScores([]);
                        setShortFeedbacks([]);
                        setExpectedAnswers([]);
                        setHintsCount({});
                        setEliminatedOptions({});
                        setShowResults(false);
                        setCurrentQuestionIndex(0);
                        setTab('library');
                        toast({ title:'Quiz Ready', description:'Starting your custom quiz' });
                      } catch (e:any) {
                        toast({ title:'Save failed', description:e?.message || 'Could not save quiz', variant:'destructive' });
                      } finally {
                        setSavingManualQuiz(false);
                      }
                    }}>{savingManualQuiz ? 'Saving...' : 'Save & Start'}</Button>
                  </div>
                  {manualQuestions.some(q => q.type === 'short_answer' && q.pendingReview) && (
                    <p className="text-sm text-muted-foreground" role="status">Accept or discard each AI draft before saving your quiz.</p>
                  )}
                  </fieldset>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5" />
                    AI Quiz Generator
                  </span>
                  <Button variant="outline" size="sm" onClick={() => { setAiQuizOpen(prev => { const next = !prev; if (next) setManualQuizOpen(false); return next; }); }}>{aiQuizOpen ? 'Hide' : 'Open'}</Button>
                </CardTitle>
                <CardDescription>Paste your study material and we will generate quiz questions for you</CardDescription>
              </CardHeader>
              {aiQuizOpen && (
              <CardContent className="space-y-4">
                {!gate.loading && !canUseQuiz && (
                  <div className="p-3 border border-yellow-300 bg-yellow-50 text-yellow-800 rounded flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Upgrade required</div>
                      <div className="text-sm opacity-90">Quiz Generator is available on Basic and higher plans.</div>
                    </div>
                    <Badge variant="secondary" className="uppercase bg-yellow-200 text-yellow-900">Limited</Badge>
                  </div>
                )}
                {usesBlocked && (
                  <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive rounded flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Monthly limits used</div>
                      <div className="text-sm opacity-90">
                        You've reached your monthly generation limit. Upgrade or purchase additional credits to continue.
                      </div>
                    </div>
                    <Badge variant="destructive" className="uppercase">Blocked</Badge>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label className="mb-1 block">Mode</Label>
                    <Select value={quizMode} onValueChange={(v) => { setManualQuizOpen(false); setAiQuizOpen(true); setQuizMode(v as 'mcq'|'short'); }} disabled={(!!selectedQuizId && tab !== 'generate') || !canUseQuiz}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mcq">Multiple Choice</SelectItem>
                        <SelectItem value="short">Short Answer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Fill-in-the-blank Questions</Label>
                      <Select value={fillMode} onValueChange={(v)=> { setManualQuizOpen(false); setAiQuizOpen(true); setFillMode(v as any); }}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select fill-in-the-blank percentage" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (0%)</SelectItem>
                          <SelectItem value="25">25% fill-in-the-blank</SelectItem>
                          <SelectItem value="50">50% fill-in-the-blank</SelectItem>
                          <SelectItem value="75">75% fill-in-the-blank</SelectItem>
                          <SelectItem value="only">Only fill-in-the-blank (100%)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Works with both Multiple Choice and Short Answer modes
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="quiz-title" className="text-sm font-medium">Quiz Title</Label>
                    <Input id="quiz-title" value={quizTitle} onFocus={()=> { setManualQuizOpen(false); setAiQuizOpen(true); }} onChange={(e) => setQuizTitle(e.target.value)} placeholder="e.g., Biology Chapter 5 Quiz" disabled={isGenerating || usesBlocked} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="question-count" className="text-sm font-medium">Number of Questions</Label>
                    <Select value={questionCount.toString()} onValueChange={(v) => setQuestionCount(parseInt(v))} disabled={isGenerating || usesBlocked}>
                      <SelectTrigger id="question-count"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3 Questions</SelectItem>
                        <SelectItem value="5">5 Questions</SelectItem>
                        <SelectItem value="10">10 Questions</SelectItem>
                        <SelectItem value="15">15 Questions</SelectItem>
                        <SelectItem value="20">20 Questions</SelectItem>
                        <SelectItem value="25">25 Questions</SelectItem>
                        <SelectItem value="30">30 Questions</SelectItem>
                        <SelectItem value="40">40 Questions</SelectItem>
                        <SelectItem value="50">50 Questions</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                  <div>
                    <Label htmlFor="content" className="text-sm font-medium mb-2 block">Content</Label>
                    <div className="relative">
                      <Textarea id="content" value={content} data-tour="quiz-input" onFocus={()=> { setManualQuizOpen(false); setAiQuizOpen(true); }} onChange={(e) => {
                        const prev = content;
                        const raw = e.target.value;
                        // Sanitize tokens > 50 by trimming them
                        const sanitized = raw
                          .split(/\s+/)
                          .map(t => t.length > 50 ? t.slice(0, 50) : t)
                          .join(' ');
                        const words = sanitized.trim().length ? sanitized.trim().split(/\s+/) : [] as string[];
                        // Allow deletions always
                        if (sanitized.length <= prev.length) { setContent(sanitized); return; }
                        // Truncate to wordLimit instead of blocking typing/paste
                        if (words.length > wordLimit) {
                          setContent(words.slice(0, wordLimit).join(' '));
                          return;
                        }
                        setContent(sanitized);
                      }} placeholder="Paste your notes, article, or any text content here..." className="min-h-[250px] pr-16" disabled={isGenerating || usesBlocked || importingFile} />
                      <div className="pointer-events-none absolute bottom-1.5 right-2 text-[11px] text-muted-foreground bg-background/70 px-1 rounded">
                        {Math.min(content.trim().split(/\s+/).filter(Boolean).length, wordLimit)} / {wordLimit}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Input
                        type="file"
                        accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                        onFocus={()=> { setManualQuizOpen(false); setAiQuizOpen(true); }}
                        onChange={async (e) => {
                          const inputEl = e.currentTarget;
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setImportingFile(true);
                          try {
                            const extracted = await extractTextFromFile(f);
                            const val = (extracted || "");
                            const words = val.trim().split(/\s+/).filter(Boolean);
                            setContent(words.slice(0, wordLimit).join(' '));
                            toast({ title: "Imported", description: `Loaded ${f.name}` });
                          } catch (err: any) {
                            toast({ title: "Error", description: err?.message || "Failed to read file", variant: "destructive" });
                          } finally {
                            setImportingFile(false);
                            inputEl.value = "";
                          }
                        }}
                        disabled={isGenerating || usesBlocked || importingFile}
                      />
                      {importingFile && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading file…
                        </span>
                      )}
                    </div>
                    {/* Create from… button below file chooser */}
                    <div className="mt-3">
                      <Button variant="outline" onClick={() => { setManualQuizOpen(false); setAiQuizOpen(true); setPickerOpen(true); }}>
                        Create from…
                      </Button>
                    </div>
                  </div>
                <div className="relative">
                  <UsageAnimation show={showUsageAnim} />
                  <Button type="button" onClick={() => { try { localStorage.setItem('quiz_draft', JSON.stringify({ quizTitle, content, quizMode, fillMode })); } catch {}; setManualQuizOpen(false); setAiQuizOpen(true); generateQuiz(); }} disabled={isGenerating || importingFile || !content.trim() || !quizTitle.trim() || usesBlocked || !canUseQuiz} className="w-full" data-tour="quiz-generate">
                    {isGenerating ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating Quiz...</>
                    ) : usesBlocked ? (
                      <><X className="h-4 w-4 mr-2" />Monthly limit reached</>
                    ) : (!canUseQuiz && !gate.loading) ? (
                      <><X className="h-4 w-4 mr-2" />Upgrade to use</>
                    ) : (
                      <><Play className="h-4 w-4 mr-2" />Generate Quiz</>
                    )}
                  </Button>
                </div>
              </CardContent>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="library" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Your Quizzes</span>
                  {!selectionMode ? (
                    <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                      <CheckSquare className="w-4 h-4 mr-2" />
                      Select Multiple
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        if (selectedQuizzes.size === savedQuizzes.length) {
                          setSelectedQuizzes(new Set());
                        } else {
                          setSelectedQuizzes(new Set(savedQuizzes.map(q => q.id)));
                        }
                      }}>
                        {selectedQuizzes.size === savedQuizzes.length ? 'Deselect All' : 'Select All'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setSelectionMode(false);
                        setSelectedQuizzes(new Set());
                      }}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </CardTitle>
                <CardDescription>
                  {savedQuizzes.length} saved quiz{savedQuizzes.length === 1 ? '' : 'zes'}
                  {selectionMode && selectedQuizzes.size > 0 && ` • ${selectedQuizzes.size} selected`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {savedQuizzes.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No quizzes saved yet.</p>
                ) : (
                  <div className="space-y-3">
                    {savedQuizzes.map((qz) => (
                      <div
                        key={qz.id}
                        className="group p-3 border rounded-lg bg-background transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm ring-1 ring-transparent hover:ring-2 hover:ring-primary/40 cursor-pointer"
                        onClick={() => {
                          if (selectionMode) {
                            toggleQuizSelection(qz.id);
                          } else {
                            const run = () => { setTab("library"); loadQuiz(qz.id); };
                            if (unsavedChanges) {
                              pendingActionRef.current = run;
                              setLeaveOpen(true);
                            } else {
                              run();
                            }
                          }
                        }}
                        role="button"
                      >
                        <div className="flex gap-3">
                          {selectionMode && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleQuizSelection(qz.id);
                              }}
                            >
                              {selectedQuizzes.has(qz.id) ? (
                                <CheckSquare className="w-5 h-5 text-primary" />
                              ) : (
                                <Square className="w-5 h-5" />
                              )}
                            </Button>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium break-words" title={qz.title}>{qz.title.length > 30 ? qz.title.slice(0, 30) + '...' : qz.title}</div>
                                <Badge variant="outline" className="capitalize mt-1 inline-block">quiz</Badge>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {qz.questionCount} questions
                                  {bestScores[qz.id] && (
                                    <span> • Best: {bestScores[qz.id].best}/{bestScores[qz.id].total}</span>
                                  )}
                                  {(qz.savedFrom === "feed" || qz.savedFrom === "challenge") && qz.originalCreator && (
                                    <span className="block mt-1">saved from feed, made by @{qz.originalCreator}</span>
                                  )}
                                </div>
                              </div>
                              {!selectionMode && (
                                <div className="flex flex-col sm:flex-row items-center gap-1 flex-shrink-0">
                                  <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={(e) => {
                                    e.stopPropagation();
                                    const run = () => { setTab("library"); loadQuiz(qz.id); };
                                    if (unsavedChanges) {
                                      pendingActionRef.current = run;
                                      setLeaveOpen(true);
                                    } else {
                                      run();
                                    }
                                  }}>
                                    <Eye className="w-4 h-4 mr-1" /> Redo
                                  </Button>
                                  <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={async (e) => { 
                                    e.stopPropagation(); 
                                    try {
                                      // Load attempts and open best one directly
                                      const attemptsRef = collection(db, 'users', userId, 'quiz_attempts');
                                      let docs: any[] = [];
                                      try {
                                        const q1 = query(attemptsRef, where('quiz_id', '==', qz.id), orderBy('created_at', 'desc'), limit(50));
                                        const s1 = await getDocs(q1);
                                        docs = s1.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
                                      } catch {
                                        const q2 = query(attemptsRef, where('quiz_id', '==', qz.id), limit(50));
                                        const s2 = await getDocs(q2);
                                        docs = s2.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
                                      }
                                      if (!docs.length) { toast({ title: 'No attempts', description: 'There are no attempts for this quiz yet.' }); return; }
                                      const pct = (a: any) => a?.short_scores ? ((a.score||0)/100) : ((a.total_questions>0)?((a.score||0)/a.total_questions):0);
                                      docs.sort((a,b)=> pct(b)-pct(a));
                                      await reviewAttempt(qz.id, docs[0].id);
                                    } catch (err:any) {
                                      toast({ title:'Error', description: err?.message || 'Could not open result', variant:'destructive' });
                                    }
                                  }}>
                                    <FileText className="w-4 h-4 mr-1" /> Result
                                  </Button>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { 
                                    e.stopPropagation(); 
                                    console.log("My Quizzes Delete button clicked", { id: qz.id, title: qz.title }); 
                                    requestDeleteQuiz(qz.id, qz.title); 
                                  }} aria-label="Delete">
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Floating Action Bar for bulk delete */}
            {selectionMode && selectedQuizzes.size > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
                <Card className="shadow-lg border-2">
                  <CardContent className="p-4 flex items-center gap-4">
                    <span className="font-medium">{selectedQuizzes.size} quiz{selectedQuizzes.size === 1 ? '' : 'zes'} selected</span>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setConfirmId("bulk");
                        setConfirmTitle(`${selectedQuizzes.size} quiz${selectedQuizzes.size === 1 ? '' : 'zes'}`);
                        setConfirmOpen(true);
                      }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete All
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <CrossCreatePicker
          userId={userId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialTab="flashcards"
          allowedTabs={["chat","summary","essay","flashcards","quizzes","plans"]}
        />
        {/* Global dialogs (available in generate/library views) */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Quiz</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Quiz title" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button onClick={saveRename}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open && !deleting) { setConfirmOpen(false); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmId === "bulk" ? "Delete Multiple Quizzes?" : "Delete Quiz?"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <p>You can't undo this action.</p>
              <p className="text-sm text-muted-foreground truncate">{confirmTitle}</p>
              {confirmHasFeedPost && confirmId !== "bulk" && (
                <p className="text-sm text-destructive font-medium mt-2">⚠️ This will also delete the associated feed post.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { if (!deleting) setConfirmOpen(false); }}>No, keep {confirmId === "bulk" ? "them" : "it"}</Button>
              <Button
                variant="destructive"
                disabled={!confirmId || deleting}
                onClick={async () => {
                  if (!confirmId || deleting) return;
                  try {
                    setDeleting(true);
                    if (confirmId === "bulk") {
                      await bulkDeleteQuizzes();
                    } else {
                      await deleteQuiz(confirmId);
                      setConfirmOpen(false);
                    }
                  } finally {
                    setDeleting(false);
                    if (confirmId !== "bulk") {
                      setConfirmId(null);
                      setConfirmTitle("");
                    }
                  }
                }}
              >
                {deleting ? <><Loader2 className='w-4 h-4 mr-2 animate-spin' />Deleting...</> : 'Yes, delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Global Results Dialog for saved quizzes (generate/library views) */}
        <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Results{resultsMeta?.title ? `, ${resultsMeta.title}` : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto text-sm">
              {attempts.length === 0 ? (
                <p className="text-muted-foreground">No attempts found.</p>
              ) : (
                (() => {
                  const list = [...attempts];
                  const pct = (a: any) => {
                    if (a?.short_scores) return (a.score || 0) / 100;
                    const tot = a?.total_questions || 0; return tot > 0 ? (a.score || 0) / tot : 0;
                  };
                  list.sort((x, y) => pct(y) - pct(x));
                  return list.map((a, idx) => {
                    const ts: any = (a as any).created_at;
                    const d = ts?.seconds ? new Date(ts.seconds * 1000) : new Date();
                    const label = (a as any).short_scores ? `${a.score}/100` : `${a.score}/${a.total_questions}`;
                    return (
                      <div
                        key={a.id}
                        className="flex items-center justify-between border rounded p-2 cursor-pointer hover:bg-muted/40"
                        onClick={() => reviewAttempt(resultsMeta?.id || '', (a as any).id)}
                        role="button"
                        tabIndex={0}
                      >
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {d.toLocaleString()}
                            {idx === 0 && (<span className="text-xs px-1.5 py-0.5 rounded bg-green-600/10 text-green-700 dark:text-green-400">Best</span>)}
                          </div>
                          <div className="text-muted-foreground">Score: {label}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" disabled={reviewingAttempt} onClick={(e) => { e.stopPropagation(); reviewAttempt(resultsMeta?.id || '', (a as any).id); }}>Review</Button>
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setResultsOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>

        
    </div>
  );
});
