import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { db } from "../../../firebase";
import { getAuthHeaders } from "@/lib/api-utils";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc, writeBatch, query, orderBy, limit } from "firebase/firestore";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { useUserData } from "@/contexts/UserDataContext";
import { Loader2, Trash2, Menu, X, Eye, Pencil, BookOpen, Target, FileText, Wand2, Copy, ArrowLeft, Layers, Play, Clock, Brain, Zap, GraduationCap, Book, Users, Lightbulb, Rocket, Plus, Check, Square, CheckSquare, FileUp } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import LoadingOverlay from "@/components/LoadingOverlay";
import { Switch } from "@/components/ui/switch";
import { extractTextFromFile } from "@/lib/extractTextFromFile";
import { incrementCounter, recordDailyVisit } from "@/lib/achievements";

// Custom br component for ReactMarkdown - renders line breaks with visible spacing
const SpacedBr = () => <div className="my-4" />;

// Custom hr component - just a subtle line, spacing handled by heading
const SectionDivider = () => (
  <div className="border-t border-border/40" style={{ marginTop: 0, marginBottom: 0 }} />
);

// Custom h3 component - bold, slightly larger, SPACE ABOVE (not below)
const SectionHeading = ({ children }: { children?: React.ReactNode }) => (
  <div className="font-bold text-[1.05rem] leading-snug mt-8 mb-1" style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '2rem', marginBottom: '0.25rem' }}>
    {children}
  </div>
);

// Markdown components with custom styling for sections
const markdownComponents = {
  br: SpacedBr,
  hr: SectionDivider,
  h3: SectionHeading,
};

// Helper to normalize math delimiters for KaTeX
const normalizeForMath = (s: string, _isCompact: boolean = false) => {
  let out = s || "";
  out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  
  // Don't strip bold markers - let markdown handle them
  // out = out.replace(/\*\*/g, "");
  
  out = out.replace(/```(?:latex)?\s*([\s\S]*?)```/gi, (m, inner) => {
    const t = String(inner || "");
    if (/(\\\[|\\\(|\$\$|\\begin\{)/.test(t)) return t;
    return m;
  });
  out = out.replace(/^\s{4,}(?=\\\[|\\\]|\\\(|\\\)|\$\$|\\begin\{|\\end\{)/gm, "");
  
  // IMPORTANT: Escape currency amounts like $5, $100 BEFORE any math processing
  out = out.replace(/(^|[^\\$])\$(\d+(?:\.\d+)?)(?=[\s,.;:!?)]|$)/g, "$1\\$$2");
  
  // Convert LaTeX delimiters to standard $ delimiters
  out = out.replace(/\\+\[/g, "$$").replace(/\\+\]/g, "$$");
  out = out.replace(/\\+\(/g, "$").replace(/\\+\)/g, "$");
  
  // Handle common math patterns that might not be wrapped
  // Match fractions like \frac{...}{...}
  out = out.replace(/(?<!\$)(\\frac\{[^}]*\}\{[^}]*\})(?!\$)/g, "$$$1$$");
  // Match common functions like \sqrt, \sum, \int
  out = out.replace(/(?<!\$)(\\(?:sqrt|sum|int|prod|lim|infty|partial|nabla|alpha|beta|gamma|delta|theta|pi|sigma|omega|phi|psi|lambda|mu|epsilon|zeta|eta|kappa|rho|tau|chi|nu|xi)(?:\{[^}]*\}|\b))(?!\$)/gi, "$$$1$$");
  // Match superscripts and subscripts like x^2, x_1
  out = out.replace(/(?<!\$)\b([a-zA-Z])([_^])\{([^}]+)\}(?!\$)/g, "$$$1$2{$3}$$");
  out = out.replace(/(?<!\$)\b([a-zA-Z])([_^])([0-9a-zA-Z])(?!\$)/g, "$$$1$2$3$$");
  
  out = out.replace(/([^\n])\$\$/g, "$1\n$$");
  out = out.replace(/\$\$([^\n])/g, "$$\n$1");
  out = out.replace(/\$(\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*)\$/g, (_m, inner) => `$$${inner}$$`);
  out = out.replace(/(^|\n)\s*(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g, (_m, prefix, env) => `${prefix}$$${env}$$`);
  
  // Process line by line to add visual separators before numbered sections
  const lines = out.split("\n");
  const result: string[] = [];
  const sectionPattern = /^(\d+(?:\.\d+)*[\.)\:])\s+([A-Za-z].*)$/;
  const isSectionStart = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return sectionPattern.test(trimmed);
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // If this line starts a numbered section
    if (isSectionStart(line) && i > 0) {
      // Add separator above (blank line + horizontal rule + blank line + heading)
      const prevTrimmed = result.length > 0 ? result[result.length - 1].trim() : "";
      if (prevTrimmed !== "" && prevTrimmed !== "---") {
        result.push("");
        result.push("---");
        result.push("");
      }
      // Convert to heading (bold + larger)
      const match = trimmed.match(sectionPattern);
      if (match) {
        result.push(`### ${match[1]} ${match[2]}`);
      } else {
        result.push(line);
      }
    } else if (isSectionStart(line) && i === 0) {
      // First line is a section - just make it a heading, no rule above
      const match = trimmed.match(sectionPattern);
      if (match) {
        result.push(`### ${match[1]} ${match[2]}`);
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }
  out = result.join("\n");
  
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
    const wrapped = `$${latexizeInline(candidate)}$`;
    return `${prefix}${wrapped}${suffix}`;
  };
  out = out.split("\n").map((ln) => maybeWrapFormula(ln)).join("\n");
  out = out.replace(/(\n\s*){3,}/g, "\n\n");
  return out;
};

interface SavedStudyItem { 
  id: string; 
  title: string; 
  goals: string; 
  type: 'plan' | 'lesson';
  created_at?: any; 
  plan?: any;
  lesson?: any;
  subjects?: string[];
  parent_plan_id?: string;
  originalCreator?: string;
  savedFrom?: string;
}

interface StudyConfig {
  title: string;
  description: string;
  subjects: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  audience: 'k12' | 'high-school' | 'college' | 'professional';
  studyDuration: '30 minutes' | '1 hour' | '2 hours' | '3 hours';
  includeFlashcards: boolean;
  includeQuiz: boolean;
  includeHomework: boolean;
}


export const StudyHelper = forwardRef<{ refreshPlans: () => void }, { userId: string }>(({ userId }, ref) => {
  const gate = usePlanGate();
  const userData = useUserData();
  // Main state
  const [activeTab, setActiveTab] = useState<'planner' | 'library'>(() => {
    try { return sessionStorage.getItem('helper_active_tab') === 'library' ? 'library' : 'planner'; } catch { return 'planner'; }
  });
  useEffect(() => { try { sessionStorage.setItem('helper_active_tab', activeTab); } catch {} }, [activeTab]);
  const [loading, setLoading] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedStudyItem[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [selectedItem, setSelectedItem] = useState<SavedStudyItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [revealedSolutions, setRevealedSolutions] = useState<Set<string>>(new Set());

  // Study Configuration
  const [studyConfig, setStudyConfig] = useState<StudyConfig>({
    title: "",
    description: "",
    subjects: "",
    difficulty: "intermediate",
    audience: "high-school",
    studyDuration: "1 hour",
    includeFlashcards: true,
    includeQuiz: true,
    includeHomework: true
  });

  // Common state
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [generationProgress, setGenerationProgress] = useState(0);
  const [importingFile, setImportingFile] = useState(false);

  // Monthly limit / plan state (parity with summarizer)
  const [monthlyQuota, setMonthlyQuota] = useState<number>(0);
  const [usesBlocked, setUsesBlocked] = useState<boolean>(false);
  const [usagePeriodEnd, setUsagePeriodEnd] = useState<string | null>(null);
  const canUseHelper = !gate.loading && (gate.plan === 'advanced' || gate.plan === 'pro');

  // Truncate to a number of words with ellipsis
  
  // Fun facts are now handled by LoadingOverlay component

  // Simulate generation progress (slower to match actual generation time ~30-45 seconds)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev >= 90) {
            clearInterval(interval);
            return 90;
          }
          return prev + 2;
        });
      }, 1000);
    } else {
      setGenerationProgress(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  // OPTIMIZED: Use context data instead of duplicate listeners
  useEffect(() => {
    const mq = Number(userData.profile?.monthly_quota || 0);
    setMonthlyQuota(mq);
  }, [userData.profile?.monthly_quota]);

  // OPTIMIZED: Compute usesBlocked from context counters
  useEffect(() => {
    const uses = Number(userData.counters?.uses_this_month || 0);
    const extra = Number(userData.counters?.extra_uses_balance || 0);
    const quota = monthlyQuota;
    setUsesBlocked(quota > 0 ? (uses >= quota && extra <= 0) : false);
    const pe = typeof userData.counters?.usage_period_end === 'string' ? userData.counters.usage_period_end : null;
    setUsagePeriodEnd(pe);
  }, [userData.counters, monthlyQuota]);

  // Load saved items
  useEffect(() => {
    const loadSavedItems = async () => {
      if (!userId) return;
      setLoadingSaved(true);
      try {
        // OPTIMIZED: Add limits and orderBy to reduce reads
        const plansRef = collection(db, 'users', userId, 'study_plans');
        const plansQuery = query(plansRef, orderBy('created_at', 'desc'), limit(30));
        const plansSnap = await getDocs(plansQuery);
        const plans = plansSnap.docs.map(d => ({ 
          id: d.id, 
          type: 'plan' as const,
          ...(d.data() as any) 
        }));

        const lessonsRef = collection(db, 'users', userId, 'lessons');
        const lessonsQuery = query(lessonsRef, orderBy('created_at', 'desc'), limit(30));
        const lessonsSnap = await getDocs(lessonsQuery);
        const lessons = lessonsSnap.docs.map(d => ({
          id: d.id,
          type: 'lesson' as const,
          ...(d.data() as any)
        }));

        const allItems = [...plans, ...lessons].sort((a, b) => 
          (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0)
        );

        setSavedItems(allItems);
      } catch (error) {
        console.error("Error loading saved items:", error);
      } finally {
        setLoadingSaved(false);
      }
    };
    loadSavedItems();
  }, [userId]);

  // Expose refresh method to parent component
  useImperativeHandle(ref, () => ({
    refreshPlans: async () => {
      if (!userId) return;
      // Silent refresh - don't flash the skeleton on background updates
      try {
        // OPTIMIZED: Add limits and orderBy to reduce reads
        const plansRef = collection(db, 'users', userId, 'study_plans');
        const plansQuery = query(plansRef, orderBy('created_at', 'desc'), limit(30));
        const plansSnap = await getDocs(plansQuery);
        const plans = plansSnap.docs.map(d => ({ 
          id: d.id, 
          type: 'plan' as const,
          ...(d.data() as any) 
        }));

        const lessonsRef = collection(db, 'users', userId, 'lessons');
        const lessonsQuery = query(lessonsRef, orderBy('created_at', 'desc'), limit(30));
        const lessonsSnap = await getDocs(lessonsQuery);
        const lessons = lessonsSnap.docs.map(d => ({
          id: d.id,
          type: 'lesson' as const,
          ...(d.data() as any)
        }));

        const allItems = [...plans, ...lessons].sort((a, b) => 
          (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0)
        );

        setSavedItems(allItems);
      } catch (error) {
        console.error("Error loading saved items:", error);
      }
    }
  }));

  // Get lessons associated with a plan
  
  // Calculate progress for a plan
  
  // Toggle plan expansion
  
  // Toggle solution visibility
  const toggleSolution = (id: string) => {
    const newRevealed = new Set(revealedSolutions);
    if (newRevealed.has(id)) {
      newRevealed.delete(id);
    } else {
      newRevealed.add(id);
    }
    setRevealedSolutions(newRevealed);
  };

  // Calculate section durations based on total study duration
  const calculateSectionDurations = (totalDuration: string) => {
    const durationMap = {
      '30 minutes': {
        introduction: '5 minutes',
        coreConcepts: '10 minutes',
        examples: '8 minutes',
        practice: '5 minutes',
        summary: '2 minutes'
      },
      '1 hour': {
        introduction: '10 minutes',
        coreConcepts: '20 minutes',
        examples: '15 minutes',
        practice: '10 minutes',
        summary: '5 minutes'
      },
      '2 hours': {
        introduction: '15 minutes',
        coreConcepts: '45 minutes',
        examples: '30 minutes',
        practice: '20 minutes',
        summary: '10 minutes'
      },
      '3 hours': {
        introduction: '20 minutes',
        coreConcepts: '70 minutes',
        examples: '45 minutes',
        practice: '30 minutes',
        summary: '15 minutes'
      }
    };
    
    return durationMap[totalDuration as keyof typeof durationMap] || durationMap['1 hour'];
  };

  // Generate comprehensive lesson via backend with timeout and fallback
  const { showAnimation: showUsageAnim, triggerAnimation: triggerUsageAnim } = useUsageAnimation();

  const generateComprehensiveLesson = async () => {
    if (importingFile) return;
    if (!userId || (!studyConfig.title.trim() && !studyConfig.description.trim())) {
      toast({ title: 'Add a topic', description: 'Enter at least a title or a short description.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    const subjectsList = studyConfig.subjects.split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      title: studyConfig.title.trim(),
      description: studyConfig.description.trim() || studyConfig.title.trim(),
      subjects: subjectsList,
      difficulty: studyConfig.difficulty,
      audience: studyConfig.audience,
      studyDuration: studyConfig.studyDuration,
      includeFlashcards: studyConfig.includeFlashcards,
      includeQuiz: studyConfig.includeQuiz,
      includeHomework: studyConfig.includeHomework,
      userId, // Server tracks usage
    };

    // Attempt 1: Hosting rewrite (short timeout to avoid 60s proxy issues)
    const rewriteUrl = '/api/study-helper/generate-lesson';
    const directUrl = 'https://us-central1-metastudy-e1ba2.cloudfunctions.net/api/study-helper/generate-lesson';

    try {
      let data: any = null;
      const c1 = new AbortController();
      const t1 = setTimeout(() => c1.abort(), 60000); // 60s
      try {
        const r1 = await fetch(rewriteUrl, {
          method: 'POST', headers: await getAuthHeaders(),
          body: JSON.stringify(payload), signal: c1.signal,
        });
        clearTimeout(t1);
        if (r1.ok) {
          data = await r1.json();
        } else {
          throw new Error(`rewrite_status_${r1.status}`);
        }
      } catch (e1: any) {
        clearTimeout(t1);
        // Attempt 2: Direct Cloud Function (longer timeout)
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 180000); // 3 minutes
        const r2 = await fetch(directUrl, {
          method: 'POST', headers: await getAuthHeaders(),
          body: JSON.stringify(payload), signal: c2.signal,
        });
        clearTimeout(t2);
        if (!r2.ok) throw new Error(`direct_status_${r2.status}`);
        data = await r2.json();
      }
      if (!data) throw new Error('generation_failed');

      const lesson = data.lesson || data;
      const ref = collection(db, 'users', userId, 'lessons');
      const docRef = await addDoc(ref, {
        title: studyConfig.title.trim() || lesson?.title || 'Untitled Lesson',
        goals: studyConfig.description.trim() || lesson?.description || '',
        lesson,
        type: 'lesson',
        subjects: subjectsList,
        created_at: serverTimestamp(),
        metadata: {
          duration: studyConfig.studyDuration,
          difficulty: studyConfig.difficulty,
          audience: studyConfig.audience,
          includes: {
            flashcards: studyConfig.includeFlashcards,
            quiz: studyConfig.includeQuiz,
            homework: studyConfig.includeHomework,
          },
        },
      });

      // Usage is tracked server-side
      toast({ title: 'Lesson Created!', description: 'Saved to My Lessons.' });
      try { await incrementCounter(userId, 'lessons'); } catch {}
      try { await recordDailyVisit(userId); } catch {}
      triggerUsageAnim();
      // Optimistic sidebar update
      setSavedItems(prev => [
        { id: docRef.id, title: studyConfig.title.trim() || lesson?.title || 'Untitled Lesson', goals: studyConfig.description.trim() || lesson?.description || '', type: 'lesson', lesson, subjects: subjectsList, created_at: { seconds: Math.floor(Date.now()/1000) } },
        ...prev,
      ]);
      setActiveTab('library');
    } catch (e: any) {
      const timedOut = e?.name === 'AbortError';
      toast({
        title: timedOut ? 'Generation timed out' : 'Failed to generate lesson',
        description: timedOut ? 'It may take up to two minutes and can be slower during peak times. Please try again.' : 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally { setLoading(false); }
  };

  // Enhanced Lesson View Component
  const EnhancedLessonView = ({ lesson, userInput }: { lesson: any, userInput?: string }) => {
    if (!lesson.sections) {
      return (
        <Card>
          <CardContent className="p-6">
            <p>No lesson content available.</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        {/* Lesson Header */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold">{lesson.title}</h3>
                <p className="text-muted-foreground">{lesson.description}</p>
              </div>
              <div className="text-right">
                <Badge variant="outline" className="mb-2">{lesson.duration}</Badge>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="capitalize">{lesson.difficulty}</Badge>
                  <Badge variant="outline">{lesson.audience}</Badge>
                </div>
              </div>
            </div>
            {(userInput || lesson.description) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                {lesson.description && (
                  <div className="p-3 rounded border bg-muted">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</div>
                    <div className="text-sm break-words">{lesson.description}</div>
                  </div>
                )}
                {userInput && (
                  <div className="p-3 rounded border bg-muted">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Your input</div>
                    <div className="text-sm break-words">{userInput}</div>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
              <div className="p-3 border rounded-lg">
                <Clock className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                <div className="text-sm font-medium">Total Duration</div>
                <div className="text-lg font-bold">{lesson.duration}</div>
              </div>
              <div className="p-3 border rounded-lg">
                <Book className="w-6 h-6 mx-auto mb-2 text-green-600" />
                <div className="text-sm font-medium">Sections</div>
                <div className="text-lg font-bold">{lesson.sections.length}</div>
              </div>
              <div className="p-3 border rounded-lg">
                <Brain className="w-6 h-6 mx-auto mb-2 text-purple-600" />
                <div className="text-sm font-medium">Level</div>
                <div className="text-lg font-bold capitalize">{lesson.difficulty}</div>
              </div>
              <div className="p-3 border rounded-lg">
                <Users className="w-6 h-6 mx-auto mb-2 text-orange-600" />
                <div className="text-sm font-medium">Audience</div>
                <div className="text-lg font-bold">{lesson.audience}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lesson Sections */}
        {lesson.sections.map((section: any, index: number) => (
          <Card key={index} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </div>
                  {section.title}
                </CardTitle>
                <Badge variant="outline">{section.duration}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-4 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-500" />
                  Content Overview
                </h4>
                <div className="prose dark:prose-invert max-w-none 
                  prose-p:my-5 prose-p:leading-[1.8] prose-p:text-[0.95rem]
                  prose-ul:my-5 prose-ul:space-y-2
                  prose-ol:my-5 prose-ol:space-y-2
                  prose-li:my-2 prose-li:leading-[1.75] prose-li:text-[0.95rem]
                  prose-br:block prose-br:my-5
                  prose-h3:mt-10 prose-h3:mb-5 prose-h3:font-bold prose-h3:text-lg prose-h3:leading-snug prose-h3:bg-muted prose-h3:rounded-md prose-h3:px-4 prose-h3:py-2.5 prose-h3:border-l-4 prose-h3:border-primary
                  prose-strong:text-foreground prose-strong:font-semibold
                  prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
                  [&_.katex]:text-base [&_.katex-display]:my-6 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-2
                  [&>*:first-child]:mt-0
                  bg-muted/30 rounded-xl p-6 border">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                    {normalizeForMath(String(section.content || ''))}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Examples */}
              {section.examples && section.examples.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-4 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-yellow-500" />
                    Worked Examples ({section.examples.length})
                  </h4>
                  <div className="space-y-4">
                    {section.examples.map((example: any, exampleIndex: number) => (
                      <div key={exampleIndex} className="p-5 border rounded-xl bg-gradient-to-br from-yellow-50/50 to-orange-50/30 dark:from-yellow-950/20 dark:to-orange-950/10">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-7 h-7 rounded-full bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-400 flex items-center justify-center text-sm font-bold">{exampleIndex + 1}</span>
                          <span className="font-semibold text-yellow-800 dark:text-yellow-300">Example Problem</span>
                        </div>
                        <div className="bg-background p-4 rounded-lg border shadow-sm mb-4 prose dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 [&_.katex]:text-base [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {normalizeForMath(String(example.problem || ''))}
                          </ReactMarkdown>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => toggleSolution(`example-${index}-${exampleIndex}`)}
                          className="mb-3"
                        >
                          {revealedSolutions.has(`example-${index}-${exampleIndex}`) ? 'Hide Solution' : 'Show Solution'}
                        </Button>
                        {revealedSolutions.has(`example-${index}-${exampleIndex}`) && (
                          <div className="space-y-4">
                            <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                              <div className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-3">Solution</div>
                              <div className="prose dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 [&_.katex]:text-base [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                                  {normalizeForMath(String(example.solution || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                            {example.explanation && (
                              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900">
                                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-3">Why This Works</div>
                                <div className="prose dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 [&_.katex]:text-base [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto text-sm">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                                    {normalizeForMath(String(example.explanation || ''))}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Prompt */}
              {section.aiPrompt && (
                <div className="p-4 border rounded-lg bg-gradient-to-r from-blue-50 to-purple-50">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Wand2 className="w-4 h-4 text-blue-600" />
                      AI Prompt for This Section
                    </h4>
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => copyToClipboard(section.aiPrompt, 'AI prompt copied to clipboard')}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Prompt
                    </Button>
                  </div>
                  <div className="bg-card p-3 rounded text-sm font-mono whitespace-pre-wrap border">
                    {section.aiPrompt}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Copy this prompt into your preferred AI chat to generate detailed content for this section
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Flashcards */}
        {lesson.flashcards && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Flashcards ({lesson.flashcards.length} cards)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {lesson.flashcards.map((flashcard: any, index: number) => (
                  <div key={index} className="p-5 border rounded-xl hover:shadow-lg transition-all bg-gradient-to-br from-card to-muted/30">
                    <div className="font-semibold mb-3 text-primary flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-sm">{index + 1}</span>
                      Flashcard
                    </div>
                    <div className="space-y-4">
                      <div className="p-4 bg-background rounded-lg border shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Question</div>
                        <div className="prose dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-base [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {normalizeForMath(String(flashcard.front || ''))}
                          </ReactMarkdown>
                        </div>
                      </div>
                      <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-2">Answer</div>
                        <div className="prose dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-base [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {normalizeForMath(String(flashcard.back || ''))}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-4 border rounded-lg bg-muted">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-green-600" />
                  Flashcard AI Prompt
                </h4>
                <p className="text-sm mb-3">Generate more flashcards using this prompt:</p>
                <div className="bg-card p-3 rounded text-sm font-mono whitespace-pre-wrap border mb-2">
                  {`Create 15-20 flashcards for ${lesson.title} at ${lesson.difficulty} level covering:, Key concepts and definitions, Important formulas/theorems, Common applications, Critical thinking questions, Real-world examples`}
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => copyToClipboard(`Create 15-20 flashcards for ${lesson.title} at ${lesson.difficulty} level covering key concepts, definitions, formulas, applications, and real-world examples.`, 'Flashcard prompt copied')}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Flashcard Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quiz */}
        {lesson.quiz && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                Quiz ({lesson.quiz.questions?.length || 0} questions)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {lesson.quiz.questions.map((question: any, index: number) => (
                <div key={index} className="p-5 border rounded-xl bg-gradient-to-br from-card to-muted/20 hover:shadow-md transition-all">
                  <div className="mb-4">
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0 mt-1">{index + 1}</span>
                      <div className="prose dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-base [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto font-medium">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                          {normalizeForMath(String(question.question || ''))}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  {question.options && (
                    <div className="space-y-3 mb-4 ml-11">
                      {question.options.map((option: string, optIndex: number) => (
                        <div key={optIndex} className="flex items-start gap-3 p-3 border rounded-lg bg-background hover:bg-muted/50 transition-colors">
                          <div className="w-7 h-7 rounded-full border-2 border-primary/30 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                            {String.fromCharCode(65 + optIndex)}
                          </div>
                          <div className="prose dark:prose-invert max-w-none prose-p:my-1 prose-p:leading-relaxed prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 [&_.katex]:text-base [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto text-sm flex-1">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                              {normalizeForMath(String(option || ''))}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ml-11">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => toggleSolution(`quiz-${index}`)}
                      className="mb-3"
                    >
                      {revealedSolutions.has(`quiz-${index}`) ? 'Hide Answer' : 'Show Answer'}
                    </Button>
                    {revealedSolutions.has(`quiz-${index}`) && (
                      <div className="space-y-3">
                        <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                          <div className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-2">Correct Answer</div>
                          <div className="prose dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-base [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                              {normalizeForMath(String(question.answer || ''))}
                            </ReactMarkdown>
                          </div>
                        </div>
                        <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900">
                          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-2">Explanation</div>
                          <div className="prose dark:prose-invert max-w-none prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1 [&_.katex]:text-base [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto text-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                              {normalizeForMath(String(question.explanation || ''))}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="p-4 border rounded-lg bg-muted">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4" />
                  Quiz AI Prompt
                </h4>
                <p className="text-sm mb-3">Generate more quiz questions using this prompt:</p>
                <div className="bg-card p-3 rounded text-sm font-mono whitespace-pre-wrap border mb-2">
                  {`Create a 10-question quiz for ${lesson.title} at ${lesson.difficulty} level for ${lesson.audience} audience covering:, Conceptual understanding (40%), Application problems (30%), Critical thinking (20%), Real-world scenarios (10%)
Include multiple choice and short answer questions with detailed explanations.`}
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => copyToClipboard(`Create a 10-question quiz for ${lesson.title} at ${lesson.difficulty} level covering conceptual understanding, application problems, critical thinking, and real-world scenarios with detailed explanations.`, 'Quiz prompt copied')}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Quiz Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Homework */}
        {lesson.homework && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                Homework Assignments ({lesson.homework.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {lesson.homework.map((assignment: any, index: number) => (
                <div key={index} className="p-5 border rounded-xl bg-gradient-to-br from-purple-50/50 to-pink-50/30 dark:from-purple-950/20 dark:to-pink-950/10">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-400 flex items-center justify-center text-sm font-bold">{index + 1}</span>
                    <span className="font-semibold text-purple-800 dark:text-purple-300">Assignment</span>
                  </div>
                  <div className="bg-background p-4 rounded-lg border shadow-sm mb-4 prose dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 [&_.katex]:text-base [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                      {normalizeForMath(String(assignment.problem || ''))}
                    </ReactMarkdown>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => toggleSolution(`homework-${index}`)}
                    className="mb-3"
                  >
                    {revealedSolutions.has(`homework-${index}`) ? 'Hide Solution' : 'Show Solution'}
                  </Button>
                  {revealedSolutions.has(`homework-${index}`) && (
                    <div className="space-y-4">
                      <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                        <div className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400 mb-3">Solution</div>
                        <div className="prose dark:prose-invert max-w-none prose-p:my-3 prose-p:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 [&_.katex]:text-base [&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {normalizeForMath(String(assignment.solution || ''))}
                          </ReactMarkdown>
                        </div>
                      </div>
                      {assignment.steps && assignment.steps.length > 0 && (
                        <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900">
                          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-3">Step-by-Step Guide</div>
                          <div className="space-y-3">
                            {assignment.steps.map((step: string, stepIndex: number) => (
                              <div key={stepIndex} className="flex gap-3">
                                <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">{stepIndex + 1}</span>
                                <div className="prose dark:prose-invert max-w-none prose-p:my-1 prose-p:leading-relaxed prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 [&_.katex]:text-base [&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto text-sm flex-1">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                                    {normalizeForMath(String(step || ''))}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="p-4 border rounded-lg bg-muted">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <Wand2 className="w-4 h-4" />
                  Homework AI Prompt
                </h4>
                <p className="text-sm mb-3">Generate more homework problems using this prompt:</p>
                <div className="bg-card p-3 rounded text-sm font-mono whitespace-pre-wrap border mb-2">
                  {`Create homework assignments for ${lesson.title} at ${lesson.difficulty} level including:, 3-5 practice problems with progressive difficulty, 1 real-world application task, 1 critical thinking question, Step-by-step solutions with explanations, Common mistake warnings`}
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => copyToClipboard(`Create homework assignments for ${lesson.title} at ${lesson.difficulty} level including practice problems, real-world applications, critical thinking questions, and step-by-step solutions.`, 'Homework prompt copied')}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Homework Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  // Plan Card with integrated lessons
  
  // Common Functions
  const openItem = (item: SavedStudyItem) => {
    setSelectedItem(item);
    setActiveTab("library");
  };

  const deleteItem = async (id: string, type: 'plan' | 'lesson') => {
    if (!userId) return;
    // Optimistic: remove from UI instantly, restore on failure
    const prevItems = savedItems;
    setSavedItems(prev => prev.filter(x => x.id !== id));
    if (selectedItem?.id === id) setSelectedItem(null);
    try {
      const collectionName = type === 'plan' ? 'study_plans' : 'lessons';
      await deleteDoc(doc(db, 'users', userId, collectionName, id));
      toast({ title: "Deleted", description: `${type === 'plan' ? 'Study plan' : 'Lesson'} removed` });
    } catch (error) {
      setSavedItems(prevItems);
      console.error("Error deleting item:", error);
      toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
    }
  };

  const toggleItemSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteItems = async () => {
    if (selectedItems.size === 0 || !userId) return;
    const deletedIds = new Set(selectedItems);
    // Optimistic: remove from UI instantly, restore on failure
    const prevItems = savedItems;
    setSavedItems(prev => prev.filter(item => !deletedIds.has(item.id)));
    if (selectedItem && deletedIds.has(selectedItem.id)) {
      setSelectedItem(null);
    }
    setSelectedItems(new Set());
    setSelectionMode(false);
    setConfirmOpen(false);
    try {
      const batch = writeBatch(db);

      for (const id of deletedIds) {
        const item = prevItems.find(i => i.id === id);
        if (item) {
          const collectionName = item.type === 'plan' ? 'study_plans' : 'lessons';
          batch.delete(doc(db, 'users', userId, collectionName, id));
        }
      }

      await batch.commit();
      toast({ title: "Success", description: `Deleted ${deletedIds.size} item${deletedIds.size === 1 ? '' : 's'}` });
    } catch (e: any) {
      setSavedItems(prevItems);
      toast({ title: "Error", description: e?.message || "Failed to delete items", variant: "destructive" });
    }
  };

  const requestDelete = (item: SavedStudyItem) => {
    setConfirmId(item.id);
    setConfirmTitle(item.title || (item.type === 'plan' ? 'Study Plan' : 'Lesson'));
    setConfirmOpen(true);
  };

  const handleRenameItem = async (id: string, newTitle: string, type: 'plan' | 'lesson') => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle || !userId) return;
    
    try {
      const collectionName = type === 'plan' ? 'study_plans' : 'lessons';
      await updateDoc(doc(db, 'users', userId, collectionName, id), { 
        title: trimmedTitle.substring(0, 120) 
      });
      
      setSavedItems(prev => prev.map(item => 
        item.id === id ? { ...item, title: trimmedTitle.substring(0, 120) } : item
      ));
      
      if (selectedItem?.id === id) {
        setSelectedItem({ ...selectedItem, title: trimmedTitle.substring(0, 120) });
      }
    } catch (error) {
      console.error("Error renaming item:", error);
    }
  };

  const openRename = (item: SavedStudyItem) => {
    setRenameId(item.id);
    setRenameTitle(item.title || '');
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!renameId) return;
    const item = savedItems.find(i => i.id === renameId);
    if (item) {
      await handleRenameItem(renameId, renameTitle, item.type);
    }
    setRenameOpen(false);
  };

  
  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: message,
    });
  };

  return (
    <div className="max-w-7xl mx-auto relative px-3 md:px-0 overflow-x-hidden md:overflow-x-auto" aria-busy={loading}>
      <LoadingOverlay open={loading} title="Working…" subtitle="This may take up to a minute or two. Please don't refresh." progress={loading ? generationProgress : undefined} />
      
      {/* Sidebar menu button - mobile only */}
      <div className="md:hidden flex items-center justify-between mb-6">
        <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)}>
          <Menu className="w-4 h-4 mr-2" />
          Menu
        </Button>
      </div>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-2 sticky top-0 z-[90] bg-background/95 backdrop-blur py-2 pointer-events-auto">
              <div>
                <h3 className="text-lg font-semibold">My Study Materials</h3>
                <p className="text-xs text-muted-foreground">{savedItems.filter(item => item.type === 'lesson').length} lesson{savedItems.filter(item => item.type === 'lesson').length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActiveTab('planner'); setSidebarOpen(false); }}
                  aria-label="New lesson"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            {loadingSaved ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : savedItems.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No study materials yet!</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {savedItems.filter(item => item.type === 'lesson').map((item) => (
                  <div key={item.id} className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedItem?.id === item.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}>
                    <button 
                      onClick={() => { openItem(item); setSidebarOpen(false); }} 
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="font-medium text-sm truncate" title={item.title}>{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.lesson?.duration || '1 hour'} • <span className="capitalize">{item.lesson?.difficulty || 'intermediate'}</span>
                        {(item.savedFrom === "feed" || item.savedFrom === "challenge") && item.originalCreator && (
                          <span className="block text-xs text-muted-foreground mt-1">
                            saved from feed, made by @{item.originalCreator}
                          </span>
                        )}
                      </p>
                    </button>
                    <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); openRename(item); }} aria-label="Rename">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); requestDelete(item); }} aria-label="Delete">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-6 min-w-0">
        {/* Desktop Sidebar */}
        <div className="hidden md:block w-64 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Lessons</CardTitle>
              <CardDescription>{savedItems.filter(item => item.type === 'lesson').length} lesson{savedItems.filter(item => item.type === 'lesson').length === 1 ? '' : 's'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSaved ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : savedItems.filter(item => item.type === 'lesson').length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No lessons yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedItems.filter(item => item.type === 'lesson').slice(0, 10).map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedItem?.id === s.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        const run = () => { setActiveTab('library'); setSelectedItem(s); };
                        run();
                      }}
                      role="button"
                    >
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={s.title}>{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="capitalize">{s.type}</span>
                          {s.type === 'lesson' && s.lesson && (
                            <span> • {s.lesson.duration || '1 hour'}</span>
                          )}
                          {(s.savedFrom === "feed" || s.savedFrom === "challenge") && s.originalCreator ? (
                            <span className="block">saved from feed, made by @{s.originalCreator}</span>
                          ) : null}
                        </p>
                      </div>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openRename(s); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); requestDelete(s); }}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'planner' | 'library')}>
            <TabsList className="w-full grid grid-cols-2 mb-4" data-tour="helper-tabs">
              <TabsTrigger value="planner" className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Planner & Creator
              </TabsTrigger>
              <TabsTrigger value="library" className="flex items-center gap-2" data-tour="helper-saved-tab">
                <BookOpen className="w-4 h-4" />
                My Saves
              </TabsTrigger>
            </TabsList>

            {/* Lesson Creator Tab */}
            <TabsContent value="planner" className="mt-0">
              <Card>
                <CardHeader className="text-center pb-6">
                  <CardTitle className="text-2xl">
                    AI Lesson Creator
                  </CardTitle>
                  <p className="text-muted-foreground">
                    Create comprehensive lessons with AI prompts for each section. Choose your study duration and get tailored content.
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!gate.loading && !canUseHelper && (
                    <div className="p-3 border border-yellow-300 bg-yellow-50 text-yellow-800 rounded flex items-center justify-between">
                      <div>
                        <div className="font-semibold">Upgrade required</div>
                        <div className="text-sm opacity-90">Lesson Generator is available on Advanced and Pro plans.</div>
                      </div>
                      <Badge variant="secondary" className="uppercase bg-yellow-200 text-yellow-900">Limited</Badge>
                    </div>
                  )}
                  {usesBlocked && (
                    <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive rounded flex items-center justify-between">
                      <div>
                        <div className="font-semibold">Monthly limits used</div>
                        <div className="text-sm opacity-90">
                          You’ve reached your monthly generation limit.
                          {usagePeriodEnd ? (
                            <> Resets on {new Date(usagePeriodEnd).toLocaleDateString()}.</>
                          ) : null}
                        </div>
                      </div>
                      <Badge variant="destructive" className="uppercase">Blocked</Badge>
                    </div>
                  )}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                      {/* Lesson Configuration */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <GraduationCap className="w-5 h-5" />
                            Lesson Details
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <Label>Lesson Title</Label>
                            <Input 
                              value={studyConfig.title} 
                              onChange={(e) => setStudyConfig({...studyConfig, title: e.target.value})} 
                              placeholder="e.g., Calculus Integration Techniques, Nursing Patient Assessment, Marketing Strategy Fundamentals"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Learning Objectives & Description</Label>
                            <Textarea
                              value={studyConfig.description}
                              onChange={(e) => setStudyConfig({...studyConfig, description: e.target.value})}
                              placeholder="Describe what you want to learn. Be specific about topics, concepts, and what you hope to achieve. The AI will use this to create tailored content and prompts."
                              data-tour="helper-topic"
                              className="min-h-[120px]"
                              disabled={importingFile}
                            />
                            <div className="flex items-center gap-2">
                              <Input
                                id="lesson-file-input"
                                type="file"
                                accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                                onChange={async (e) => {
                                  const inputEl = e.currentTarget;
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  setImportingFile(true);
                                  try {
                                    const extracted = await extractTextFromFile(f);
                                    const val = (extracted || "").trim();
                                    setStudyConfig((prev) => ({
                                      ...prev,
                                      description: val,
                                      title: prev.title.trim() ? prev.title : f.name.replace(/\.[^.]+$/, ''),
                                    }));
                                    const words = val.split(/\s+/).filter(Boolean).length;
                                    toast({ title: "Imported", description: `Loaded ${f.name} (${words} words)` });
                                  } catch (err: any) {
                                    toast({ title: "Error", description: err?.message || "Failed to read file", variant: "destructive" });
                                  } finally {
                                    setImportingFile(false);
                                    inputEl.value = "";
                                  }
                                }}
                                disabled={importingFile}
                                className="hidden"
                              />
                              <Label htmlFor="lesson-file-input" className={importingFile ? "pointer-events-none opacity-60" : "cursor-pointer"}>
                                <Button variant="outline" size="sm" type="button" asChild>
                                  <span>
                                    {importingFile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
                                    {importingFile ? "Reading file…" : "Import file (PDF, image, docs…)"}
                                  </span>
                                </Button>
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Important: The more info you provide, the more accurate and tailored your lesson will be. Short inputs are okay too, even one word works. It may take up to a minute or two to generate your lessons.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label>Subjects & Topics</Label>
                            <Input 
                              value={studyConfig.subjects} 
                              onChange={(e) => setStudyConfig({...studyConfig, subjects: e.target.value})} 
                              placeholder="e.g., Mathematics, Nursing, Business, Programming, History"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Settings Sidebar */}
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-lg">Learning Settings</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Study Duration */}
                          <div className="space-y-2">
                            <Label>Study Duration</Label>
                            <Select value={studyConfig.studyDuration} onValueChange={(v: any) => setStudyConfig({...studyConfig, studyDuration: v})}>
                              <SelectTrigger data-tour="helper-duration">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="30 minutes">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-green-600" />
                                    <span>30 minutes</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="1 hour">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-blue-600" />
                                    <span>1 hour</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="2 hours">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-orange-600" />
                                    <span>2 hours</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="3 hours">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-red-600" />
                                    <span>3 hours</span>
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Difficulty Level */}
                          <div className="space-y-2">
                            <Label>Difficulty Level</Label>
                            <Select value={studyConfig.difficulty} onValueChange={(v: any) => setStudyConfig({...studyConfig, difficulty: v})}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="beginner">
                                  <div className="flex items-center gap-2">
                                    <Rocket className="w-4 h-4 text-green-600" />
                                    <span>Beginner</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="intermediate">
                                  <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4 text-yellow-600" />
                                    <span>Intermediate</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="advanced">
                                  <div className="flex items-center gap-2">
                                    <Brain className="w-4 h-4 text-red-600" />
                                    <span>Advanced</span>
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Audience */}
                          <div className="space-y-2">
                            <Label>Audience Level</Label>
                            <Select value={studyConfig.audience} onValueChange={(v: any) => setStudyConfig({...studyConfig, audience: v})}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="k12">K12</SelectItem>
                                <SelectItem value="high-school">High School</SelectItem>
                                <SelectItem value="college">College</SelectItem>
                                <SelectItem value="professional">Professional</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Content Options */}
                      <Card data-tour="helper-options">
                        <CardHeader>
                          <CardTitle className="text-lg">Additional Content</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={studyConfig.includeFlashcards}
                              onCheckedChange={(v) => setStudyConfig({...studyConfig, includeFlashcards: v})}
                            />
                            <Label>Include Flashcards</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={studyConfig.includeQuiz}
                              onCheckedChange={(v) => setStudyConfig({...studyConfig, includeQuiz: v})}
                            />
                            <Label>Include Quiz</Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={studyConfig.includeHomework}
                              onCheckedChange={(v) => setStudyConfig({...studyConfig, includeHomework: v})}
                            />
                            <Label>Include Homework</Label>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Duration Info */}
                      <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="p-4">
                          <div className="flex items-center gap-2 text-blue-800 mb-2">
                            <Clock className="w-4 h-4" />
                            <span className="font-semibold">Duration Breakdown</span>
                          </div>
                          <div className="text-sm text-blue-700 space-y-1">
                            {Object.entries(calculateSectionDurations(studyConfig.studyDuration)).map(([section, duration]) => (
                              <div key={section} className="flex justify-between">
                                <span className="capitalize">{section.replace(/([A-Z])/g, ' $1')}:</span>
                                <span className="font-medium">{duration}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex justify-center">
                    <div className="relative">
                      <UsageAnimation show={showUsageAnim} />
                      <Button 
                        onClick={() => { generateComprehensiveLesson(); }} 
                        disabled={!canUseHelper || usesBlocked || loading || importingFile || !studyConfig.title.trim() || !studyConfig.description.trim()}
                        className="h-12 text-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 px-8"
                        size="lg"
                        data-tour="helper-generate"
                      >
                        {loading ? (
                          <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Generating...</>
                        ) : usesBlocked ? (
                          <><X className="w-5 h-5 mr-2" />Monthly limit reached</>
                        ) : (!canUseHelper && !gate.loading) ? (
                          <><X className="w-5 h-5 mr-2" />Upgrade to use</>
                        ) : (
                          <><Play className="w-5 h-5 mr-2" />Generate</>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* My Saves Tab */}
            <TabsContent value="library" className="mt-0">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {selectedItem && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 mr-1 -ml-2" onClick={() => setSelectedItem(null)}>
                            <ArrowLeft className="w-4 h-4" />
                          </Button>
                        )}
                        {selectedItem ? selectedItem.title : "My Saves"}
                      </CardTitle>
                      <CardDescription>
                        {selectedItem ? (
                          <span className="capitalize">{selectedItem.type} • {new Date(selectedItem.created_at?.seconds ? selectedItem.created_at.seconds * 1000 : selectedItem.created_at).toLocaleDateString()}</span>
                        ) : (
                          <>
                            Saved lessons and study plans
                            {selectionMode && selectedItems.size > 0 && ` • ${selectedItems.size} selected`}
                          </>
                        )}
                      </CardDescription>
                    </div>
                    {selectedItem ? (
                      <div className="flex gap-2">
                         <Button variant="outline" size="sm" onClick={() => openRename(selectedItem)}>
                           <Pencil className="w-4 h-4 mr-2" /> Rename
                         </Button>
                         <Button variant="destructive" size="sm" onClick={() => requestDelete(selectedItem)}>
                           <Trash2 className="w-4 h-4 mr-2" /> Delete
                         </Button>
                      </div>
                    ) : !selectionMode ? (
                      <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                        <CheckSquare className="w-4 h-4 mr-2" />
                        Select Multiple
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => {
                          if (selectedItems.size === savedItems.length) {
                            setSelectedItems(new Set());
                          } else {
                            setSelectedItems(new Set(savedItems.map(i => i.id)));
                          }
                        }}>
                          {selectedItems.size === savedItems.length ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          setSelectionMode(false);
                          setSelectedItems(new Set());
                        }}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedItem ? (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {selectedItem.type === 'lesson' && selectedItem.lesson && (
                        <div className="space-y-6">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
                            <div>
                              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1">Duration</div>
                              <div className="font-medium">{selectedItem.lesson.duration}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1">Difficulty</div>
                              <div className="capitalize font-medium">{selectedItem.lesson.difficulty}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1">Audience</div>
                              <div className="capitalize font-medium">{selectedItem.lesson.audience}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground uppercase font-semibold mb-1">Sections</div>
                              <div className="font-medium">{selectedItem.lesson.sections?.length || 0}</div>
                            </div>
                          </div>

                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <h3 className="text-lg font-semibold">Overview</h3>
                            <p>{selectedItem.lesson.description}</p>
                          </div>

                          <div className="space-y-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                              <Book className="w-5 h-5 text-blue-500" />
                              Lesson Content
                            </h3>
                            <div className="space-y-4">
                              {selectedItem.lesson.sections?.map((section: any, idx: number) => (
                                <Card key={idx} className="overflow-hidden border-l-4 border-l-blue-500">
                                  <CardHeader className="py-3 bg-muted/20">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-base">{section.title}</CardTitle>
                                      <Badge variant="secondary">{section.duration}</Badge>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="py-4 space-y-4">
                                    <div className="prose prose-sm dark:prose-invert max-w-none">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                      >
                                        {normalizeForMath(section.content)}
                                      </ReactMarkdown>
                                    </div>
                                    
                                    {section.examples && section.examples.length > 0 && (
                                      <div className="bg-muted/30 p-3 rounded-md space-y-2">
                                        <div className="font-semibold text-sm flex items-center gap-2">
                                          <Lightbulb className="w-4 h-4 text-yellow-500" />
                                          Examples
                                        </div>
                                        {section.examples.map((ex: any, i: number) => (
                                          <div key={i} className="text-sm pl-4 border-l-2 border-yellow-500/30">
                                            <div className="font-medium">Q: {ex.problem}</div>
                                            <div className="text-muted-foreground mt-1">A: {ex.solution}</div>
                                            <div className="text-xs text-muted-foreground mt-1 italic">{ex.explanation}</div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          </div>

                          {selectedItem.lesson.flashcards && selectedItem.lesson.flashcards.length > 0 && (
                            <div className="space-y-3">
                              <h3 className="text-lg font-semibold flex items-center gap-2">
                                <Layers className="w-5 h-5 text-indigo-500" />
                                Flashcards ({selectedItem.lesson.flashcards.length})
                              </h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {selectedItem.lesson.flashcards.map((card: any, i: number) => (
                                  <div key={i} className="p-3 border rounded bg-card text-sm">
                                    <div className="font-semibold mb-1 border-b pb-1 border-border/50">{card.front}</div>
                                    <div className="text-muted-foreground">{card.back}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedItem.lesson.quiz?.questions && selectedItem.lesson.quiz.questions.length > 0 && (
                             <div className="space-y-3">
                              <h3 className="text-lg font-semibold flex items-center gap-2">
                                <Target className="w-5 h-5 text-green-500" />
                                Quiz ({selectedItem.lesson.quiz.questions.length} questions)
                              </h3>
                              <div className="space-y-3">
                                {selectedItem.lesson.quiz.questions.map((q: any, i: number) => (
                                  <div key={i} className="p-3 border rounded bg-card text-sm space-y-2">
                                    <div className="font-medium flex gap-2">
                                      <span className="text-muted-foreground">{i+1}.</span>
                                      {q.question}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-5">
                                      {q.options.map((opt: string, j: number) => (
                                        <div key={j} className={`p-1.5 rounded border text-xs ${opt === q.answer ? 'bg-green-500/10 border-green-500/50 font-medium' : 'bg-muted/20 border-transparent'}`}>
                                          {opt}
                                          {opt === q.answer && <Check className="w-3 h-3 inline ml-1 text-green-600" />}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Optional: Copy prompts for Flashcard and Quiz generators */}
                          <div className="mt-8 pt-6 border-t border-border/50 space-y-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
                              <Wand2 className="w-5 h-5" />
                              Generate More from This Lesson
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              Copy the prompts below and paste them into the Flashcard or Quiz generators to create study materials from this lesson.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium flex items-center gap-2">
                                    <Layers className="w-4 h-4 text-indigo-500" />
                                    Flashcard Prompt
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const lessonText = `${selectedItem.lesson.title}\n\n${selectedItem.lesson.description}\n\n${(selectedItem.lesson.sections || []).map((s: any) => `${s.title}\n${s.content}`).join('\n\n')}`;
                                      navigator.clipboard.writeText(lessonText);
                                      toast({ title: "Copied!", description: "Paste this into the Flashcard generator" });
                                    }}
                                  >
                                    <Copy className="w-4 h-4 mr-1" />
                                    Copy
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Copies the lesson title, description, and all section content for generating flashcards.
                                </p>
                              </div>
                              <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium flex items-center gap-2">
                                    <Target className="w-4 h-4 text-green-500" />
                                    Quiz Prompt
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const lessonText = `${selectedItem.lesson.title}\n\n${selectedItem.lesson.description}\n\n${(selectedItem.lesson.sections || []).map((s: any) => `${s.title}\n${s.content}`).join('\n\n')}`;
                                      navigator.clipboard.writeText(lessonText);
                                      toast({ title: "Copied!", description: "Paste this into the Quiz generator" });
                                    }}
                                  >
                                    <Copy className="w-4 h-4 mr-1" />
                                    Copy
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Copies the lesson content for generating quiz questions.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedItem.type === 'lesson' && !selectedItem.lesson && (
                        <div className="space-y-6">
                          <EnhancedLessonView
                            lesson={{
                              title: (selectedItem as any).title || 'Lesson',
                              description: (selectedItem as any).goals || (selectedItem as any).description || '',
                              duration: (selectedItem as any)?.metadata?.duration || '1 hour',
                              difficulty: (selectedItem as any)?.metadata?.difficulty || 'intermediate',
                              audience: (selectedItem as any)?.metadata?.audience || 'high-school',
                              sections: (selectedItem as any).sections || [],
                              flashcards: (selectedItem as any).flashcards || [],
                              quiz: (selectedItem as any).quiz || undefined,
                            }}
                          />
                        </div>
                      )}

                      {selectedItem.type === 'plan' && selectedItem.plan && (
                        <div className="space-y-6">
                          <div className="bg-muted/30 p-4 rounded-lg">
                             <h3 className="font-semibold mb-2">Goals</h3>
                             <p className="text-sm">{selectedItem.plan.goals || selectedItem.goals}</p>
                          </div>
                          
                          {/* Assuming plan structure, typically modules or schedule */}
                          <div className="space-y-4">
                             <h3 className="font-semibold text-lg">Study Schedule</h3>
                             {/* Render basic plan info - structure varies, fallback to stringify if needed or assume modules */}
                             {selectedItem.plan.modules ? (
                               <div className="space-y-4">
                                 {selectedItem.plan.modules.map((mod: any, i: number) => (
                                   <Card key={i}>
                                     <CardHeader className="py-3">
                                       <CardTitle className="text-base">{mod.title || `Module ${i+1}`}</CardTitle>
                                       {mod.duration && <CardDescription>{mod.duration}</CardDescription>}
                                     </CardHeader>
                                     <CardContent className="py-3 text-sm">
                                       {mod.description || mod.topics?.join(', ')}
                                     </CardContent>
                                   </Card>
                                 ))}
                               </div>
                             ) : (
                               <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
                                 {JSON.stringify(selectedItem.plan, null, 2)}
                               </pre>
                             )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    savedItems.length === 0 ? (
                      <p className="text-muted-foreground">No saved items yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {savedItems.map((s) => (
                          <div
                            key={s.id}
                            className="group p-3 border rounded-lg bg-background transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm ring-1 ring-transparent hover:ring-2 hover:ring-primary/40 cursor-pointer"
                            onClick={() => {
                              if (selectionMode) {
                                toggleItemSelection(s.id);
                              } else {
                                openItem(s);
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
                                    toggleItemSelection(s.id);
                                  }}
                                >
                                  {selectedItems.has(s.id) ? (
                                    <CheckSquare className="w-5 h-5 text-primary" />
                                  ) : (
                                    <Square className="w-5 h-5" />
                                  )}
                                </Button>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium break-words" title={s.title}>{s.title.length > 30 ? s.title.slice(0, 30) + '...' : s.title}</div>
                                    <Badge variant="outline" className="capitalize mt-1 inline-block">{s.type}</Badge>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {new Date(s.created_at?.seconds ? s.created_at.seconds * 1000 : s.created_at || Date.now()).toLocaleDateString()}
                                      {s.type === 'lesson' && s.lesson && (
                                        <span> • {s.lesson.duration || '1 hour'} • {s.lesson.difficulty || 'intermediate'}</span>
                                      )}
                                      {(s.savedFrom === "feed" || s.savedFrom === "challenge") && s.originalCreator && (
                                        <span className="block mt-1">saved from feed, made by @{s.originalCreator}</span>
                                      )}
                                    </div>
                                  </div>
                                  {!selectionMode && (
                                    <div className="flex flex-col sm:flex-row items-center gap-1 flex-shrink-0">
                                      <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={(e) => { e.stopPropagation(); openItem(s); }}>
                                        <Eye className="w-4 h-4 mr-1" /> View
                                      </Button>
                                      <div className="flex gap-1">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); openRename(s); }} aria-label="Rename">
                                          <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); requestDelete(s); }} aria-label="Delete">
                                          <Trash2 className="w-4 h-4 text-destructive" />
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </CardContent>
              </Card>
              
              {/* Floating Action Bar for bulk delete */}
              {selectionMode && selectedItems.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
                  <Card className="shadow-lg border-2">
                    <CardContent className="p-4 flex items-center gap-4">
                      <span className="font-medium">{selectedItems.size} item{selectedItems.size === 1 ? '' : 's'} selected</span>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setConfirmId("bulk");
                          setConfirmTitle(`${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'}`);
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
        </div>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Label>New Name</Label>
            <Input 
              value={renameTitle} 
              onChange={(e) => setRenameTitle(e.target.value)} 
              placeholder="Enter a new name..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={saveRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmId === "bulk" ? "Delete Multiple Items?" : "Delete Item?"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p>Are you sure you want to delete {confirmId === "bulk" ? "these items" : "this"}? This action cannot be undone.</p>
            <p className="text-sm text-muted-foreground truncate">{confirmTitle}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>No, keep {confirmId === "bulk" ? "them" : "it"}</Button>
            <Button 
              variant="destructive"
              disabled={loading}
              onClick={async () => {
                if (confirmId === "bulk") {
                  await bulkDeleteItems();
                } else if (confirmId) {
                  const item = savedItems.find(i => i.id === confirmId);
                  if (item) {
                    await deleteItem(confirmId, item.type);
                  }
                  setConfirmOpen(false);
                }
              }}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</> : 'Yes, delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
