import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useMemo } from "react";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import { useUserData } from "@/contexts/UserDataContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { db } from "../../../firebase";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";
import { collection, addDoc, getDocs, deleteDoc, doc, orderBy, query, where, updateDoc, writeBatch, limit } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, FileText, BookOpen, Trash2, Eye, Pencil, Menu, X, Plus, Play,
  Download, Copy,
  FileUp, Gauge, Square, CheckSquare, ChevronDown, ChevronRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { extractTextFromFile } from "@/lib/extractTextFromFile";
import { startToolSession, endToolSession } from "@/lib/session";
import { awardActionXP, incrementCounter, recordDailyVisit } from "@/lib/achievements";
import { Badge } from "@/components/ui/badge";
import { CrossCreatePicker } from "@/components/CrossCreatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getRandomFunFact } from "@/lib/funFacts";
import LoadingOverlay from "@/components/LoadingOverlay";
import { downloadPDF, generateSummaryPDFHTML } from "@/lib/pdf-utils";

interface SavedSummary {
  id: string;
  title: string;
  original_text: string;
  summary_text: string;
  summary_type: string;
  created_at: string;
  word_count?: number;
  reading_time?: number;
  originalCreator?: string;
  savedFrom?: string;
}


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

// Helper to format summary type for display (e.g., "key_points" -> "Key Points")
const formatSummaryType = (type: string) => {
  if (!type) return '';
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// Helper to normalize math delimiters for KaTeX
const normalizeForMath = (s: string) => {
  let out = s || "";
  out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
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
  
  // Process line by line to add visual separators before numbered sections
  const lines = out.split("\n");
  const result: string[] = [];
  const sectionPattern = /^(\d+(?:\.\d+)*[\.\)])\s+([A-Za-z].*)$/;
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

export const StudySummarizer = forwardRef<{ refreshSummaries: () => void }, { userId: string }>(({ userId }, ref) => {
  // Use centralized context for user data (eliminates duplicate listeners)
  const userData = useUserData();
  const [text, setText] = useState("");
  const [summaryType, setSummaryType] = useState<"brief" | "detailed" | "notes" | "key_points" | "academic">("brief");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [savedSummaries, setSavedSummaries] = useState<SavedSummary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<SavedSummary | null>(null);
  const [originalTextCollapsed, setOriginalTextCollapsed] = useState(true); // Collapsed by default
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [tab, setTab] = useState<string>(() => {
    try { return sessionStorage.getItem('summarizer_active_tab') || 'create'; } catch { return 'create'; }
  });
  useEffect(() => { try { sessionStorage.setItem('summarizer_active_tab', tab); } catch {} }, [tab]);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pendingActionRef = useRef<null | (() => void)>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>("");
  const [confirmHasFeedPost, setConfirmHasFeedPost] = useState(false);
  const { toast } = useToast();
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
  const [autoSave] = useState(true);
  const [summaryTitle, setSummaryTitle] = useState<string>("");
  const [readingLevel, setReadingLevel] = useState<"simple" | "standard" | "advanced">("standard");
  const [includeKeyPoints, setIncludeKeyPoints] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const isBusy = loading || isGenerating;
  
  const [, setCrossOpen] = useState(false);
  const crossPayloadRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSummaries, setSelectedSummaries] = useState<Set<string>>(new Set());
  const [, setFunFact] = useState<string | null>(null);
  const [downloadChoiceOpen, setDownloadChoiceOpen] = useState(false);
  const [pendingDownloadSummary, setPendingDownloadSummary] = useState<SavedSummary | null>(null);

  useEffect(() => {
    loadSummaries();
  }, [userId]);

  // Restore draft on mount (mobile resilience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('summarizer_draft');
      if (!raw) return;
      const d = JSON.parse(raw || '{}');
      let restored = false;
      if (typeof d.summaryTitle === 'string') { setSummaryTitle(d.summaryTitle); restored = true; }
      if (typeof d.text === 'string') { setText(d.text); restored = true; }
      if (d.summaryType && ['brief','detailed','notes','key_points','academic'].includes(d.summaryType)) { setSummaryType(d.summaryType); restored = true; }
      if (d.readingLevel && ['simple','standard','advanced'].includes(d.readingLevel)) { setReadingLevel(d.readingLevel); restored = true; }
      if (typeof d.includeKeyPoints === 'boolean') { setIncludeKeyPoints(!!d.includeKeyPoints); restored = true; }
      if (restored) { toast({ title: 'Draft restored', description: 'Recovered your previous inputs.' }); }
      localStorage.removeItem('summarizer_draft');
    } catch {}
  }, []);

  // Listen for cross-actions (create summary from other tools)
  useEffect(() => {
    const onCross = (e: any) => {
      try {
        const detail = e?.detail || {};
        if (!detail || String(detail.type).toLowerCase() !== 'summary') return;
        const incoming = detail.payload || {};
        const srcText = String(incoming.text || '').trim();
        if (!srcText) return;
        // Prefill inputs
        setText(srcText);
        const titleHint = String(incoming?.meta?.title || incoming?.title || '').trim();
        if (titleHint) setSummaryTitle(titleHint.substring(0, 80));
        // Apply incoming options
        try {
          const t = String(incoming.summaryType || '').toLowerCase();
          if (t === 'brief' || t === 'detailed' || t === 'notes' || t === 'key_points' || t === 'academic') setSummaryType(t as any);
          const rl = String(incoming.readingLevel || '').toLowerCase();
          if (rl === 'simple' || rl === 'standard' || rl === 'advanced') setReadingLevel(rl as any);
          if (typeof incoming.includeKeyPoints === 'boolean') setIncludeKeyPoints(!!incoming.includeKeyPoints);
        } catch {}
        // Open confirm
        crossPayloadRef.current = { from: detail.source || 'unknown', scope: detail.scope || 'all' };
        setCrossOpen(true);
      } catch {}
    };
    window.addEventListener('study-cross-action' as any, onCross as any);
    return () => window.removeEventListener('study-cross-action' as any, onCross as any);
  }, []);

  
  
  // REMOVED: Duplicate listeners - now using UserDataContext for profile and counters data

  // Track session duration
  useEffect(() => {
    if (!userId) return;
    startToolSession(userId, "summarizer");
    return () => { endToolSession(userId, "summarizer"); };
  }, [userId]);

  // Enhanced beforeunload handler (disabled while busy to avoid iOS Safari quirks)
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

  // Simulate generation progress
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating) {
      const estimatedSeconds = 30;
      const incrementPerSecond = 85 / estimatedSeconds;
      
      interval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev >= 85) {
            // Slow crawl after 85% to avoid appearing stuck
            if (prev >= 95) return 95;
            return prev + 0.5;
          }
          return Math.min(85, prev + incrementPerSecond);
        });
      }, 1000);
    } else {
      setGenerationProgress(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const loadSummaries = async (silent = false) => {
    if (!silent) setLoadingSummaries(true);
    try {
      const summariesRef = collection(db, "users", userId, "summaries");
      // OPTIMIZED: Limit to 50 most recent summaries to reduce reads
      const q = query(summariesRef, orderBy("created_at", "desc"), limit(50));
      const snapshot = await getDocs(q);
      const summaries: SavedSummary[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      } as SavedSummary)).filter((s) => s.summary_type !== 'transcript');
      setSavedSummaries(summaries);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load summaries",
        variant: "destructive",
      });
    } finally {
      if (!silent) setLoadingSummaries(false);
    }
  };

  // Expose refresh method to parent component
  useImperativeHandle(ref, () => ({
    refreshSummaries: () => loadSummaries(true)
  }));

  const requestDeleteSummary = async (id: string, title: string) => {
    setConfirmId(id);
    setConfirmTitle(title || "this summary");
    // Check if there's an associated feed post
    let hasFeedPost = false;
    try {
      const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", id), where("ownerId", "==", userId), limit(1));
      const feedSnap = await getDocs(feedQuery);
      hasFeedPost = !feedSnap.empty;
    } catch {}
    setConfirmHasFeedPost(hasFeedPost);
    setConfirmOpen(true);
  };

  const openRename = (s: SavedSummary) => {
    setRenamingId(s.id);
    setRenameTitle(s.title);
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!renamingId) return;
    const next = renameTitle.trim();
    if (!next) return;
    try {
      await updateDoc(doc(db, "users", userId, "summaries", renamingId), {
        title: next.substring(0, 80),
      });
      if (selectedSummary?.id === renamingId) {
        setSelectedSummary({ ...selectedSummary, title: next.substring(0, 80) });
      }
      setRenamingId(null);
      setRenameTitle("");
      setRenameOpen(false);
      loadSummaries(true);
      setUnsavedChanges(false);
      toast({ title: "Success", description: "Summary renamed successfully" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to rename summary", variant: "destructive" });
    }
  };

  const calculateReadingTime = (text: string): number => {
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words / 200); // 200 words per minute
  };

  // removed quality scoring

  const { showAnimation: showUsageAnim, triggerAnimation: triggerUsageAnim } = useUsageAnimation();

  const handleSummarize = async () => {
    if (importingFile) {
      toast({ title: "Still reading file", description: "Please wait for the file to finish importing.", variant: "destructive" });
      return;
    }
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Please enter some text to summarize",
        variant: "destructive",
      });
      return;
    }
    // Title is optional; if empty we'll auto-generate from the first 4 words on save

    // Persist draft right before generating (mobile reload protection)
    try { localStorage.setItem('summarizer_draft', JSON.stringify({ summaryTitle, text, summaryType, readingLevel, includeKeyPoints })); } catch {}
    setLoading(true);
    setIsGenerating(true);
    setFunFact(getRandomFunFact());
    setSummary("");
    setUnsavedChanges(true);

    try {
      const styleDirectives = (() => {
        const baseDirectives = {
          brief: "Write a concise summary in your own words. Focus only on the main idea and the most essential takeaways. Target 400-600 words (≈2-3 min read). MUST NOT exceed 600 words. Avoid fluff.",
          detailed: "Write a long, comprehensive summary covering all key points and explanations. Expand concepts with examples where helpful. Be thorough and well-structured.",
          notes: "Create well-structured study notes with sections and bullet points. For each key point, add 1-2 sentences explaining it and explicitly connect related points (e.g., 'Because...', 'Therefore...', 'This leads to...'). Use plain text formatting.",
          key_points: "Extract ONLY the main ideas as a bullet list. Each bullet must be one clear sentence without sub-bullets. No extra commentary.",
          academic: "Create a professional, academic-style summary with formal tone, precise terminology, and clear structure. If the source implies citations, indicate them succinctly (e.g., (Author, Year)) without fabricating details."
        }[summaryType];

        const readingLevelDirectives = {
          simple: "Use simple language and short sentences. Avoid complex terminology.",
          standard: "Use clear, professional language appropriate for general audiences.",
          advanced: "Use sophisticated language and domain-specific terminology where appropriate."
        }[readingLevel];

        const keyPointsDirective = includeKeyPoints ? "Include a separate section with key takeaways or bullet points." : "";

        return `${baseDirectives} ${readingLevelDirectives} ${keyPointsDirective} Do not include markdown formatting like **bold** or headings.`;
      })();

      // Usage is now tracked server-side to prevent manipulation
      const resp = await fetch(`${API_BASE}/summarize-text`, { 
        method: "POST", 
        headers: await getAuthHeaders(), 
        body: JSON.stringify({ 
          text, 
          summaryType, 
          styleDirectives,
          userId, // Include userId for server-side usage tracking
          options: {
            readingLevel,
            includeKeyPoints,
            // Type-specific targets (the API may use these as guidance)
            targetWords: (
              summaryType === 'brief' ? 500 :
              summaryType === 'detailed' ? Math.min(1500, Math.floor(wordLimit * 0.5)) :
              summaryType === 'notes' ? 900 :
              summaryType === 'academic' ? 1000 :
              350
            ),
            hardCapWords: summaryType === 'brief' ? 600 : undefined,
            targetBullets: summaryType === 'key_points' ? 8 : undefined,
          }
        })
      });
      
      let data: any = null;
      try { data = await resp.json(); } catch {}
      if (!resp.ok || (data && data.error)) throw new Error((data && (data.error || data.message)) || resp.statusText || "Failed to summarize");

      // Enhanced text cleaning
      let cleaned = (data.summary || "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/^(#{1,6})\s*/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[ \t]+$/gm, "")
        .trim();

      // Enforce brief hard cap (~<3 min read at 200 wpm ≈ 600 words)
      if (summaryType === 'brief') {
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (words.length > 600) {
          cleaned = words.slice(0, 600).join(' ');
        }
      }

      setSummary(cleaned);
      setIsGenerating(false);
      setGenerationProgress(100);

      if (autoSave) {
        const wordCount = text.trim().split(/\s+/).length;
        const readingTime = calculateReadingTime(text);
        await addDoc(collection(db, "users", userId, "summaries"), {
          title: (summaryTitle.trim() || (text.trim().split(/\s+/).slice(0, 4).join(' ') || 'Untitled Summary')).substring(0, 80),
          original_text: text,
          summary_text: cleaned,
          summary_type: summaryType,
          created_at: new Date().toISOString(),
          word_count: wordCount,
          reading_time: readingTime,
        });

        try { await awardActionXP(userId, 'summary', { summaryType, wordCount }); } catch {}
        try { await incrementCounter(userId, 'summaries'); } catch {}
        try { await recordDailyVisit(userId); } catch {}

        toast({ title: "Success!", description: "Summary created and saved!" });

        loadSummaries(true);
        try { localStorage.removeItem('summarizer_draft'); } catch {}
      } else {
        toast({
          title: "Success!",
          description: "Summary created successfully!",
        });
        try { localStorage.removeItem('summarizer_draft'); } catch {}
      }

    } catch (error: any) {
      setIsGenerating(false);
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to generate summary", 
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSummary = async (summaryId: string) => {
    // Optimistic: remove from UI instantly, restore on failure
    setSavedSummaries(prev => prev.filter(s => s.id !== summaryId));
    if (selectedSummary?.id === summaryId) {
      setSelectedSummary(null);
    }
    try {
      await deleteDoc(doc(db, "users", userId, "summaries", summaryId));

      // Delete associated feed post if exists
      try {
        const feedQuery = query(collection(db, "feed_posts"), where("sourceRef.docId", "==", summaryId), where("ownerId", "==", userId), limit(1));
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
        description: "Summary deleted successfully",
      });
    } catch (error: any) {
      loadSummaries(true);
      toast({
        title: "Error",
        description: error.message || "Failed to delete summary",
        variant: "destructive",
      });
    }
  };

  const toggleSummarySelection = (id: string) => {
    setSelectedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteSummaries = async () => {
    if (selectedSummaries.size === 0) return;
    try {
      setLoading(true);
      const batch = writeBatch(db);
      
      for (const id of selectedSummaries) {
        batch.delete(doc(db, "users", userId, "summaries", id));
      }
      
      await batch.commit();
      
      setSavedSummaries(prev => prev.filter(s => !selectedSummaries.has(s.id)));
      if (selectedSummary && selectedSummaries.has(selectedSummary.id)) {
        setSelectedSummary(null);
      }
      
      toast({ title: "Success", description: `Deleted ${selectedSummaries.size} summar${selectedSummaries.size === 1 ? 'y' : 'ies'}` });
      setSelectedSummaries(new Set());
      setSelectionMode(false);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to delete summaries", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: "Copied to clipboard" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to copy to clipboard", variant: "destructive" });
    }
  };

  const copyToClipboardLabeled = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied!", description: `${label} copied to clipboard` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to copy to clipboard", variant: "destructive" });
    }
  };

  const downloadSummary = async (summary: SavedSummary, mode?: 'summary_only' | 'both') => {
    if (!mode) {
      setPendingDownloadSummary(summary);
      setDownloadChoiceOpen(true);
      return;
    }

    const content = mode === 'summary_only'
      ? (summary.summary_text || '')
      : `Original Text:\n\n${summary.original_text || ''}\n\n---\n\nSummary:\n\n${summary.summary_text || ''}`;

    const pdfContent = generateSummaryPDFHTML(
      summary.title || 'Untitled',
      content,
      summary.created_at
    );

    const filename = `summary-${(summary.title || 'untitled').substring(0, 20).replace(/\s+/g, '_')}`;

    try {
      await downloadPDF(pdfContent, { filename });
      toast({ title: "Downloaded!", description: 'Summary saved as PDF' });
    } catch (error) {
      console.error('PDF download error:', error);
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  
  return (
    <div className="max-w-7xl mx-auto relative px-3 md:px-0 overflow-x-hidden" aria-busy={isBusy}>
      <LoadingOverlay
        open={isBusy}
        title="Working…"
        subtitle="This may take up to a minute or two. Please don't refresh."
        progress={isGenerating ? generationProgress : undefined}
      />
      {/* Stats Overview Bar removed */}

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
                <h3 className="text-lg font-semibold">Recent Summaries</h3>
                <p className="text-xs text-muted-foreground">
                  {savedSummaries.length} summar{savedSummaries.length === 1 ? 'y' : 'ies'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setTab('generate'); setSidebarOpen(false); }}
                  aria-label="New summary"
                >
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div>
              {loadingSummaries ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedSummaries.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No summaries yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {savedSummaries.slice(0, 10).map((summary) => (
                    <div key={summary.id} className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedSummary?.id === summary.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}>
                      <button
                        onClick={() => {
                          const run = () => { setTab('library'); setSelectedSummary(summary); setOriginalTextCollapsed(true); setSidebarOpen(false); };
                          if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="font-medium text-sm truncate" title={summary.title}>{summary.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(summary.created_at).toLocaleDateString()} • {formatSummaryType(summary.summary_type)}
                          {(summary.savedFrom === "feed" || summary.savedFrom === "challenge") && summary.originalCreator && (
                            <span className="block text-xs text-muted-foreground mt-1">
                              saved from feed, made by @{summary.originalCreator}
                            </span>
                          )}
                        </p>
                      </button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); openRename(summary); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); requestDeleteSummary(summary.id, summary.title); }}>
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
        {/* Recent Summaries Sidebar (match Flashcards) */}
        <div className="hidden md:block w-64 flex-shrink-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Summaries</CardTitle>
              <CardDescription>
                {savedSummaries.length} summar{savedSummaries.length === 1 ? 'y' : 'ies'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loadingSummaries ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : savedSummaries.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No summaries yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {/* Sidebar list: no filter chips here per design */}
                  {savedSummaries.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${selectedSummary?.id === s.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        const run = () => { setTab('library'); setSelectedSummary(s); setOriginalTextCollapsed(true); };
                        if (unsavedChanges) { pendingActionRef.current = run; setLeaveOpen(true); } else { run(); }
                      }}
                      role="button"
                    >
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={s.title}>{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSummaryType(s.summary_type)}
                          {(s.savedFrom === "feed" || s.savedFrom === "challenge") && s.originalCreator ? (
                            <span className="block">saved from feed, made by @{s.originalCreator}</span>
                          ) : null}
                        </p>
                      </div>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openRename(s); }}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); requestDeleteSummary(s.id, s.title); }}>
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
            <TabsList className="grid w-full grid-cols-2" data-tour="summarizer-tabs">
              <TabsTrigger value="create">
                <FileText className="w-4 h-4 mr-2" />
                Create Summary
              </TabsTrigger>
              <TabsTrigger value="library" data-tour="summarizer-saves-tab">
                <BookOpen className="w-4 h-4 mr-2" />
                My Saves
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5" />
                    AI Text Summarizer
                  </CardTitle>
                  <CardDescription>
                    Transform long texts into concise, actionable summaries with AI
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
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
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left Column - Settings */}
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div>
                          <Label className="text-base font-semibold">Summary Title</Label>
                          <Input
                            value={summaryTitle}
                            onChange={(e) => setSummaryTitle(e.target.value)}
                            placeholder="e.g., Biology Chapter 3"
                            disabled={loading}
                          />
                        </div>
                        <div>
                          <Label className="text-base font-semibold">Summary Type</Label>
                          <RadioGroup value={summaryType} onValueChange={(v) => setSummaryType(v as any)} className="mt-2" data-tour="summarizer-format">
                            <div className="grid grid-cols-1 gap-3">
                              {[
                                { value: "brief", label: "Brief Summary", desc: "2-3 sentences, main ideas" },
                                { value: "key_points", label: "Key Points", desc: "Bulleted list of main points" },
                                { value: "detailed", label: "Detailed Summary", desc: "Comprehensive coverage" },
                                { value: "notes", label: "Study Notes", desc: "Structured for learning" },
                                { value: "academic", label: "Academic Summary", desc: "Formal, citation-ready" }
                              ].map((type) => (
                                <div key={type.value} className="flex items-start space-x-2 p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                                  <RadioGroupItem value={type.value} id={type.value} />
                                  <Label htmlFor={type.value} className="cursor-pointer flex-1">
                                    <div className="font-medium">{type.label}</div>
                                    <div className="text-sm text-muted-foreground">{type.desc}</div>
                                  </Label>
                                </div>
                              ))}
                            </div>
                          </RadioGroup>
                        </div>

                        <div className="space-y-3">
                          <Label className="text-base font-semibold">Advanced Options</Label>
                          <div className="space-y-3">
                            <div>
                              <Label>Reading Level</Label>
                              <Select value={readingLevel} onValueChange={(v: any) => setReadingLevel(v)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="simple">
                                    <div className="flex items-center gap-2">
                                      <Gauge className="w-4 h-4 text-green-500" />
                                      Simple
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="standard">
                                    <div className="flex items-center gap-2">
                                      <Gauge className="w-4 h-4 text-blue-500" />
                                      Standard
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="advanced">
                                    <div className="flex items-center gap-2">
                                      <Gauge className="w-4 h-4 text-purple-500" />
                                      Advanced
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Column - Text Input */}
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Your Text</Label>
                        <div className="relative">
                          <Textarea
                            ref={inputRef}
                            value={text}
                            data-tour="summarizer-input"
                            onChange={(e) => {
                              const prev = text;
                              const raw = e.target.value;
                              // Sanitize tokens > 50 by trimming them
                              const sanitized = raw
                                .split(/\s+/)
                                .map(t => t.length > 50 ? t.slice(0, 50) : t)
                                .join(' ');
                              const words = sanitized.trim().length ? sanitized.trim().split(/\s+/) : [] as string[];
                              // Allow deletions always
                              if (sanitized.length <= prev.length) { setText(sanitized); return; }
                              // Truncate to wordLimit instead of blocking typing/paste
                              if (words.length > wordLimit) {
                                setText(words.slice(0, wordLimit).join(' '));
                                return;
                              }
                              setText(sanitized);
                            }}
                            placeholder="Paste your text here..."
                            className="min-h-[300px] resize-vertical pr-16"
                            disabled={usesBlocked || importingFile}
                          />
                          <div className="pointer-events-none absolute bottom-1.5 right-2 text-[11px] text-muted-foreground bg-background/70 px-1 rounded">
                            {Math.min(text.trim().split(/\s+/).filter(Boolean).length, wordLimit)} / {wordLimit}
                          </div>
                        </div>
                        <div className="flex justify-end items-center text-sm text-muted-foreground">
                          <span>{calculateReadingTime(text)} min read</span>
                        </div>

                        <div className="flex items-center gap-2 pt-2 flex-wrap">
                          <Input
                            id="file-input"
                            type="file"
                            accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                            onChange={async (e) => {
                              const inputEl = e.currentTarget;
                              const f = e.target.files?.[0];
                              if (!f) return;
                              setImportingFile(true);
                              try {
                                const extracted = await extractTextFromFile(f);
                                const val = (extracted || "");
                                const words = val.trim().split(/\s+/).filter(Boolean);
                                setText(words.slice(0, wordLimit).join(' '));
                                toast({ title: "Imported", description: `Loaded ${f.name} (${words.length} words)` });
                              } catch (err: any) {
                                toast({ title: "Error", description: err?.message || "Failed to read file", variant: "destructive" });
                              } finally {
                                setImportingFile(false);
                                inputEl.value = "";
                              }
                            }}
                            disabled={usesBlocked || importingFile}
                            className="hidden"
                          />
                          <Label htmlFor="file-input" className={importingFile ? "pointer-events-none opacity-60" : "cursor-pointer"}>
                            <Button variant="outline" type="button" className="w-full" asChild>
                              <span>
                                {importingFile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
                                {importingFile ? "Reading file…" : "Import from File"}
                              </span>
                            </Button>
                          </Label>
                          <Button variant="outline" size="sm" type="button" onClick={() => setPickerOpen(true)}>Create from…</Button>
                        </div>
                      </div>

                      <div className="relative">
                        <UsageAnimation show={showUsageAnim} />
                        <Button 
                          type="button"
                          onClick={() => { triggerUsageAnim(); handleSummarize(); }} 
                          disabled={loading || importingFile || !text.trim() || usesBlocked} 
                          className="w-full py-6 text-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                          data-tour="summarizer-generate"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin mr-2" />
                              Generating Summary...
                            </>
                          ) : usesBlocked ? (
                            <><X className="w-5 h-5 mr-2" />Monthly limit reached</>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Play className="w-5 h-5" />
                              Generate
                            </div>
                          )}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground text-center">
                        Use AI responsibly. Always cite your sources and follow your school or organization's policies. 
                        AI-writing detection tools exist and may flag unedited AI text-review and make it your own.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {summary && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between flex-wrap gap-2">
                      <span className="flex items-center gap-2">
                        {summaryType === "notes" ? "Study Notes" : 
                         summaryType === "key_points" ? "Key Points" : "Summary"}
                        <Badge variant="outline" className="capitalize">{summaryType}</Badge>
                      </span>
                      <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end sm:justify-start">
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(summary)}>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => downloadSummary({
                          id: 'temp',
                          title: 'Generated Summary',
                          original_text: text,
                          summary_text: summary,
                          summary_type: summaryType,
                          created_at: new Date().toISOString()
                        })}>
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </CardTitle>
                    <CardDescription>
                      {summary.split(/\s+/).length} words • {calculateReadingTime(summary)} min read
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none prose-p:my-4 prose-p:leading-relaxed prose-ul:my-4 prose-ol:my-4 prose-li:my-2 prose-li:leading-relaxed prose-br:block prose-br:my-4 prose-h3:mt-10 prose-h3:mb-5 prose-h3:font-bold prose-h3:text-lg prose-h3:leading-snug prose-h3:bg-muted prose-h3:rounded-md prose-h3:px-3 prose-h3:py-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                        {normalizeForMath(summary)}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>


            <TabsContent value="library" className="space-y-6 mt-6">
              {selectedSummary ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-2xl font-bold break-words">{selectedSummary.title}</h3>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1 flex-wrap gap-y-2">
                        <span>{new Date(selectedSummary.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        {formatSummaryType(selectedSummary.summary_type)}
                        <span>•</span>
                        <span>{selectedSummary.word_count} words</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end sm:justify-start">
                      <Button
                        variant="outline"
                        onClick={() => copyToClipboardLabeled(selectedSummary.original_text || "", 'Original Text')}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Original Text
                      </Button>
                      <Button variant="outline" onClick={() => copyToClipboardLabeled(selectedSummary.summary_text || "", 'Summary')}>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy Summary
                      </Button>
                      <Button variant="outline" onClick={() => downloadSummary(selectedSummary)}>
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button variant="outline" onClick={() => setSelectedSummary(null)}>
                        Back to Library
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Original Text Card - Collapsible (collapsed by default, shown first) */}
                    <Card>
                      <CardHeader 
                        className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg"
                        onClick={() => setOriginalTextCollapsed(!originalTextCollapsed)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CardTitle className="flex items-center gap-2">
                              {originalTextCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                              <FileText className="w-5 h-5" />
                              Original Text
                            </CardTitle>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboardLabeled(selectedSummary.original_text || "", 'Original Text');
                            }}
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy
                          </Button>
                          <CardDescription className="text-xs">
                            {selectedSummary.word_count} words • {originalTextCollapsed ? 'Click to expand' : 'Click to collapse'}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      {!originalTextCollapsed && (
                        <CardContent>
                          <div className="max-h-96 overflow-y-auto prose prose-sm max-w-none prose-p:my-4 prose-p:leading-relaxed prose-ul:my-4 prose-ol:my-4 prose-li:my-2 prose-li:leading-relaxed prose-br:block prose-br:my-4 prose-h3:mt-10 prose-h3:mb-5 prose-h3:font-bold prose-h3:text-lg prose-h3:leading-snug prose-h3:bg-muted prose-h3:rounded-md prose-h3:px-3 prose-h3:py-2">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                              {normalizeForMath(selectedSummary.original_text)}
                            </ReactMarkdown>
                          </div>
                        </CardContent>
                      )}
                    </Card>

                    {/* Summary Card - Always visible and full width */}
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle>Summary</CardTitle>
                          <Button variant="outline" size="sm" onClick={() => copyToClipboardLabeled(selectedSummary.summary_text || "", 'Summary')}>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-y-auto prose prose-sm max-w-none prose-p:my-4 prose-p:leading-relaxed prose-ul:my-4 prose-ol:my-4 prose-li:my-2 prose-li:leading-relaxed prose-br:block prose-br:my-4 prose-h3:mt-10 prose-h3:mb-5 prose-h3:font-bold prose-h3:text-lg prose-h3:leading-snug prose-h3:bg-muted prose-h3:rounded-md prose-h3:px-3 prose-h3:py-2">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                            {normalizeForMath(selectedSummary.summary_text)}
                          </ReactMarkdown>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">My Saves</CardTitle>
                          <CardDescription>
                            Saved summaries
                            {selectionMode && selectedSummaries.size > 0 && ` • ${selectedSummaries.size} selected`}
                          </CardDescription>
                        </div>
                        {!selectionMode ? (
                          <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                            <CheckSquare className="w-4 h-4 mr-2" />
                            Select Multiple
                          </Button>
                        ) : (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => {
                              if (selectedSummaries.size === savedSummaries.length) {
                                setSelectedSummaries(new Set());
                              } else {
                                setSelectedSummaries(new Set(savedSummaries.map(s => s.id)));
                              }
                            }}>
                              {selectedSummaries.size === savedSummaries.length ? 'Deselect All' : 'Select All'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setSelectionMode(false);
                              setSelectedSummaries(new Set());
                            }}>
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {savedSummaries.length === 0 ? (
                        <p className="text-muted-foreground">No saved items yet.</p>
                      ) : (
                        <div className="space-y-3">
                          {savedSummaries.map((s) => (
                            <div
                              key={s.id}
                              className="group p-3 border rounded-lg bg-background transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm ring-1 ring-transparent hover:ring-2 hover:ring-primary/40 cursor-pointer"
                              onClick={() => {
                                if (selectionMode) {
                                  toggleSummarySelection(s.id);
                                } else {
                                  setSelectedSummary(s);
                                  setOriginalTextCollapsed(true);
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
                                      toggleSummarySelection(s.id);
                                    }}
                                  >
                                    {selectedSummaries.has(s.id) ? (
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
                                      <Badge variant="outline" className="mt-1 inline-block">{formatSummaryType(s.summary_type)}</Badge>
                                      <div className="text-xs text-muted-foreground mt-1">
                                        {new Date(s.created_at).toLocaleString()}
                                        {(s.savedFrom === "feed" || s.savedFrom === "challenge") && s.originalCreator && (
                                          <span className="block mt-1">
                                            saved from feed, made by @{s.originalCreator}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {!selectionMode && (
                                      <div className="flex flex-col sm:flex-row items-center gap-1 flex-shrink-0">
                                        <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={(e) => { e.stopPropagation(); setSelectedSummary(s); setOriginalTextCollapsed(true); }}>
                                          <Eye className="w-4 h-4 mr-1" /> View
                                        </Button>
                                        <Button size="sm" variant="outline" className="flex whitespace-nowrap" onClick={(e) => { e.stopPropagation(); downloadSummary(s); }}>
                                          <Download className="w-4 h-4 mr-1" /> Download
                                        </Button>
                                        <div className="flex gap-1">
                                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); openRename(s); }} aria-label="Rename">
                                            <Pencil className="w-4 h-4" />
                                          </Button>
                                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); requestDeleteSummary(s.id, s.title); }} aria-label="Delete">
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
                  
                  {/* Floating Action Bar for bulk delete */}
                  {selectionMode && selectedSummaries.size > 0 && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
                      <Card className="shadow-lg border-2">
                        <CardContent className="p-4 flex items-center gap-4">
                          <span className="font-medium">{selectedSummaries.size} summar{selectedSummaries.size === 1 ? 'y' : 'ies'} selected</span>
                          <Button
                            variant="destructive"
                            onClick={() => {
                              setConfirmId("bulk");
                              setConfirmTitle(`${selectedSummaries.size} summar${selectedSummaries.size === 1 ? 'y' : 'ies'}`);
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
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <CrossCreatePicker
        userId={userId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialTab="essay"
        allowedTabs={["chat","summary","flashcards","quizzes","plans"]}
      />

      {leaveOpen && (
            <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Leave without saving?</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>You have unsaved changes. Do you want to discard them?</p>
                </div>
                <DialogFooter>
            <Button variant="ghost" onClick={() => { setLeaveOpen(false); pendingActionRef.current = null; }}>
              Continue Editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setLeaveOpen(false);
                setUnsavedChanges(false);
                const fn = pendingActionRef.current; 
                pendingActionRef.current = null; 
                fn && fn();
              }}
            >
              Discard Changes
            </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}


      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Summary</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename-title">Title</Label>
              <Input
                id="rename-title"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder="Enter new title"
                maxLength={80}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={saveRename} disabled={!renameTitle.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download Choice Dialog - Summary Only vs Both */}
      <Dialog open={downloadChoiceOpen} onOpenChange={setDownloadChoiceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Download PDF</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">What would you like to include in the PDF?</p>
          <div className="grid grid-cols-1 gap-3 mt-2">
            <Button
              className="w-full justify-start gap-3 h-auto py-3"
              variant="outline"
              onClick={() => {
                setDownloadChoiceOpen(false);
                if (pendingDownloadSummary) downloadSummary(pendingDownloadSummary, 'summary_only');
              }}
            >
              <FileText className="w-5 h-5 shrink-0" />
              <div className="text-left">
                <div className="font-medium">Summary Only</div>
                <div className="text-xs text-muted-foreground">Download just the generated summary</div>
              </div>
            </Button>
            <Button
              className="w-full justify-start gap-3 h-auto py-3"
              variant="outline"
              onClick={() => {
                setDownloadChoiceOpen(false);
                if (pendingDownloadSummary) downloadSummary(pendingDownloadSummary, 'both');
              }}
            >
              <BookOpen className="w-5 h-5 shrink-0" />
              <div className="text-left">
                <div className="font-medium">Original + Summary</div>
                <div className="text-xs text-muted-foreground">Include the original text and the summary</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmId === "bulk" ? "Delete Multiple Summaries?" : "Delete Summary?"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p>Are you sure you want to delete {confirmId === "bulk" ? "these summaries" : "this summary"}? This action cannot be undone.</p>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium truncate">{confirmTitle}</p>
            </div>
            {confirmHasFeedPost && confirmId !== "bulk" && (
              <p className="text-sm text-destructive font-medium">⚠️ This will also delete the associated feed post.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>No, keep {confirmId === "bulk" ? "them" : "it"}</Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={async () => {
                if (confirmId === "bulk") {
                  await bulkDeleteSummaries();
                } else if (confirmId) {
                  await handleDeleteSummary(confirmId);
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
