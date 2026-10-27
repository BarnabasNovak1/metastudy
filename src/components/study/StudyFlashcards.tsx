import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useMemo } from "react";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import { useNavGuard } from "@/hooks/use-nav-guard";
import { useUserData } from "@/contexts/UserDataContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { db } from "../../../firebase";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  orderBy,
  query,
  where,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  arrayRemove,
  writeBatch,
  limit,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Pencil, Trash2, Plus, Play, BookOpen, Loader2, X, Menu, Layers, Square, CheckSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FlashcardViewer } from "@/components/FlashcardViewer";
import { awardAchievement, incrementCounterAndMaybeAward, addXP, awardActionXP, incrementCounter, recordDailyVisit } from "@/lib/achievements";
import { extractTextFromFile } from "@/lib/extractTextFromFile";
import { startToolSession, endToolSession } from "@/lib/session";
import { CrossCreatePicker } from "@/components/CrossCreatePicker";
import { getRandomFunFact } from "@/lib/funFacts";
import LoadingOverlay from "@/components/LoadingOverlay";

interface Flashcard {
  question: string;
  answer: string;
}

interface SavedFlashcard {
  id: string;
  question: string;
  answer: string;
}

interface FlashcardSet {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  flashcards?: SavedFlashcard[];
  mastered_ids?: string[];
  total_count?: number;
  mastered_count?: number;
  mastered_awarded?: boolean;
  originalCreator?: string;
  savedFrom?: string;
}

// Quiz-related UI removed

// Helper to normalize math delimiters for KaTeX
const normalizeForMath = (s: string) => {
  let out = s || "";
  out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
  out = out.replace(/\\\\([A-Za-z]+)/g, "\\$1");
  out = out.replace(/\*\*/g, "");
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
    if (/[$]|\\\(|\\\[|\\begin\{/.test(line)) return line;

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

export const StudyFlashcards = forwardRef<{ refreshFlashcards: () => void }, { userId: string }>(({ userId }, ref) => {
  // Use centralized context for user data (eliminates duplicate listeners)
  const userData = useUserData();
  const [text, setText] = useState("");
  const [setTitle, setSetTitle] = useState("");
  const [flashcardCount, setFlashcardCount] = useState<number>(10);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSets, setSavedSets] = useState<FlashcardSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [selectedSet, setSelectedSet] = useState<FlashcardSet | null>(null);
  const [tab, setTab] = useState<string>(() => {
    try { return sessionStorage.getItem('flashcards_active_tab') || 'generate'; } catch { return 'generate'; }
  });
  useEffect(() => { try { sessionStorage.setItem('flashcards_active_tab', tab); } catch {} }, [tab]);
  const { toast } = useToast();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>("");
  const [confirmHasFeedPost, setConfirmHasFeedPost] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pendingActionRef = useRef<null | (() => void)>(null);
  const pendingResetRef = useRef<null | (() => void)>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Compute from context instead of duplicate listeners
  const plan = userData.profile.plan || 'free';
  const monthlyQuota = useMemo(() => {
    const rawQuota = Number(userData.profile.monthly_quota || 0);
    return rawQuota > 0 ? rawQuota : (plan === 'free' ? 5 : plan === 'basic' ? 50 : plan === 'advanced' ? 200 : plan === 'pro' ? 500 : 5);
  }, [userData.profile.monthly_quota, plan]);
  const wordLimit = useMemo(() => {
    const wl = userData.profile.word_limit;
    if (typeof wl === 'number') return wl;
    return plan === 'pro' ? 15000 : plan === 'advanced' ? 7000 : plan === 'basic' ? 5000 : 3000;
  }, [userData.profile.word_limit, plan]);
  const usesBlocked = useMemo(() => {
    const uses = Number(userData.counters.uses_this_month || 0);
    const extra = Number(userData.counters.extra_uses_balance || 0);
    return monthlyQuota > 0 ? (uses >= monthlyQuota && extra <= 0) : false;
  }, [userData.counters.uses_this_month, userData.counters.extra_uses_balance, monthlyQuota]);
  const reviewXpWindowStartRef = useRef<number>(0);
  const reviewXpCountRef = useRef<number>(0);
  const [, setPracticePoints] = useState<number>(0);
  const isBusy = loading || saving;
  const [crossOpen, setCrossOpen] = useState(false);
  const crossRef = useRef<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(() => {
    try { return localStorage.getItem('flashcards_manual_builder_open') === 'true'; } catch { return false; }
  });
  const [aiOpen, setAiOpen] = useState(() => {
    try { const saved = localStorage.getItem('flashcards_ai_generator_open'); return saved === null ? true : saved === 'true'; } catch { return true; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('flashcards_manual_builder_open', String(manualOpen));
      localStorage.setItem('flashcards_ai_generator_open', String(aiOpen));
    } catch {}
  }, [manualOpen, aiOpen]);
  const [manualCards, setManualCards] = useState<Array<{ question: string; answer: string }>>([{ question: "", answer: "" }]);
  const [, setFunFact] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  // Removed quiz creation UI/state

  
  // Removed cross-dispatch actions (quiz/summary/essay)

  useEffect(() => {
    loadFlashcardSets();
  }, [userId]);

  // Simulate generation progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
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
  }, [loading]);

  // Restore AI draft on mount (mobile resilience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('flashcards_draft');
      if (!raw) return;
      const d = JSON.parse(raw || '{}');
      let restored = false;
      if (typeof d.setTitle === 'string') { setSetTitle(d.setTitle); restored = true; }
      if (typeof d.text === 'string') { setText(d.text); restored = true; }
      if (typeof d.flashcardCount === 'number') { setFlashcardCount(d.flashcardCount); restored = true; }
      if (restored) { toast({ title: 'Draft restored', description: 'Recovered your previous inputs.' }); }
      localStorage.removeItem('flashcards_draft');
    } catch {}
  }, []);

  useEffect(() => {
    const onCross = (e: any) => {
      try {
        const detail = e?.detail || {};
        if (!detail || String(detail.type).toLowerCase() !== 'flashcards') return;
        const incoming = detail.payload || {};
        let srcText = String(incoming.text || '').trim();
        if (!srcText) {
          if (Array.isArray(incoming.cards) && incoming.cards.length) {
            srcText = (incoming.cards as Array<{front?:string;question?:string;back?:string;answer?:string}>)
              .map(c => `Q: ${String(c.front||c.question||'').trim()}\nA: ${String(c.back||c.answer||'').trim()}`)
              .join('\n\n');
          } else if (incoming.quiz && Array.isArray(incoming.quiz.questions)) {
            const qs = incoming.quiz.questions as Array<any>;
            srcText = qs.map(q => {
              const qtext = String(q.question || '').trim();
              const correct = q.options ? (q.options[q.correct_answer] || '') : (q.correct_answer || '');
              return `Q: ${qtext}\nA: ${String(correct).trim()}`;
            }).join('\n\n');
          }
        }
        if (!srcText) return;
        setTab('generate');
        setText(srcText);
        const titleHint = String(incoming?.meta?.title || incoming?.title || '').trim();
        if (titleHint) setSetTitle(titleHint.substring(0, 80));
        // Apply incoming options
        try {
          const cc = Number(incoming.cardCount);
          if ([5,10,15,20,25,30,40,50].includes(cc)) setFlashcardCount(cc);
        } catch {}
        crossRef.current = { from: detail.source || 'unknown', scope: detail.scope || 'all' };
        setCrossOpen(true);
      } catch {}
    };
    window.addEventListener('study-cross-action' as any, onCross as any);
    return () => window.removeEventListener('study-cross-action' as any, onCross as any);
  }, []);

  // REMOVED: Duplicate listeners - now using UserDataContext for counters and profile data

  useEffect(() => {
    if (!userId) return;
    startToolSession(userId, "flashcards");
    return () => { endToolSession(userId, "flashcards"); };
  }, [userId]);

  useNavGuard(unsavedChanges, (proceed, reset) => {
    pendingActionRef.current = proceed;
    pendingResetRef.current = reset;
    setLeaveOpen(true);
  });

  useEffect(() => {
    if (!unsavedChanges || isBusy) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedChanges && !isBusy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const captureLinkClicks = (ev: Event) => {
      if (!unsavedChanges || isBusy) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (anchor && anchor.href) {
        ev.preventDefault();
        pendingActionRef.current = () => { window.location.href = anchor.href; };
        setLeaveOpen(true);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("click", captureLinkClicks, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("click", captureLinkClicks, true);
    };
  }, [unsavedChanges, isBusy]);

  const loadFlashcardSets = async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoadingSets(true);
    try {
      const setsRef = collection(db, "users", userId, "flashcard_sets");
      const qSets = query(setsRef, orderBy("created_at", "desc"), limit(50));
      const snapSets = await getDocs(qSets);
      const sets: FlashcardSet[] = snapSets.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as FlashcardSet));
      setSavedSets(sets || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load flashcard sets",
        variant: "destructive",
      });
    } finally {
      if (!silent) setLoadingSets(false);
    }
  };

  // Expose refresh method to parent component
  useImperativeHandle(ref, () => ({
    refreshFlashcards: () => loadFlashcardSets(true)
  }));

  const requestDeleteSet = async (setId: string, title: string) => {
    setConfirmId(setId);
    setConfirmTitle(title || "this set");
    // Check if there's an associated feed post
    let hasFeedPost = false;
    try {
      const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", setId), where("ownerId", "==", userId), limit(1));
      const feedSnap = await getDocs(feedQuery);
      hasFeedPost = !feedSnap.empty;
    } catch {}
    setConfirmHasFeedPost(hasFeedPost);
    setConfirmOpen(true);
  };

  const handleRenameSet = async (setId: string, nextTitle: string) => {
    const next = nextTitle.trim();
    if (!next) return;
    try {
      await updateDoc(doc(db, "users", userId, "flashcard_sets", setId), {
        title: next.substring(0, 80),
      });
      // Optimistic update
      setSavedSets(prev => prev.map(s => s.id === setId ? { ...s, title: next.substring(0, 80) } : s));
      if (selectedSet?.id === setId) {
        setSelectedSet({ ...selectedSet, title: next.substring(0, 80) });
      }
      toast({
        title: "Success",
        description: "Flashcard set renamed",
      });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to rename set", variant: "destructive" });
    }
  };

  const openRename = (setObj: FlashcardSet) => {
    setRenameId(setObj.id);
    setRenameTitle(setObj.title || "");
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!renameId) return;
    await handleRenameSet(renameId, renameTitle);
    setRenameOpen(false);
  };

  // Removed quiz creation

  
  
  // Removed QuickQuizButton

  const { showAnimation: showUsageAnim, triggerAnimation: triggerUsageAnim } = useUsageAnimation();

  const handleGenerate = async () => {
    if (importingFile) {
      toast({ title: "Still reading file", description: "Please wait for the file to finish importing.", variant: "destructive" });
      return;
    }
    if (!setTitle.trim()) {
      toast({
        title: "Title required",
        description: "Please enter a title before generating flashcards",
        variant: "destructive",
      });
      return;
    }
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Please enter some text to generate flashcards",
        variant: "destructive",
      });
      return;
    }

    // Local short-context guard for large counts
    const wordCount = (text || "").trim().split(/\s+/).filter(Boolean).length;
    if (flashcardCount >= 30 && wordCount < 5) {
      toast({ title: "Context too short", description: "Please provide a bit more content for 30+ flashcards.", variant: "destructive" });
      return;
    }

    // Persist draft prior to generate
    try { localStorage.setItem('flashcards_draft', JSON.stringify({ setTitle, text, flashcardCount })); } catch {}
    setFunFact(getRandomFunFact());
    setLoading(true);
    setUnsavedChanges(true);
    setFlashcards([]);

    try {
      const collected: Flashcard[] = [];
      const seen = new Set<string>();
      let tries = 0;
            while (collected.length < flashcardCount && tries < 3) {
        const remaining = Math.max(1, flashcardCount - collected.length);
        const perRequest = Math.min(remaining, 25);
        const resp = await fetch(`${API_BASE}/generate-flashcards`, {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({ text, flashcardCount: perRequest, userId }) // Server tracks usage
        });
        let data: any = null;
        try { data = await resp.json(); } catch {}
        if (!resp.ok || (data && data.error)) {
          if (resp.status === 400 && (data?.error === 'context_too_short')) {
            throw new Error('Context too short for the requested number of flashcards. Please add more content.');
          }
          if (resp.status === 403) {
            toast({ title: 'Limit reached', description: (data?.error || 'You have reached your monthly limit.'), variant: 'destructive' });
            break;
          }
          throw new Error((data && (data.error || data.message)) || resp.statusText || "Failed to generate flashcards");
        }
        // Usage is now tracked server-side
        const list: Flashcard[] = Array.isArray(data.flashcards) ? data.flashcards : [];
        for (const fc of list) {
          const key = `${(fc.question||"").toLowerCase().trim()}::${(fc.answer||"").toLowerCase().trim()}`;
          if (!seen.has(key) && fc.question && fc.answer) {
            seen.add(key);
            collected.push({ question: fc.question, answer: fc.answer });
            if (collected.length >= flashcardCount) break;
          }
        }
        tries++;
        if (!list.length) break;
      }

      if (collected.length < flashcardCount) {
        const variants: Flashcard[] = [];
        let vIndex = 1;
        while (collected.length + variants.length < flashcardCount && collected.length > 0) {
          const base = collected[(collected.length + variants.length) % collected.length];
          const q = `${base.question} (variant ${vIndex})`;
          const a = base.answer;
          const key = `${q.toLowerCase().trim()}::${a.toLowerCase().trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            variants.push({ question: q, answer: a });
          }
          vIndex++;
          if (vIndex > flashcardCount * 2) break;
        }

        const finalCards = [...collected, ...variants].slice(0, flashcardCount);
        if (finalCards.length < flashcardCount) {
          toast({ title: "Max cards available", description: `Only ${finalCards.length} of ${flashcardCount} flashcards could be produced from the provided content.` });
        } else {
          toast({ title: "Filled with variants", description: `Some flashcards were varied to reach ${flashcardCount}.` });
        }
        setFlashcards(finalCards);
      } else {
        setFlashcards(collected.slice(0, flashcardCount));
        toast({ title: "Success", description: `Prepared ${flashcardCount} flashcards!` });
      }
      setUnsavedChanges(true);

      try {
        const toWrite = (collected.length < flashcardCount ? collected : collected.slice(0, flashcardCount));
        const setDocRef = await addDoc(collection(db, "users", userId, "flashcard_sets"), {
          title: setTitle,
          description: text.substring(0, 100),
          created_at: serverTimestamp(),
          total_count: toWrite.length,
          mastered_ids: [],
          mastered_count: 0,
        });
        const batch = writeBatch(db);
        for (const fc of toWrite) {
          const fRef = doc(collection(db, "users", userId, "flashcard_sets", setDocRef.id, "flashcards"));
          batch.set(fRef, {
            question: fc.question,
            answer: fc.answer,
            created_at: serverTimestamp(),
          });
        }
        await batch.commit();
        toast({ title: "Saved", description: "Flashcard set saved automatically" });
        try { await awardActionXP(userId, 'flashcards', { cardCount: toWrite.length }); } catch {}
        // Track flashcard set creation for weekly goals
        try { await incrementCounter(userId, 'flashcards'); } catch {}
        try { await recordDailyVisit(userId); } catch {}
        setUnsavedChanges(false);
        setText("");
        setFlashcards([]);
        try { localStorage.removeItem('flashcards_draft'); } catch {}
        // Auto-open the newly created set
        try {
          await openSetById({ id: setDocRef.id, title: setTitle, created_at: new Date().toISOString() } as any);
        } catch {}
        await loadFlashcardSets();
        try {
          const setsRef = collection(db, "users", userId, "flashcard_sets");
          const sSnap = await getDocs(setsRef);
          if (sSnap.size === 1) { try { await awardAchievement(userId, 'first_flashcards'); } catch {} }
          if (sSnap.size === 5) { try { await awardAchievement(userId, 'flashcard_sets_5'); } catch {} }
        } catch {}
      } catch (e: any) {
        toast({ title: "Save failed", description: e?.message || "Could not save flashcards", variant: "destructive" });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate flashcards",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  
  const handleDeleteSet = async (setId: string) => {
    // Optimistic: remove from UI instantly, restore on failure
    const prevSets = savedSets;
    setSavedSets(prev => prev.filter(s => s.id !== setId));
    if (selectedSet?.id === setId) {
      setSelectedSet(null);
    }
    try {
      const fRef = collection(db, "users", userId, "flashcard_sets", setId, "flashcards");
      const fSnap = await getDocs(fRef);
      
      // Use batch delete for all flashcards + set (reduces network overhead)
      const batch = writeBatch(db);
      fSnap.docs.forEach((d) => {
        batch.delete(doc(db, "users", userId, "flashcard_sets", setId, "flashcards", d.id));
      });
      batch.delete(doc(db, "users", userId, "flashcard_sets", setId));
      await batch.commit();

      // Delete associated feed post if exists
      try {
        const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", setId), where("ownerId", "==", userId), limit(1));
        const feedSnap = await getDocs(feedQuery);
        for (const feedDoc of feedSnap.docs) {
          await Promise.all(['reactions', 'comments', 'runs'].map(async (sub) => {
            const subSnap = await getDocs(collection(db, "feed_posts", feedDoc.id, sub));
            await Promise.all(subSnap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
          }));
          await deleteDoc(feedDoc.ref);
        }
      } catch {}

      toast({
        title: "Success",
        description: "Flashcard set deleted",
      });
    } catch (error: any) {
      setSavedSets(prevSets);
      toast({
        title: "Error",
        description: error.message || "Failed to delete flashcard set",
        variant: "destructive",
      });
    }
  };

  const toggleSetSelection = (id: string) => {
    setSelectedSets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteSets = async () => {
    if (selectedSets.size === 0) return;
    try {
      setSaving(true);
      const batch = writeBatch(db);
      
      for (const setId of selectedSets) {
        // Get flashcards for each set
        try {
          const fRef = collection(db, "users", userId, "flashcard_sets", setId, "flashcards");
          const fSnap = await getDocs(fRef);
          fSnap.docs.forEach(d => batch.delete(doc(db, "users", userId, "flashcard_sets", setId, "flashcards", d.id)));
        } catch {}
        // Delete set
        batch.delete(doc(db, "users", userId, "flashcard_sets", setId));
      }
      
      await batch.commit();
      
      // Update UI
      setSavedSets(prev => prev.filter(s => !selectedSets.has(s.id)));
      if (selectedSet && selectedSets.has(selectedSet.id)) {
        setSelectedSet(null);
      }
      
      toast({ title: "Success", description: `Deleted ${selectedSets.size} flashcard set${selectedSets.size === 1 ? '' : 's'}` });
      setSelectedSets(new Set());
      setSelectionMode(false);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to delete sets", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openSetById = async (set: FlashcardSet) => {
    try {
      const fRef = collection(db, "users", userId, "flashcard_sets", set.id, "flashcards");
      const fSnap = await getDocs(fRef);
      const cards = fSnap.docs.map((fd) => ({ id: fd.id, ...(fd.data() as any) })) as SavedFlashcard[];
      const total = (set as any).total_count ?? cards.length;
      const masteredCount = Array.isArray((set as any).mastered_ids) ? (set as any).mastered_ids.length : (typeof (set as any).mastered_count === 'number' ? (set as any).mastered_count : 0);
      setSelectedSet({ ...set, flashcards: cards, total_count: total, mastered_count: masteredCount } as any);
      
      try {
        const updates: any = {};
        if ((set as any).total_count == null) updates.total_count = cards.length;
        const trueMastered = Array.isArray((set as any).mastered_ids) ? (set as any).mastered_ids.length : (typeof (set as any).mastered_count === 'number' ? (set as any).mastered_count : 0);
        if ((set as any).mastered_count == null && Array.isArray((set as any).mastered_ids)) updates.mastered_count = trueMastered;
        else if (typeof (set as any).mastered_count === 'number' && Array.isArray((set as any).mastered_ids) && (set as any).mastered_count !== trueMastered) updates.mastered_count = trueMastered;
        if (Object.keys(updates).length > 0) {
          await updateDoc(doc(db, "users", userId, "flashcard_sets", set.id), updates);
          setSavedSets(prev => prev.map(s => s.id === set.id ? ({...s, ...updates} as any) : s));
        }
      } catch {}
      setTab("library");
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to load flashcards", variant: "destructive" });
    }
  };

  return (
    <div className="max-w-7xl mx-auto relative px-3 md:px-0 overflow-x-hidden md:overflow-x-auto" aria-busy={loading}>
      <LoadingOverlay open={loading} title="Working…" subtitle="This may take up to a minute or two. Please don't refresh." progress={loading ? generationProgress : undefined} />
      
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
            <div className="flex items-center justify-between mb-2 sticky top-0 z-[90] bg-background/95 backdrop-blur py-2 pointer-events-auto">
              <div>
                <h3 className="text-lg font-semibold">Recent Flashcards</h3>
                <p className="text-xs text-muted-foreground">{savedSets.length} set{savedSets.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTab('generate'); setManualOpen(true); setAiOpen(false); setSidebarOpen(false); }}
                  aria-label="New flashcard set"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div>
              {loadingSets ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedSets.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No flashcards yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedSets.slice(0, 10).map((set) => (
                    <div key={set.id} className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedSet?.id === set.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}>
                      <button
                        onClick={() => {
                          const run = () => { openSetById(set); setSidebarOpen(false); };
                          if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="font-medium text-sm truncate" title={set.title}>{set.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(((set as any).total_count) ?? (set.flashcards?.length || 0))} cards • Mastered: {(((set as any).mastered_count) ?? (set.mastered_ids?.length || 0))}
                          {(set.savedFrom === "feed" || set.savedFrom === "challenge") && set.originalCreator && (
                            <span className="block text-xs text-muted-foreground mt-1">
                              saved from feed, made by @{set.originalCreator}
                            </span>
                          )}
                        </p>
                      </button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); openRename(set); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); requestDeleteSet(set.id, set.title); }}>
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
        {/* Recent Flashcards Sidebar */}
        <div className="hidden md:block w-64 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Flashcards</CardTitle>
              <CardDescription>{savedSets.length} set{savedSets.length === 1 ? '' : 's'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSets ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : savedSets.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No flashcards yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedSets.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedSet?.id === s.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        const run = () => { setTab('library'); openSetById(s); };
                        if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                      }}
                      role="button"
                    >
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={s.title}>{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(s.savedFrom === "feed" || s.savedFrom === "challenge") && s.originalCreator ? (
                            <span className="block">saved from feed, made by @{s.originalCreator}</span>
                          ) : null}
                          {(((s as any).total_count) ?? (s.flashcards?.length || 0))} cards • Mastered: {(((s as any).mastered_count) ?? (s.mastered_ids?.length || 0))}
                        </p>
                      </div>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openRename(s); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); requestDeleteSet(s.id, s.title); }}>
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
        <div className="flex-1">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              const run = () => setTab(v);
              if (unsavedChanges) {
                pendingActionRef.current = run;
                setLeaveOpen(true);
              } else {
                run();
              }
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2" data-tour="flashcards-tabs">
              <TabsTrigger value="generate">
                <Plus className="w-4 h-4 mr-2" />
                Create
              </TabsTrigger>
              <TabsTrigger value="library" data-tour="flashcards-saved-tab">
                <BookOpen className="w-4 h-4 mr-2" />
                My Flashcards
              </TabsTrigger>
            </TabsList>

            <TabsContent value="generate" className="space-y-6 mt-6">
              <Card data-tour="flashcards-manual" className="border-primary/40 bg-primary/5 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2"><Pencil className="h-5 w-5" /> Create your own flashcards</span>
                    <Button type="button" variant={manualOpen ? "outline" : "default"} size="sm" onClick={() => setManualOpen(prev => { const next = !prev; setAiOpen(!next); return next; })}>{manualOpen ? 'Hide builder' : 'Create manually'}</Button>
                  </CardTitle>
                  <CardDescription>Your words, your study set. Add your own questions and answers, then study or share them in the feed.</CardDescription>
                </CardHeader>
                {manualOpen && (
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Flashcard Set Title</Label>
                        <Input value={setTitle} onChange={(e)=> setSetTitle(e.target.value)} placeholder="e.g., Custom Practice Set" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Questions</Label>
                        <div className="text-xs text-muted-foreground">Write a question on the front and its answer on the back.</div>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      {manualCards.map((c, idx) => (
                        <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Question</Label>
                            <Input value={c.question} onChange={(e)=>{
                              const v=[...manualCards]; v[idx]={...v[idx], question:e.target.value}; setManualCards(v);
                            }} placeholder={`Question ${idx+1}`} />
                          </div>
                          <div>
                            <Label className="text-xs">Answer</Label>
                            <Input value={c.answer} onChange={(e)=>{
                              const v=[...manualCards]; v[idx]={...v[idx], answer:e.target.value}; setManualCards(v);
                            }} placeholder={`Answer ${idx+1}`} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={()=> setManualCards(prev => [...prev, { question: "", answer: "" }])}>Add Card</Button>
                      {manualCards.length>1 && (
                        <Button type="button" variant="outline" size="sm" onClick={()=> setManualCards(prev => prev.slice(0,-1))}>Remove Last</Button>
                      )}
                      <Button type="button" size="sm" disabled={saving} onClick={async ()=>{
                        if (saving) return;
                        const items = manualCards.filter(c=>c.question.trim()&&c.answer.trim());
                        if (!setTitle.trim()) { toast({ title:'Title required', variant:'destructive' }); return; }
                        if (!items.length) { toast({ title:'Add at least one card', variant:'destructive' }); return; }
                        if (items.length !== manualCards.length) { toast({ title:'Complete every card', description:'Add a question and answer to each card, or remove unfinished cards.', variant:'destructive' }); return; }
                        try {
                          setSaving(true);
                          const setRef = await addDoc(collection(db, 'users', userId, 'flashcard_sets'), {
                            title: setTitle,
                            description: text.substring(0,100),
                            created_at: serverTimestamp(),
                            total_count: items.length,
                            mastered_ids: [],
                            mastered_count: 0,
                          });
                          const batch = writeBatch(db);
                          for (const it of items) {
                            const fRef = doc(collection(db, 'users', userId, 'flashcard_sets', setRef.id, 'flashcards'));
                            batch.set(fRef, { question: it.question, answer: it.answer, created_at: serverTimestamp() });
                          }
                          await batch.commit();
                          // Open the newly created set so cards are visible immediately
                          await openSetById({ id: setRef.id, title: setTitle, description: text.substring(0,100), created_at: new Date().toISOString() } as any);
                          await loadFlashcardSets();
                          toast({ title:'Saved', description:'Manual flashcards saved' });
                        } catch (e:any) { toast({ title:'Save failed', description:e?.message||'Could not save', variant:'destructive' }); } finally { setSaving(false); }
                      }}>{saving ? 'Saving...' : 'Save & Study'}</Button>
                    </div>
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Layers className="w-5 h-5" />
                      AI Flashcard Generator
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={()=> setAiOpen(prev => { const next = !prev; if (next) setManualOpen(false); return next; })}>{aiOpen ? 'Hide' : 'Open'}</Button>
                  </CardTitle>
                  <CardDescription>
                    Input your study material and we'll create flashcards for you
                  </CardDescription>
                </CardHeader>
                {aiOpen && (
                <CardContent className="space-y-4">
                  {usesBlocked && (
                    <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive rounded flex items-center justify-between">
                      <div>
                        <div className="font-semibold">Monthly limit reached</div>
                        <p className="text-xs mt-0.5 opacity-80">You've used all your AI generations this month. Upgrade or wait for reset.</p>
                      </div>
                      <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => window.location.href = '/account'}>
                        Upgrade
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Flashcard Set Title</Label>
                      <Input
                        value={setTitle}
                        onFocus={()=> { setManualOpen(false); setAiOpen(true); }}
                        onChange={(e) => { if (loading) return; setSetTitle(e.target.value); }}
                        placeholder="e.g., Biology Chapter 3"
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Number of Flashcards</Label>
                      <Select value={flashcardCount.toString()} onValueChange={(v) => { if (loading) return; setAiOpen(true); setManualOpen(false); setFlashcardCount(parseInt(v)); }} disabled={loading}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5</SelectItem>
                          <SelectItem value="10">10</SelectItem>
                          <SelectItem value="15">15</SelectItem>
                          <SelectItem value="20">20</SelectItem>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="30">30</SelectItem>
                          <SelectItem value="40">40</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Study Material</Label>
                    <div className="relative">
                      <Textarea
                        value={text}
                        data-tour="flashcards-input"
                        onChange={(e) => {
                          if (loading) return;
                          const prev = text;
                          const raw = e.target.value;
                          const sanitized = raw
                            .split(/\s+/)
                            .map(t => t.length > 50 ? t.slice(0, 50) : t)
                            .join(' ');
                          const words = sanitized.trim().length ? sanitized.trim().split(/\s+/) : [] as string[];
                          if (sanitized.length <= prev.length) { setText(sanitized); return; }
                          if (words.length > wordLimit) {
                            setText(words.slice(0, wordLimit).join(' '));
                            return;
                          }
                          setText(sanitized);
                        }}
                        onFocus={()=> { setManualOpen(false); setAiOpen(true); }}
                        placeholder="Paste your notes, textbook content, or any material you want to study..."
                        className="min-h[200px] pr-16"
                        disabled={usesBlocked || loading || importingFile}
                      />
                      <div className="pointer-events-none absolute bottom-1.5 right-2 text-[11px] text-muted-foreground bg-background/70 px-1 rounded">
                        {Math.min(text.trim().split(/\s+/).filter(Boolean).length, wordLimit)} / {wordLimit}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        type="file"
                        accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget;
                          if (loading || importingFile) { inputEl.value = ""; return; }
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setImportingFile(true);
                          try {
                            const extracted = await extractTextFromFile(f);
                            const val = (extracted || "");
                            const words = val.trim().split(/\s+/).filter(Boolean);
                            setText(words.slice(0, wordLimit).join(' '));
                            toast({ title: "Imported", description: `Loaded ${f.name}` });
                            try { await incrementCounterAndMaybeAward(userId, 'uploads_count', 10, 'uploads_10'); } catch {}
                          } catch (err: any) {
                            toast({ title: "Error", description: err?.message || "Failed to read file", variant: "destructive" });
                          } finally {
                            setImportingFile(false);
                            inputEl.value = "";
                          }
                        }}
                        onFocus={()=> { setManualOpen(false); setAiOpen(true); }}
                        disabled={usesBlocked || loading || importingFile}
                      />
                      {importingFile && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading file…
                        </span>
                      )}
                      <Button variant="outline" size="sm" type="button" onClick={() => setPickerOpen(true)}>Create from…</Button>
                    </div>
                  </div>

                  <div className="relative">
                  <UsageAnimation show={showUsageAnim} />
                  <Button type="button" onClick={() => { triggerUsageAnim(); setManualOpen(false); setAiOpen(true); handleGenerate(); }} disabled={loading || importingFile || !text.trim() || usesBlocked} className="w-full" data-tour="flashcards-generate">
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating Flashcards...
                      </>
                    ) : usesBlocked ? (
                      <><X className="w-4 h-4 mr-2" />Monthly limit reached</>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Generate
                      </>
                    )}
                  </Button>
                  </div>
                </CardContent>
                )}
              </Card>

              {/* Cross-action confirm dialog */}
              <Dialog open={crossOpen} onOpenChange={setCrossOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Flashcards from incoming content?</DialogTitle>
                  </DialogHeader>
                  <div className="text-sm text-muted-foreground">This will generate a flashcard set from the provided source.</div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCrossOpen(false)}>Cancel</Button>
                    <Button onClick={() => { setCrossOpen(false); try { handleGenerate(); } catch {} }}>Generate</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {flashcards.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Generated Flashcards ({flashcards.length})</CardTitle>
                    <CardDescription>Your set has been saved automatically</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {flashcards.map((card, index) => (
                      <Card key={index} className="border-l-4 border-l-primary">
                        <CardContent className="pt-6">
                          <div className="space-y-2">
                            <div>
                              <Label className="text-xs text-muted-foreground">Question</Label>
                              <div className="prose prose-sm dark:prose-invert max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(String(card.question || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Answer</Label>
                              <div className="prose prose-sm dark:prose-invert max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(String(card.answer || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="library" className="space-y-6 mt-6">
              {selectedSet ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-2xl font-bold">{selectedSet.title}</h3>
                      <p className="text-muted-foreground">{selectedSet.description || ""}</p>
                      <p className="text-sm text-muted-foreground">
                        Mastered: {(selectedSet.mastered_ids?.length || 0)} / {((selectedSet as any).total_count ?? (selectedSet.flashcards?.length || 0))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                      <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setSelectedSet(null); try { loadFlashcardSets(); } catch {} }}>
                        Back to Library
                      </Button>
                      {/* Quiz/Summary actions removed */}
                    </div>
                  </div>

                  <FlashcardViewer 
                    cards={(selectedSet.flashcards || []).map(fc => ({
                      id: fc.id,
                      question: fc.question,
                      answer: fc.answer
                    }))}
                    mastered={Object.fromEntries((selectedSet.mastered_ids || []).map(id => [id, true]))}
                    onToggleMastered={async (id, next) => {
                      try {
                        const setRef = doc(db, "users", userId, "flashcard_sets", selectedSet.id);
                        if (next) {
                          await updateDoc(setRef, { mastered_ids: arrayUnion(id) });
                          const nextMastered = [ ...(selectedSet.mastered_ids||[]), id ];
                          setSelectedSet({ ...selectedSet, mastered_ids: nextMastered, mastered_count: nextMastered.length } as any);
                          try { await updateDoc(setRef, { mastered_count: nextMastered.length }); } catch {}
                          const total = ((selectedSet as any).total_count ?? (selectedSet.flashcards?.length || 0));
                          const alreadyAwarded = (selectedSet as any).mastered_awarded === true;
                          if (total > 0 && nextMastered.length >= total && !alreadyAwarded) {
                            try { await addXP(userId, 20); } catch {}
                            try { await awardAchievement(userId, 'flashcard_master'); } catch {}
                            try { await updateDoc(setRef, { mastered_awarded: true }); } catch {}
                          }
                        } else {
                          await updateDoc(setRef, { mastered_ids: arrayRemove(id) });
                          const nextMastered = (selectedSet.mastered_ids||[]).filter(x => x !== id);
                          setSelectedSet({ ...selectedSet, mastered_ids: nextMastered, mastered_count: nextMastered.length } as any);
                          try { await updateDoc(setRef, { mastered_count: nextMastered.length }); } catch {}
                        }
                        setSavedSets(prev => prev.map(s => s.id === selectedSet.id ? { ...s, mastered_ids: (next ? [ ...(s.mastered_ids||[]), id ] : (s.mastered_ids||[]).filter(x => x!==id)), mastered_count: (next ? ((s as any).mastered_count ?? (s.mastered_ids?.length||0)) + 1 : ((s as any).mastered_count ?? (s.mastered_ids?.length||0)) - 1) } as any : s));
                      } catch (e: any) {
                        toast({ title: "Error", description: e.message || "Failed to update mastered", variant: "destructive" });
                      }
                    }}
                    onReviewed={async () => {
                      try { await incrementCounterAndMaybeAward(userId, 'flashcards_review_count', 500, 'flashcards_review_500'); } catch {}
                      try {
                        const now = Date.now();
                        const windowMs = 60_000;
                        const cap = 5;
                        if (now - reviewXpWindowStartRef.current > windowMs) {
                          reviewXpWindowStartRef.current = now;
                          reviewXpCountRef.current = 0;
                        }
                        if (reviewXpCountRef.current < cap) {
                          await addXP(userId, 1);
                          reviewXpCountRef.current += 1;
                        }
                      } catch {}
                    }}
                    onScored={(pts) => setPracticePoints((p) => p + (Number(pts) || 0))}
                  />
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Your Flashcard Sets</span>
                      {!selectionMode ? (
                        <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                          <CheckSquare className="w-4 h-4 mr-2" />
                          Select Multiple
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => {
                            if (selectedSets.size === savedSets.length) {
                              setSelectedSets(new Set());
                            } else {
                              setSelectedSets(new Set(savedSets.map(s => s.id)));
                            }
                          }}>
                            {selectedSets.size === savedSets.length ? 'Deselect All' : 'Select All'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => {
                            setSelectionMode(false);
                            setSelectedSets(new Set());
                          }}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {savedSets.length} saved flashcard {savedSets.length === 1 ? 'set' : 'sets'}
                      {selectionMode && selectedSets.size > 0 && ` • ${selectedSets.size} selected`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingSets ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin" />
                      </div>
                    ) : savedSets.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No flashcard sets yet. Generate some flashcards to get started!
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {savedSets.map((set) => (
                          <div
                            key={set.id}
                            className="group p-3 border rounded-lg bg-background transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm ring-1 ring-transparent hover:ring-2 hover:ring-primary/40 cursor-pointer"
                            onClick={() => {
                              if (selectionMode) {
                                toggleSetSelection(set.id);
                              } else {
                                openSetById(set);
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
                                    toggleSetSelection(set.id);
                                  }}
                                >
                                  {selectedSets.has(set.id) ? (
                                    <CheckSquare className="w-5 h-5 text-primary" />
                                  ) : (
                                    <Square className="w-5 h-5" />
                                  )}
                                </Button>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium break-words" title={set.title}>{set.title.length > 30 ? set.title.slice(0, 30) + '...' : set.title}</div>
                                    <Badge variant="outline" className="capitalize mt-1 inline-block">flashcards</Badge>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {(((set as any).total_count) ?? (set.flashcards?.length || 0))} cards • Mastered: {(((set as any).mastered_count) ?? (set.mastered_ids?.length || 0))}
                                      {(set.savedFrom === "feed" || set.savedFrom === "challenge") && set.originalCreator && (
                                        <span className="block mt-1">
                                          saved from feed, made by @{set.originalCreator}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {!selectionMode && (
                                    <div className="flex flex-col sm:flex-row items-center gap-1 flex-shrink-0">
                                      <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={(e) => { e.stopPropagation(); openSetById(set); }}>
                                        <Eye className="w-4 h-4 mr-1" /> View
                                      </Button>
                                      <div className="flex gap-1">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); openRename(set); }} aria-label="Rename">
                                          <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); requestDeleteSet(set.id, set.title); }} aria-label="Delete">
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
                    )}
                  </CardContent>
                </Card>
                
              )}
              
              {/* Floating Action Bar for bulk delete */}
              {selectionMode && selectedSets.size > 0 && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
                  <Card className="shadow-lg border-2">
                    <CardContent className="p-4 flex items-center gap-4">
                      <span className="font-medium">{selectedSets.size} set{selectedSets.size === 1 ? '' : 's'} selected</span>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setConfirmId("bulk");
                          setConfirmTitle(`${selectedSets.size} flashcard set${selectedSets.size === 1 ? '' : 's'}`);
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
      
      {/* Enhanced Dialogs */}
      <CrossCreatePicker 
        userId={userId} 
        open={pickerOpen} 
        onOpenChange={setPickerOpen} 
        initialTab="flashcards"
        allowedTabs={["chat","summary","flashcards","quizzes","plans"]}
      />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Flashcard Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Set title" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={saveRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmId === "bulk" ? "Delete Multiple Flashcard Sets?" : "Delete Flashcard Set?"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <p>You can't undo this action.</p>
            <p className="text-sm text-muted-foreground truncate">{confirmTitle}</p>
            {confirmHasFeedPost && confirmId !== "bulk" && (
              <p className="text-sm text-destructive font-medium mt-2">⚠️ This will also delete the associated feed post.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>No, keep {confirmId === "bulk" ? "them" : "it"}</Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                if (confirmId === "bulk") {
                  await bulkDeleteSets();
                } else if (confirmId) {
                  await handleDeleteSet(confirmId);
                  setConfirmOpen(false);
                }
              }}
            >
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</> : 'Yes, delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
