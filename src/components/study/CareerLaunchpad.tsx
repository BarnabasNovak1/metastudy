import { useState, useEffect, useRef } from "react";
import { UsageAnimation, useUsageAnimation } from "@/components/ui/usage-animation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Linkedin, Mic, Loader2, Copy, Save as SaveIcon, RefreshCw, Download, Trash2, Pencil, GripVertical, X, Undo, Redo, Upload, BookOpen, Eye, Play, Square, CheckSquare, Menu, Sparkles, FileUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { db } from "../../../firebase";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";
import { addDoc, collection, serverTimestamp, getDocs, query, deleteDoc, doc, updateDoc, getDoc, writeBatch, limit } from "firebase/firestore";
import { awardAchievement, incrementCounter, recordDailyVisit } from "@/lib/achievements";
import { incrementMonthlyUsage } from "@/lib/usage";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { getRandomFunFact } from "@/lib/funFacts";
import LoadingOverlay from "@/components/LoadingOverlay";
import { downloadPDF, generateResumePDFHTML } from "@/lib/pdf-utils";
import { extractTextFromFile } from "@/lib/extractTextFromFile";

// Resume section types
type ResumeSection = {
  id: string;
  type: string;
  content: string;
  style?: any;
};

type TemplateType = 'professional' | 'classic' | 'two-column' | 'custom';

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
  out = out
    .split("\n")
    .map((ln) => maybeWrapFormula(ln))
    .join("\n");
  out = out.replace(/(\n\s*){3,}/g, "\n\n");
  return out;
};

export const CareerLaunchpad = ({ userId }: { userId: string }) => {
  const { toast } = useToast();
  const gate = usePlanGate();

  // Count a career tool use in stats + record the study day (idempotent per day)
  const trackCareerUse = async () => {
    try { await incrementCounter(userId, 'career_uses'); } catch {}
    try { await recordDailyVisit(userId); } catch {}
  };

  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<string>(() => {
    try {
      const saved = sessionStorage.getItem('career_active_tab');
      return ['resume', 'interview', 'linkedin', 'planner', 'saves'].includes(saved || '') ? saved! : 'resume';
    } catch { return 'resume'; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [funFact, setFunFact] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  
  // Resume builder state
  const [resumeData, setResumeData] = useState({
    fullName: "Alex Johnson",
    email: "alex.johnson@email.com",
    phone: "(555) 123-4567",
    location: "San Francisco, CA",
    linkedin: "linkedin.com/in/alexjohnson",
    portfolio: "alexjohnson.dev"
  });
  
  const [sections, setSections] = useState<ResumeSection[]>([
    {
      id: "summary",
      type: "summary",
      content: "Results-driven Software Engineer with 5+ years of experience building scalable web applications. Passionate about clean code, user experience, and mentoring junior developers. Strong background in React, Node.js, and cloud technologies."
    },
    {
      id: "experience",
      type: "experience", 
      content: `Senior Software Engineer, TechCorp Inc. | 2020 to Present
• Led development of customer dashboard serving 50k+ users, improving load time by 40%
• Implemented microservices architecture reducing deployment failures by 60%
• Mentored 3 junior developers and conducted code reviews

Software Developer, StartupXYZ | 2018 to 2020  
• Built responsive React applications with 99.9% uptime
• Collaborated with design team to implement new UI components
• Reduced API response time by 30% through optimization`
    },
    {
      id: "education", 
      type: "education",
      content: `Master of Science in Computer Science, Stanford University | 2018
• GPA: 3.8/4.0
• Relevant coursework: Algorithms, Distributed Systems, Machine Learning

Bachelor of Science in Software Engineering, UC Berkeley | 2016
• Graduated Magna Cum Laude
• President of Computer Science Club`
    },
    {
      id: "skills",
      type: "skills", 
      content: `Programming: JavaScript, TypeScript, Python, Java
Frameworks: React, Node.js, Express, Next.js
Tools: Git, Docker, AWS, MongoDB, PostgreSQL
Soft Skills: Leadership, Communication, Problem Solving`
    },
    {
      id: "projects",
      type: "projects",
      content: `E-Commerce Platform | React, Node.js, MongoDB
• Built full-stack application processing $1M+ in annual sales
• Implemented real-time inventory management system
• Reduced checkout time by 25%

Task Management App | React Native, Firebase
• Developed mobile app with 10k+ downloads on App Store
• Integrated push notifications and offline functionality
• Achieved 4.8-star rating with 500+ reviews`
    }
  ]);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('professional');
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<ResumeSection | null>(null);
  const [editPosition, setEditPosition] = useState({ top: 0, left: 0 });
  const [fontFamily] = useState("Inter");
  const [lineHeight, setLineHeight] = useState(1.4);
  const [sectionGap, setSectionGap] = useState(8);
  const [titleFontSize, setTitleFontSize] = useState(18);
  const [bodyFontSize, setBodyFontSize] = useState(12);
  const [titleDescGap, setTitleDescGap] = useState(4);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  // Undo/Redo history
  const [history, setHistory] = useState<{sections: ResumeSection[], resumeData: any}[]>([]);
  const [future, setFuture] = useState<{sections: ResumeSection[], resumeData: any}[]>([]);

  // Upload & Review mode state
  const [resumeMode, setResumeMode] = useState<'build' | 'upload'>('build');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedText, setUploadedText] = useState<string>('');
  const [uploadedReview, setUploadedReview] = useState<{
    score: number;
    summary?: string;
    strengths?: string[];
    improvements?: string[];
    examples?: Array<{ original: string; improved: string; rationale?: string }>;
  } | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);

  // LinkedIn state
  const [liTopic, setLiTopic] = useState("");
  const [liTone, setLiTone] = useState("Professional");
  const [liPostType, setLiPostType] = useState("Achievement/Reflection");
  const [liVariations, setLiVariations] = useState<string[]>([]);
  const [liEditOpen, setLiEditOpen] = useState(false);
  const [liEditText, setLiEditText] = useState("");
  const [liEditIndex, setLiEditIndex] = useState<number | null>(null);
  const [liEditSavedId, setLiEditSavedId] = useState<string | null>(null);

  // Interview state
  const [ivRole, setIvRole] = useState("");
  const [ivType, setIvType] = useState("Technical");
  const [ivCompany, setIvCompany] = useState("");
  const [ivQuestions, setIvQuestions] = useState<string[]>([]);
  const [ivInSession, setIvInSession] = useState(false);
  const [ivIndex, setIvIndex] = useState(0);
  const [ivAnswer, setIvAnswer] = useState("");
  type IvFeedback = { clarity:number; confidence:number; relevance:number; feedback:string; improved:string };
  const [ivFeedbacks, setIvFeedbacks] = useState<IvFeedback[]>([]);
  const [ivAnswers, setIvAnswers] = useState<string[]>([]);
  const [ivSummary, setIvSummary] = useState<{ clarity:number; confidence:number; relevance:number } | null>(null);
  const [, setIvSessionId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  // Career Planner state
  const [cpText, setCpText] = useState("");
  const [cpRecs, setCpRecs] = useState<{ title: string; reasoning: string }[]>([]);
  const [cpLabel] = useState("");

  // My Saves state
  type SaveType = 'resume' | 'linkedin' | 'interview' | 'career_recs';
  type SavedItem = {
    id: string;
    type: SaveType;
    created_at?: any;
    title: string;
    subtitle?: string;
    raw: any;
  };

  // Redo the interview with current settings
  const redoInterview = async () => {
    if (!ivRole.trim()) { toast({ title: 'Role required', variant: 'destructive' }); return; }
    setIvQuestions([]);
    setIvAnswers([]);
    setIvFeedbacks([] as any);
    setIvSummary(null);
    setIvInSession(false);
    setReviewMode(false);
    await generateInterview();
  };

  // Use the preview dialog state declared later in the file
  const [, setPreviewItemId] = useState<string | null>(null);

  const renderPdfPages = async (file: File): Promise<string[]> => {
    // @ts-ignore
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    try {
      // @ts-ignore
      const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      // @ts-ignore
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    } catch {}

    const buf = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjsLib.getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      pages.push(canvas.toDataURL('image/png'));
    }

    return pages;
  };

  // Load an interview draft into the session (Edit action)
  const loadInterviewDraft = async (docId: string) => {
    try {
      if (!userId) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
      setFunFact(getRandomFunFact());
  setLoading(true);
      const ref = doc(db, 'users', userId, 'interview_sessions', docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) { toast({ title: 'Not found', variant: 'destructive' }); return; }
      const d = snap.data() as any;
      // Restore state (with safe fallbacks)
      setIvType(String(d?.interview_type || 'Technical'));
      setIvRole(String(d?.job_title || ''));
      setIvCompany(String(d?.company_name || ''));
      setIvQuestions(Array.isArray(d?.questions) ? d.questions.map(String) : []);
      setIvAnswers(Array.isArray(d?.user_answers) ? d.user_answers.map((x:any)=>String(x||'')) : [] as any);
      setIvFeedbacks(Array.isArray(d?.ai_feedback) ? d.ai_feedback as any : [] as any);
      const idx = Math.max(0, Math.min(Number(d?.current_index || 0), (Array.isArray(d?.questions)?d?.questions.length:1)-1));
      setIvIndex(idx);
      setIvAnswer(String((Array.isArray(d?.user_answers) ? d.user_answers[idx] : '') || ''));
      setIvInSession(true);
      setReviewMode(false);
      setActive('interview');
      setPreviewOpen(false);
      toast({ title: 'Interview loaded', description: 'Continue where you left off.' });
    } catch (e:any) {
      toast({ title: 'Open failed', description: String(e?.message||'') , variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Load saved Career Recommendations into the Career Recs tab
  
  // Preview/open saved item. For interviews, show popup with Q&A and Edit button.
  const openSavedPreview = async (item: SavedItem) => {
    try {
      if (!userId) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
      if (item.type === 'interview') {
        setLoading(true);
        const ref = doc(db, 'users', userId, 'interview_sessions', item.id);
        const snap = await getDoc(ref);
        if (!snap.exists()) { toast({ title: 'Not found', variant: 'destructive' }); return; }
        const d = snap.data() as any;
        const qs: string[] = Array.isArray(d?.questions) ? d.questions.map(String) : [];
        const ans: string[] = Array.isArray(d?.user_answers) ? d.user_answers.map((x:any)=>String(x||'')) : [];
        const body = qs.map((q, i) => `${i + 1}. ${q}\n${ans[i] ? `Answer: ${ans[i]}` : 'Answer: -'}`).join('\n\n');
        setPreviewTitle((d?.job_title || 'Interview') + (d?.company_name ? ` @ ${d.company_name}` : ''));
        setPreviewType('interview');
        setPreviewBody(body);
        setPreviewHTML('');
        setPreviewItemId(item.id);
        setPreviewOpen(true);
      } else if (item.type === 'career_recs') {
        setLoading(true);
        const ref = doc(db, 'users', userId, 'career_recs', item.id);
        const snap = await getDoc(ref);
        if (!snap.exists()) { toast({ title: 'Not found', variant: 'destructive' }); return; }
        const d = snap.data() as any;
        const body = `${d?.title || 'Role'}\n${d?.reasoning || d?.description || ''}`;
        setPreviewTitle('Career Recommendation');
        setPreviewType(item.type);
        setPreviewBody(body);
        setPreviewHTML('');
        setPreviewItemId(item.id);
        setPreviewOpen(true);
      } else if (item.type === 'linkedin') {
        // LinkedIn preview
        setPreviewTitle(item.title || 'Preview');
        setPreviewType(item.type);
        const data: any = item.raw || {};
        const body = String(data.selected_post || (Array.isArray(data.generated_posts) ? data.generated_posts[0] : '') || '').trim();
        setPreviewBody(body);
        setPreviewHTML('');
        setPreviewItemId(item.id);
        setPreviewOpen(true);
      } else if (item.type === 'resume') {
        // Resume preview - load full data and render as paper
        previewSavedResume(item);
      }
    } catch (e:any) {
      toast({ title: 'Open failed', description: String(e?.message||'') , variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Save interview draft (unfinished session)
  const saveInterviewDraft = async () => {
    try {
      if (!userId) { toast({ title: 'Sign in required', variant: 'destructive' }); return; }
      if (!Array.isArray(ivQuestions) || ivQuestions.length === 0) { toast({ title: 'Nothing to save', description: 'Start an interview first.' }); return; }
      setLoading(true);
      // Firestore does not allow undefined values. Sanitize arrays.
      const safeAnswers = Array.isArray(ivAnswers) ? ivAnswers.map(a => (typeof a === 'string' ? a : '')) : [];
      const safeFeedbacks = Array.isArray(ivFeedbacks)
        ? ivFeedbacks.map(f => (f && typeof f === 'object' ? {
            clarity: Number((f as any).clarity || 0),
            confidence: Number((f as any).confidence || 0),
            relevance: Number((f as any).relevance || 0),
            feedback: String((f as any).feedback || ''),
            improved: String((f as any).improved || ''),
          } : null))
        : [];
      await addDoc(collection(db, "users", userId, "interview_sessions"), {
        job_title: ivRole,
        interview_type: ivType,
        company_name: ivCompany,
        questions: ivQuestions,
        user_answers: safeAnswers,
        ai_feedback: safeFeedbacks,
        current_index: ivIndex,
        status: 'in_progress',
        created_at: serverTimestamp(),
        timestamp: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      toast({ title: 'Saved', description: 'Interview saved. You can finish later from My Saves.' });
      if (active === 'saves') { try { (loadSavedAll as any)?.(); } catch {} }
    } catch (error: any) {
      toast({ title: 'Save failed', description: String(error?.message || ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Open a saved resume into the builder for editing
  const openSavedResumeToEdit = async (item: SavedItem) => {
    if (!userId || item.type !== 'resume') return;
    try {
      setLoading(true);
      const ref = doc(db, 'users', userId, 'career_resumes', item.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) { toast({ title: 'Not found', variant: 'destructive' }); return; }
      const d = snap.data() as any;
      setSelectedTemplate((d.template as any) || 'professional');
      if (d.resumeData) setResumeData(d.resumeData);
      if (Array.isArray(d.sections)) setSections(d.sections as any);
      setActive('resume');
      toast({ title: 'Loaded', description: 'Resume opened for editing.' });
    } catch {
      toast({ title: 'Open failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Preview a saved resume in a popup dialog (with option to download as PDF)
  const previewSavedResume = async (item: SavedItem) => {
    if (!userId || item.type !== 'resume') return;
    try {
      setLoading(true);
      const ref = doc(db, 'users', userId, 'career_resumes', item.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) { toast({ title: 'Not found', variant: 'destructive' }); return; }
      const d = snap.data() as any;
      const data = (d.resumeData || {}) as typeof resumeData;
      const secs = (Array.isArray(d.sections) ? d.sections : []) as ResumeSection[];
      const ff = fontFamily || 'Inter';
      const tfs = titleFontSize || 18;
      const bfs = bodyFontSize || 12;
      const lh = lineHeight || 1.4;
      const sg = sectionGap || 8;
      const tdg = titleDescGap || 4;

      const esc = (s: string) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      const contactLine = [data.email, data.phone, data.location].filter(Boolean).map(esc).join('  |  ');
      const linksLine = [data.linkedin, (data as any).portfolio || (data as any).website].filter(Boolean).map(esc).join('  |  ');

      const headerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-weight:700;font-size:${tfs + 10}px;line-height:1.2;color:#111;">${esc(data.fullName || '')}</div>
          ${contactLine ? `<div style="font-size:11px;color:#555;margin-top:4px;">${contactLine}</div>` : ''}
          ${linksLine ? `<div style="font-size:11px;color:#555;">${linksLine}</div>` : ''}
        </div>`;

      const sectionHTML = secs.map(s => `
        <div style="margin:${sg}px 0;">
          <div style="font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #d1d5db;font-size:${tfs}px;margin-bottom:${tdg}px;padding-bottom:${tdg > 0 ? 3 : 0}px;color:#111;">${esc((s.type||'').charAt(0).toUpperCase() + (s.type||'').slice(1))}</div>
          <div style="white-space:pre-line;font-size:${bfs}px;line-height:${lh};color:#333;">${esc(s.content || '')}</div>
        </div>`).join('');

      const docHTML = `<div style="width:8.5in;height:11in;padding:0.65in 0.75in;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.12);border-radius:2px;overflow:hidden;font-family:${ff},system-ui,sans-serif;color:#1a1a1a;margin:0 auto;">${headerHTML}${sectionHTML}</div>`;

      setPreviewTitle(item.title || 'Resume');
      setPreviewType('resume');
      setPreviewHTML(docHTML);
      setPreviewBody('');
      setPreviewItemId(item.id);
      setPreviewOpen(true);
    } catch (e: any) {
      toast({ title: 'Preview failed', description: e?.message || 'Could not render PDF preview', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  

  // Render resume preview canvas - looks like a real sheet of paper
  const renderResumePreview = () => {
    const Header = (
      <div className="text-center mb-3" style={{ fontFamily: fontFamily }}>
        <div className="font-bold text-gray-900" style={{ fontSize: `${titleFontSize + 10}px`, lineHeight: 1.2 }}>
          {resumeData.fullName || '\u00A0'}
        </div>
        <div className="text-gray-600 mt-1" style={{ fontSize: '11px' }}>
          {[resumeData.email, resumeData.phone, resumeData.location].filter(Boolean).join('  |  ')}
        </div>
        {(resumeData.linkedin || resumeData.portfolio) && (
          <div className="text-gray-600" style={{ fontSize: '11px' }}>
            {[resumeData.linkedin, resumeData.portfolio].filter(Boolean).join('  |  ')}
          </div>
        )}
      </div>
    );

    const Section = (section: ResumeSection) => (
      <div
        key={section.id}
        style={{ marginTop: sectionGap, marginBottom: sectionGap, fontFamily: fontFamily }}
      >
        <div
          className="font-semibold uppercase tracking-wide text-gray-900"
          style={{
            fontSize: `${titleFontSize}px`,
            marginBottom: titleDescGap,
            paddingBottom: titleDescGap > 0 ? 3 : 0,
            borderBottom: '1px solid #d1d5db',
          }}
        >
          {section.type.charAt(0).toUpperCase() + section.type.slice(1)}
        </div>
        <div
          className="whitespace-pre-line cursor-pointer hover:bg-blue-50/50 dark:hover:bg-gray-800/50 rounded transition-colors text-gray-800"
          onClick={(e) => openSectionEditor(section, e as any)}
          style={{
            fontSize: `${bodyFontSize}px`,
            lineHeight: lineHeight,
            textAlign: 'left',
            padding: '2px 4px',
          }}
        >
          {section.content || <span className="text-gray-400 italic">Click to add content...</span>}
        </div>
      </div>
    );

    const paperStyle: React.CSSProperties = {
      width: '8.5in',
      height: '11in',
      padding: '0.65in 0.75in',
      background: '#ffffff',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08)',
      borderRadius: '2px',
      overflow: 'hidden',
      position: 'relative',
      fontFamily: fontFamily,
      color: '#1a1a1a',
    };

    // Two-column template layout
    if (selectedTemplate === 'two-column') {
      const leftTypes = ['skills', 'education'];
      const leftSections = sections.filter(s => leftTypes.includes(s.type));
      const rightSections = sections.filter(s => !leftTypes.includes(s.type));
      return (
        <div className="flex justify-center py-6 bg-gray-200 dark:bg-gray-950 rounded-lg overflow-auto">
          <div id="resume-preview" style={paperStyle}>
            {Header}
            <div className="grid grid-cols-3 gap-5 mt-2">
              <div className="col-span-1 border-r border-gray-200 pr-4">
                {leftSections.map(Section)}
              </div>
              <div className="col-span-2">
                {rightSections.map(Section)}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Default single-column template layout
    return (
      <div className="flex justify-center py-6 bg-gray-200 dark:bg-gray-950 rounded-lg overflow-auto">
        <div id="resume-preview" style={paperStyle}>
          {Header}
          <div>
            {sections.map(Section)}
          </div>
        </div>
      </div>
    );
  };

  

  // Delete a saved item
  const deleteSavedItem = async () => {
    if (!userId || !confirmId || !confirmType) return;
    try {
      let col = '';
      if (confirmType === 'resume') col = 'career_resumes';
      else if (confirmType === 'linkedin') col = 'linkedin_posts';
      else if (confirmType === 'interview') col = 'interview_sessions';
      else if (confirmType === 'career_recs') col = 'career_recs';
      
      if (col) {
        await deleteDoc(doc(db, 'users', userId, col, confirmId));
      }
    } finally {
      // Optimistically update UI
      setSavedItems(prev => prev.filter(it => it.id !== confirmId));
      loadSavedAll();
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
    try {
      setLoading(true);
      const batch = writeBatch(db);
      
      for (const id of selectedItems) {
        const item = savedItems.find(i => i.id === id);
        if (item) {
          let col = '';
          if (item.type === 'resume') col = 'career_resumes';
          else if (item.type === 'linkedin') col = 'linkedin_posts';
          else if (item.type === 'interview') col = 'interview_sessions';
          else if (item.type === 'career_recs') {
            batch.delete(doc(db, 'users', userId, 'career_recs', id));
            continue;
          }
          if (col) {
            batch.delete(doc(db, 'users', userId, col, id));
          }
        }
      }
      
      await batch.commit();
      
      setSavedItems(prev => prev.filter(item => !selectedItems.has(item.id)));
      
      toast({ title: "Success", description: `Deleted ${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'}` });
      setSelectedItems(new Set());
      setSelectionMode(false);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to delete items", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Rename a saved item
  const renameSavedItem = async () => {
    if (!userId || !renameId || !renameType) return;
    try {
      if (renameType === 'resume') {
        await updateDoc(doc(db, 'users', userId, 'career_resumes', renameId), { label: renameText });
      } else if (renameType === 'linkedin') {
        await updateDoc(doc(db, 'users', userId, 'linkedin_posts', renameId), { topic: renameText });
      } else if (renameType === 'interview') {
        await updateDoc(doc(db, 'users', userId, 'interview_sessions', renameId), { job_title: renameText });
      } else if (renameType === 'career_recs') {
        await updateDoc(doc(db, 'users', userId, 'career_recs', renameId), { title: renameText });
      }
    } finally {
      loadSavedAll();
    }
  };

  // Persist active tab so a refresh keeps the user's place
  useEffect(() => {
    try { sessionStorage.setItem('career_active_tab', active); } catch {}
  }, [active]);

  // Auto-load saves when switching to the Saves tab
  useEffect(() => {
    if (active === 'saves') {
      loadSavedAll();
    }
  }, [active]);

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

  // Restore Interview draft on mount (mobile resilience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('interview_draft');
      if (!raw) return;
      const d = JSON.parse(raw || '{}');
      let restored = false;
      if (d.ivType && typeof d.ivType === 'string') { setIvType(d.ivType); restored = true; }
      if (d.ivRole && typeof d.ivRole === 'string') { setIvRole(d.ivRole); restored = true; }
      if (d.ivCompany && typeof d.ivCompany === 'string') { setIvCompany(d.ivCompany); restored = true; }
      if (restored) { toast({ title: 'Draft restored', description: 'Recovered interview inputs.' }); }
      localStorage.removeItem('interview_draft');
    } catch {}
  }, []);

  // Generate career recommendations (heuristic across many professions based on user's own text)
  const getCareerRecommendations = async () => {
    if (!cpText.trim()) { toast({ title: 'Input required', variant: 'destructive' }); return; }
    setFunFact(getRandomFunFact());
    setLoading(true);
    try {
      // Usage is tracked server-side
            const resp = await fetch(`${API_BASE}/career/planner`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ resume_text: cpText, userId })
      });
      if (resp.status === 403) {
        const data = await resp.json();
        toast({ title: 'Limit reached', description: data?.error || 'Monthly limit reached', variant: 'destructive' });
        setLoading(false);
        return;
      }
      let data: any = null;
      try { data = await resp.json(); } catch {}
      if (!resp.ok || (data && data.error)) throw new Error((data && (data.error || data.message)) || resp.statusText || 'Failed to generate recommendations');
      const arr = Array.isArray(data.recommendations) ? data.recommendations : [];
      const recs: { title: string; reasoning: string }[] = arr.map((r: any) => ({ title: String(r?.title || ''), reasoning: String(r?.reasoning || '') })).filter((r: { title: string; reasoning: string }) => r.title && r.reasoning);
      setCpRecs(recs);
      toast({ title: 'Recommendations ready', description: `${recs.length} roles suggested` });
    } catch {
      toast({ title: 'Generation failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Save full career plan
  const saveCareerPlan = async () => {
    if (!userId) { toast({ title: "Not signed in", variant: "destructive" }); return; }
    if (!cpRecs || cpRecs.length === 0) { toast({ title: "Nothing to save", variant: "destructive" }); return; }
    try {
      const recsNormalized = cpRecs.map((r) => ({
        title: r.title,
        reasoning: r.reasoning,
        description: r.reasoning,
      }));
      await addDoc(collection(db, "users", userId, "career_plans"), {
        title: `Career Recommendations, ${new Date().toLocaleDateString()}`,
        input: cpText,
        recommendations: recsNormalized,
        created_at: serverTimestamp(),
      });
      try { await awardAchievement(userId, 'career_plan_saved'); } catch {}
      try { await trackCareerUse(); } catch {}
      toast({ title: "Saved", description: "Career recommendations saved." });
      if (active === 'saves') loadSavedAll();
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  // Save a single recommendation
  const saveSingleCareerRec = async (index: number) => {
    if (!userId) { toast({ title: "Not signed in", variant: "destructive" }); return; }
    const rec = cpRecs[index];
    if (!rec) { return; }
    try {
      await addDoc(collection(db, "users", userId, "career_recs"), {
        title: rec.title,
        reasoning: rec.reasoning,
        description: rec.reasoning,
        source_label: cpLabel || null,
        input: cpText || null,
        created_at: serverTimestamp(),
      });
      toast({ title: "Saved", description: "Recommendation saved." });
      if (active === 'saves') loadSavedAll();
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  // Open editor for a generated LinkedIn variation
  const openEditLinkedinGenerated = (index: number) => {
    setLiEditIndex(index);
    setLiEditSavedId(null);
    setLiEditText(liVariations[index] || "");
    setLiEditOpen(true);
  };

  // Open editor for a saved LinkedIn item
  const openEditLinkedinSaved = async (item: SavedItem) => {
    try {
      setFunFact(getRandomFunFact());
      setLoading(true);
      const ref = doc(db, "users", userId, "linkedin_posts", item.id);
      const snap = await getDoc(ref);
      const data: any = snap.exists() ? snap.data() : {};
      setLiEditSavedId(item.id);
      setLiEditIndex(null);
      setLiEditText(data.selected_post || "");
      setLiEditOpen(true);
    } catch (e) {
      toast({ title: "Load failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Persist edits
  const applyLinkedinEditLocally = () => {
    if (liEditIndex === null) return;
    setLiVariations(prev => {
      const copy = [...prev];
      copy[liEditIndex] = liEditText;
      return copy;
    });
    toast({ title: "Updated", description: "Post updated locally" });
    setLiEditOpen(false);
  };

  const saveEditedLinkedinAsNew = async () => {
    if (!userId) { toast({ title: "Not signed in", variant: "destructive" }); return; }
    try {
      setFunFact(getRandomFunFact());
      setLoading(true);
      await addDoc(collection(db, "users", userId, "linkedin_posts"), {
        topic: liTopic,
        post_type: liPostType,
        tone: liTone,
        viral_boost: true,
        generated_posts: liVariations,
        selected_post: liEditText,
        created_at: serverTimestamp(),
      });
      try { await awardAchievement(userId, 'linkedin_saved'); } catch {}
      try { await trackCareerUse(); } catch {}
      toast({ title: "Saved", description: "Edited post saved to your dashboard." });
      setLiEditOpen(false);
      if (active === 'saves') loadSavedAll();
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updateSavedLinkedin = async () => {
    if (!userId || !liEditSavedId) { toast({ title: "Not signed in", variant: "destructive" }); return; }
    try {
      setFunFact(getRandomFunFact());
      setLoading(true);
      await updateDoc(doc(db, "users", userId, "linkedin_posts", liEditSavedId), {
        selected_post: liEditText,
        updated_at: serverTimestamp(),
      });
      toast({ title: "Updated", description: "Saved post updated." });
      setLiEditOpen(false);
      loadSavedAll();
    } catch (e) {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [filters, setFilters] = useState<SaveType[]>([]);

  // Save dialog state
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");

  // Delete confirmation
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmType, setConfirmType] = useState<SaveType | null>(null);

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameType, setRenameType] = useState<SaveType | null>(null);

  // Preview dialog state for My Saves
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewBody, setPreviewBody] = useState("");
  const [previewType, setPreviewType] = useState<SaveType | null>(null);
  const [previewHTML, setPreviewHTML] = useState<string | null>(null);

  // Reactive one-page limit state
  const [overPageLimit, setOverPageLimit] = useState(false);
  const [, setShowLimitOverlay] = useState(false);
  const [autoTrimming, setAutoTrimming] = useState(false);

  const canUseCareer = !gate.loading && (
    !!(gate as any).careerAccess || (gate as any).plan === 'advanced' || (gate as any).plan === 'pro'
  );

  // Load all saved items across collections and sort latest modified first
  const loadSavedAll = async () => {
    if (!userId) return;
    try {
      setLoadingSaved(true);
      const all: SavedItem[] = [];

      // OPTIMIZED: Add limits to all career queries to reduce reads
      // Resumes
      try {
        const q1 = query(collection(db, 'users', userId, 'career_resumes'), limit(20));
        const s1 = await getDocs(q1);
        s1.forEach((d) => {
          const data: any = d.data() || {};
          all.push({
            id: d.id,
            type: 'resume',
            title: String(data.label || 'Resume'),
            subtitle: '',
            raw: data,
            created_at: data.updated_at || data.createdAt || data.created_at || data.timestamp || null,
          });
        });
      } catch {}

      // LinkedIn posts
      try {
        const q2 = query(collection(db, 'users', userId, 'linkedin_posts'), limit(30));
        const s2 = await getDocs(q2);
        s2.forEach((d) => {
          const data: any = d.data() || {};
          all.push({
            id: d.id,
            type: 'linkedin',
            title: String(data.topic || 'LinkedIn Post'),
            subtitle: String(data.post_type || ''),
            raw: data,
            created_at: data.updated_at || data.created_at || data.timestamp || null,
          });
        });
      } catch {}

      // Interview sessions (drafts and completed)
      try {
        const q3 = query(collection(db, 'users', userId, 'interview_sessions'), limit(30));
        const s3 = await getDocs(q3);
        s3.forEach((d) => {
          const data: any = d.data() || {};
          const title = String(data.job_title || 'Interview');
          const sub = [data.interview_type, data.company_name].filter(Boolean).join(' • ');
          const rawStatus = String(data.status || '').trim();
          const statusPretty = rawStatus === 'in_progress'
            ? 'In Progress'
            : rawStatus === 'completed'
              ? 'Completed'
              : (rawStatus ? rawStatus.replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase()) : '');
          all.push({
            id: d.id,
            type: 'interview',
            title: sub ? `${title} @ ${data.company_name}`.trim() : title,
            subtitle: statusPretty || String(data.interview_type || ''),
            raw: data,
            created_at: data.updated_at || data.timestamp || data.created_at || null,
          });
        });
      } catch {}

      // Individual career recommendations
      try {
        const q5 = query(collection(db, 'users', userId, 'career_recs'), limit(20));
        const s5 = await getDocs(q5);
        s5.forEach((d) => {
          const data: any = d.data() || {};
          all.push({
            id: d.id,
            type: 'career_recs',
            title: String(data.title || 'Career Recommendation'),
            subtitle: '',
            raw: data,
            created_at: data.updated_at || data.created_at || data.timestamp || null,
          });
        });
      } catch {}

      // Sort by latest modified first using created_at-like fields
      const toMillis = (v: any): number => {
        if (!v) return 0;
        if (typeof v === 'number') return v;
        if (typeof v.toMillis === 'function') return v.toMillis();
        const t = Date.parse(String(v));
        return isNaN(t) ? 0 : t;
      };
      all.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
      setSavedItems(all);
    } finally {
      setLoadingSaved(false);
    }
  };

  // Auto-load when switching to My Saves
  useEffect(() => {
    if (active === 'saves') {
      loadSavedAll();
    }
  }, [active, userId]);

  // Template definitions with proper data
  const templates = {
    professional: {
      name: "Professional",
      description: "Clean, modern design with clear section separation",
      className: "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans",
      data: {
        fullName: "Alex Johnson",
        email: "alex.johnson@email.com",
        phone: "(555) 123-4567",
        location: "San Francisco, CA",
        linkedin: "linkedin.com/in/alexjohnson",
        portfolio: "alexjohnson.dev"
      },
      sections: [
        {
          id: "experience",
          type: "experience", 
          content: `Senior Software Engineer, TechCorp Inc. | 2020 to Present
• Led development of customer dashboard serving 50k+ users, improving load time by 40%
• Implemented microservices architecture reducing deployment failures by 60%
• Mentored 3 junior developers and conducted code reviews

Software Developer, StartupXYZ | 2018 to 2020  
• Built responsive React applications with 99.9% uptime
• Collaborated with design team to implement new UI components
• Reduced API response time by 30% through optimization

Frontend Engineer, WebWorks | 2016 to 2018
• Implemented reusable UI components reducing code duplication by 25%
• Improved accessibility (WCAG 2.1 AA) across 10+ pages

Software Intern, Innovate Labs | Summer 2015
• Built internal tools in React/Node to automate reporting
• Wrote unit tests increasing coverage from 50% to 80%`
        },
        {
          id: "education", 
          type: "education",
          content: `Master of Science in Computer Science, Stanford University | 2018
• GPA: 3.8/4.0
• Relevant coursework: Algorithms, Distributed Systems, Machine Learning

Bachelor of Science in Software Engineering, UC Berkeley | 2016
• Graduated Magna Cum Laude
• President of Computer Science Club`
        },
        {
          id: "skills",
          type: "skills", 
          content: `Programming: JavaScript, TypeScript, Python, Java
Frameworks: React, Node.js, Express, Next.js
Tools: Git, Docker, AWS, MongoDB, PostgreSQL
Soft Skills: Leadership, Communication, Problem Solving`
        },
        {
          id: "projects",
          type: "projects",
          content: `E-commerce Platform | React, Node.js, MongoDB
• Built full-stack application processing $1M+ annual sales
• Implemented real-time inventory management system

Task Management App | React Native, Firebase
• 10k+ downloads with 4.8-star rating
• Push notifications and offline-first architecture`
        },
        {
          id: "certifications",
          type: "certifications",
          content: `AWS Certified Solutions Architect, Associate (2023)
Scrum Master Certified (SMC) (2022)
Google Professional Cloud Developer (2021)`
        }
      ]
    },
    classic: {
      name: "Classic", 
      description: "Traditional resume format with timeless styling",
      className: "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-serif",
      data: {
        fullName: "Michael Chen",
        email: "michael.chen@email.com",
        phone: "(555) 987-6543",
        location: "New York, NY",
        linkedin: "linkedin.com/in/michaelchen",
        portfolio: "michaelchen.dev"
      },
      sections: [
        {
          id: "summary",
          type: "summary",
          content: "Experienced software developer with expertise in full-stack development and system architecture. Proven track record of delivering high-quality solutions in fast-paced environments."
        },
        {
          id: "experience",
          type: "experience", 
          content: `Senior Developer, FinancialCorp | 2019 to Present
• Developed high-frequency trading systems processing 10k+ transactions/sec
• Optimized database queries reducing latency by 50%
• Led team of 5 developers on critical projects

Software Engineer, TechStart | 2017 to 2019
• Built RESTful APIs serving mobile and web clients
• Implemented CI/CD pipelines reducing deployment time by 70%

Frontend Developer, MediaHouse | 2015 to 2017
• Modernized legacy UI to React, reducing bundle size by 35%
• Established coding standards and review practices

Software Intern, CityTech | Summer 2014
• Assisted with QA automation and bug triage
• Contributed to internal tooling in Python`
        },
        {
          id: "education", 
          type: "education",
          content: `Master of Computer Science, MIT | 2017
• Focus: Systems, Distributed Computing
• Dean's List

Bachelor of Computer Engineering, University of Michigan | 2015
• Minor in Mathematics
• Honors Program`
        },
        {
          id: "skills",
          type: "skills", 
          content: `Languages: Java, Python, SQL, JavaScript
Technologies: Spring Boot, React, AWS, Docker
Methodologies: Agile, TDD, Microservices`
        },
        {
          id: "projects",
          type: "projects",
          content: `Trading Platform | Java, Spring Boot
• Built real-time trading platform handling $50M+ daily volume
• Implemented risk management system preventing $2M in potential losses

Mobile Banking App | React Native, Node.js
• 50k+ active users, 4.9-star rating
• Reduced app crash rate by 80% through improved error handling`
        }
      ]
    },
    'two-column': {
      name: "Two-Column",
      description: "Modern layout with sidebar for contact info and skills",
      className: "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans",
      data: {
        fullName: "Sarah Williams",
        email: "sarah.williams@email.com",
        phone: "(555) 456-7890",
        location: "Austin, TX",
        linkedin: "linkedin.com/in/sarahwilliams",
        portfolio: "sarahwilliams.design"
      },
      sections: [
        {
          id: "summary",
          type: "summary",
          content: "Creative Frontend Developer with 4+ years of experience building beautiful, responsive web applications. Passionate about UX design and creating intuitive user interfaces that drive engagement and conversion."
        },
        {
          id: "experience",
          type: "experience", 
          content: `Frontend Developer, DesignStudio | 2020 to Present
• Led redesign of company website resulting in 35% increase in user engagement
• Implemented design system used by 15+ developers across the organization
• Optimized Core Web Vitals scores leading to 20% improvement in SEO ranking

UI Engineer, CreativeLabs | 2018 to 2020
• Developed component library reducing development time by 40%
• Collaborated with UX team to implement user-centered design principles
• Built responsive layouts supporting 50+ device types and screen sizes

Junior Frontend Engineer, PixelWorks | 2016 to 2018
• Migrated jQuery widgets to Vue/React components
• Established visual regression tests with Storybook

Design Intern, BrightStart | Summer 2015
• Prototyped interactive UI concepts in Figma
• Conducted user testing and synthesized insights`
        },
        {
          id: "education",
          type: "education",
          content: `Master of Science in Human-Computer Interaction, UT Austin | 2018
• GPA: 3.8/4.0
• Focus: UX, Accessible Design

Bachelor of Science in Computer Science, University of Texas | 2016
• GPA: 3.7/4.0
• Relevant coursework: Data Structures, Web Development, HCI`
        },
        {
          id: "skills",
          type: "skills", 
          content: `Frontend: React, Vue, TypeScript, CSS3, HTML5
Tools: Figma, Webpack, Git, Jest
Design: UI/UX, Responsive Design, Prototyping`
        },
        {
          id: "projects",
          type: "projects",
          content: `E-commerce Platform Redesign | React, Node.js
• Increased conversion rate by 25% through improved UX design
• Reduced page load time from 4s to 1.2s through code optimization

Design System | Storybook, React
• Created comprehensive design system with 50+ reusable components
• Improved design consistency across 10+ company products

Analytics Dashboard | Next.js, Prisma, PostgreSQL
• Built role-based analytics dashboards used by 200+ internal users
• Implemented cached queries cutting average load time by 60%

Marketing Microsites | Astro, Tailwind CSS
• Shipped 5+ campaign microsites with Lighthouse 95+ scores
• Set up reusable templates reducing time-to-launch by 40%

Real-time Chat Widget | React, WebSocket
• Developed embeddable support chat used on 20+ client sites
• Added offline queue and retries improving message reliability`
        }
      ]
    },
    custom: {
      name: "Custom",
      description: "Build your own resume from scratch",
      className: "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans",
      data: {
        fullName: "",
        email: "",
        phone: "",
        location: "",
        linkedin: "",
        portfolio: ""
      },
      sections: []
    }
  };

  // Check if resume exceeds one page
  const isOnePageLimitReached = () => {
    const previewElement = document.getElementById('resume-preview');
    if (!previewElement) return false;
    
    const contentHeight = previewElement.scrollHeight;
    const pageHeight = 11 * 96; // 11 inches in pixels (96px per inch)
    
    return contentHeight > pageHeight;
  };

  // Recompute page limit after layout when sections or resume data change
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setOverPageLimit(isOnePageLimitReached());
    });
    return () => cancelAnimationFrame(raf);
  }, [sections, resumeData, selectedTemplate, bodyFontSize, lineHeight, sectionGap, titleDescGap, titleFontSize]);

  // Transient overlay visibility: show for 5s when limit reached, hide when no longer over limit
  useEffect(() => {
    let timer: any;
    if (overPageLimit) {
      setShowLimitOverlay(true);
      timer = setTimeout(() => setShowLimitOverlay(false), 5000);
    } else {
      setShowLimitOverlay(false);
    }
    return () => timer && clearTimeout(timer);
  }, [overPageLimit]);

  // Auto-trim to fit one page by gradually removing text from the end
  const autoTrimToFit = async () => {
    if (autoTrimming) return;
    setAutoTrimming(true);
    try {
      // Limit iterations to avoid long loops
      for (let iter = 0; iter < 200; iter++) {
        if (!isOnePageLimitReached()) break;
        // Remove from the last non-empty section
        let targetIndex = -1;
        const currentSections = sections;
        for (let i = currentSections.length - 1; i >= 0; i--) {
          if ((currentSections[i].content || '').length > 0) { targetIndex = i; break; }
        }
        if (targetIndex === -1) break; // nothing to trim
        const target = currentSections[targetIndex];
        const old = target.content || '';
        const cut = Math.min(100, old.length);
        const nextContent = old.slice(0, old.length - cut);
        saveToHistory();
        setSections(prev => {
          const next = [...prev];
          if (nextContent.length === 0) {
            next.splice(targetIndex, 1);
          } else {
            next[targetIndex] = { ...next[targetIndex], content: nextContent } as any;
          }
          return next;
        });
        // Wait for layout update
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    } finally {
      setAutoTrimming(false);
    }
  };

  // When over the limit, begin auto-trimming
  useEffect(() => {
    if (overPageLimit && !autoTrimming) {
      autoTrimToFit();
    }
  }, [overPageLimit]);

  // Save state to history
  const saveToHistory = () => {
    setHistory(prev => [...prev, { sections: JSON.parse(JSON.stringify(sections)), resumeData: JSON.parse(JSON.stringify(resumeData)) }]);
    setFuture([]);
  };

  // Undo functionality
  const undo = () => {
    if (history.length === 0) return;
    
    const previousState = history[history.length - 1];
    setFuture(prev => [{ sections: JSON.parse(JSON.stringify(sections)), resumeData: JSON.parse(JSON.stringify(resumeData)) }, ...prev]);
    setSections(previousState.sections);
    setResumeData(previousState.resumeData);
    setHistory(prev => prev.slice(0, -1));
  };

  // Redo functionality
  const redo = () => {
    if (future.length === 0) return;
    
    const nextState = future[0];
    setHistory(prev => [...prev, { sections: JSON.parse(JSON.stringify(sections)), resumeData: JSON.parse(JSON.stringify(resumeData)) }]);
    setSections(nextState.sections);
    setResumeData(nextState.resumeData);
    setFuture(prev => prev.slice(1));
  };

  // Drag and drop functionality
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      saveToHistory();
      const newSections = [...sections];
      const draggedItem = newSections[dragItem.current];
      newSections.splice(dragItem.current, 1);
      newSections.splice(dragOverItem.current, 0, draggedItem);
      setSections(newSections);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragOverIndex(null);
  };

  // Update section content
  
  // Add new section
  const addSection = (type: string) => {
    if (overPageLimit) {
      toast({ title: "Page limit reached", description: "Cannot add more sections. Consider editing existing sections or removing content.", variant: "destructive" });
      return;
    }
    
    saveToHistory();
    const newSection: ResumeSection = {
      id: `section-${Date.now()}`,
      type,
      content: ""
    };
    setSections(prev => [...prev, newSection]);
    setCurrentSection(newSection.id);
  };

  // Delete section
  const deleteSection = (sectionId: string) => {
    saveToHistory();
    setSections(prev => prev.filter(section => section.id !== sectionId));
    if (currentSection === sectionId) {
      setCurrentSection(null);
    }
    if (editingSection?.id === sectionId) {
      setEditingSection(null);
    }
  };

  // Open section editor
  const openSectionEditor = (section: ResumeSection, event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setEditingSection({...section});
    setEditPosition({
      top: Math.min(rect.top - 300, window.innerHeight - 400),
      left: Math.min(rect.left + 400, window.innerWidth - 500)
    });
  };

  // Close section editor and save changes
  const closeSectionEditor = () => {
    if (editingSection) {
      saveToHistory();
      setSections(prev => prev.map(s =>
        s.id === editingSection.id ? { ...s, content: editingSection.content, style: editingSection.style } : s
      ));
    }
    setEditingSection(null);
  };

  // Apply template
  const applyTemplate = (template: TemplateType) => {
    saveToHistory();
    setSelectedTemplate(template);
    const templateData = templates[template];
    
    setResumeData(templateData.data);
    setSections([...templateData.sections]);
  };

  // Update resume data
  const updateResumeData = (field: string, value: string) => {
    saveToHistory();
    setResumeData(prev => ({ ...prev, [field]: value }));
  };

  // Quick AI-like resume rater (local heuristic)
  const [aiReview, setAiReview] = useState<{
    score: number;
    summary?: string;
    strengths?: string[];
    improvements?: string[];
    examples?: Array<{ original: string; improved: string; rationale?: string }>;
    tips?: string[]; // fallback from heuristic
    timestamp: number;
  } | null>(null);
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const { showAnimation: showResumeAnim, triggerAnimation: triggerResumeAnim } = useUsageAnimation();
  const { showAnimation: showLinkedInAnim, triggerAnimation: triggerLinkedInAnim } = useUsageAnimation();
  const { showAnimation: showInterviewAnim, triggerAnimation: triggerInterviewAnim } = useUsageAnimation();
  const { showAnimation: showCareerAnim, triggerAnimation: triggerCareerAnim } = useUsageAnimation();

  const rateResume = async () => {
    try {
      // Guard: require some content
      const combined = sections.map((s) => `${s.type.toUpperCase()}\n${(s.content || '').trim()}`).join('\n\n').trim();
      if (!combined || combined.length < 10) {
        toast({ title: 'Add resume content', description: 'Please add some resume content before rating.', variant: 'destructive' });
        return;
      }
      // Show overlay
      try { setLoading(true); } catch {}
      try { setFunFact && setFunFact(getRandomFunFact?.()); } catch {}
      // Usage is tracked server-side

      const role = '';

      // Call backend resume grader for specific improvements and examples
      let result: any = null;
      try {
                const resp = await fetch(`${API_BASE}/career/rate-resume`, {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ text: combined, role, userId })
        });
        if (resp.status === 403) {
          result = await resp.json().catch(() => ({}));
          toast({ title: 'Limit reached', description: result?.error || 'Monthly limit reached', variant: 'destructive' });
          setLoading(false);
          return;
        }
        result = await resp.json().catch(() => null);
        if (!resp.ok || result?.error) throw new Error(result?.error || 'Failed');
        const review = {
          score: Number(result.score) || 0,
          summary: String(result.summary || ''),
          strengths: Array.isArray(result.strengths) ? result.strengths : [],
          improvements: Array.isArray(result.improvements) ? result.improvements : [],
          examples: Array.isArray(result.examples) ? result.examples : [],
          tips: Array.isArray(result.tips) ? result.tips : [],
          timestamp: Date.now(),
        };
        setAiReview(review);
        setAiReviewOpen(true);
        return;
      } catch {}

      // Fallback: local heuristic if API fails
      let score = 30;
      const tips: string[] = [];
      const secCount = sections.length;
      const has = (t: string) => sections.some(s => s.type.toLowerCase().includes(t));
      if (resumeData.fullName) score += 6; else tips.push('Add your full name.');
      const contactFields = [resumeData.email, resumeData.phone, resumeData.location].filter(Boolean).length;
      score += Math.min(6, contactFields * 2);
      if (contactFields < 3) tips.push('Complete email, phone, and location.');
      if (resumeData.linkedin || resumeData.portfolio) score += 4; else tips.push('Add LinkedIn or portfolio for credibility.');
      if (secCount >= 5) score += 8; else if (secCount >= 3) score += 4; else tips.push('Add core sections: Experience, Education, Skills, Projects.');
      if (has('experience')) score += 8; else tips.push('Include Experience with quantified impact.');
      if (has('education')) score += 4; else tips.push('Include Education.');
      if (has('skills')) score += 4; else tips.push('Add a concise Skills section.');
      const totalChars = sections.reduce((a, s) => a + (s.content?.length || 0), 0);
      if (totalChars < 400) { score -= 15; tips.push('Add more substantive content (aim for 800+ chars).'); }
      else if (totalChars < 800) { score -= 6; tips.push('Increase detail and specifics.'); }
      const bulletLines = sections.reduce((a, s) => a + (s.content.match(/(^|\n)\s*([•\-\u2022])/g)?.length || 0), 0);
      if (bulletLines < 5) tips.push('Use bullet points to improve scannability (8+ ideal).');
      score = Math.max(0, Math.min(100, Math.round(score)));
      setAiReview({ score, tips: tips.slice(0,8), timestamp: Date.now() });
      setAiReviewOpen(true);
    } catch (e) {
      toast({ title: 'Rating failed', description: 'Could not evaluate resume', variant: 'destructive' });
    } finally { try { setLoading(false); } catch {} }
  };

  // AI Optimize - enhance resume content with better phrasing, metrics, and formatting
  const optimizeResume = async () => {
    const combined = sections.map(s => `[${s.type.toUpperCase()}]\n${(s.content || '').trim()}`).join('\n\n').trim();
    if (!combined || combined.length < 20) {
      toast({ title: 'Add content first', description: 'Add resume content before optimizing.', variant: 'destructive' });
      return;
    }
    try {
      setLoading(true);
      setFunFact(getRandomFunFact());

            const resp = await fetch(`${API_BASE}/career/optimize-resume`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          resumeData,
          sections: sections.map(s => ({ type: s.type, content: s.content })),
          userId
        })
      });

      if (resp.status === 403) {
        const data = await resp.json().catch(() => ({}));
        toast({ title: 'Limit reached', description: data?.error || 'Monthly limit reached', variant: 'destructive' });
        return;
      }

      const result = await resp.json().catch(() => null);
      if (resp.ok && result && Array.isArray(result.sections)) {
        saveToHistory();
        const optimized = result.sections as Array<{ type: string; content: string }>;
        setSections(prev => prev.map(s => {
          const match = optimized.find(o => o.type.toLowerCase() === s.type.toLowerCase());
          return match ? { ...s, content: match.content } : s;
        }));
        if (result.resumeData) {
          setResumeData(prev => ({ ...prev, ...result.resumeData }));
        }
        toast({ title: 'Resume optimized!', description: 'AI has enhanced your resume content.' });
        return;
      }

      // Fallback: local optimization if API not available
      saveToHistory();
      setSections(prev => prev.map(s => {
        let content = s.content || '';
        // Add bullet points to lines that look like achievements
        content = content.replace(/^(?![\s]*[•\-\*])((?:Led|Built|Developed|Managed|Created|Implemented|Designed|Improved|Reduced|Increased|Achieved|Optimized|Launched|Established|Delivered|Coordinated|Streamlined|Automated|Spearheaded|Mentored)[^\n]*)/gm, '• $1');
        // Capitalize first letter after bullets
        content = content.replace(/^([•\-\*]\s*)([a-z])/gm, (_m, bullet, letter) => `${bullet}${letter.toUpperCase()}`);
        return { ...s, content };
      }));
      toast({ title: 'Resume polished!', description: 'Basic formatting improvements applied. For AI-powered optimization, ensure the backend is available.' });
    } catch (error) {
      toast({ title: 'Optimization failed', description: 'Could not optimize resume', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Fill resume builder from uploaded text
  const fillTemplateFromUpload = async () => {
    if (loading) return;
    if (!uploadedText || uploadedText.length < 20) {
      toast({ title: 'Upload a resume first', description: 'Upload a PDF or DOCX to fill the template.', variant: 'destructive' });
      return;
    }
    try {
      setLoading(true);
      setFunFact(getRandomFunFact());

            const resp = await fetch(`${API_BASE}/career/parse-resume`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ text: uploadedText, userId })
      });

      if (resp.ok) {
        const result = await resp.json().catch(() => null);
        if (result) {
          saveToHistory();
          if (result.resumeData) {
            setResumeData(prev => ({
              ...prev,
              fullName: result.resumeData.fullName || prev.fullName,
              email: result.resumeData.email || prev.email,
              phone: result.resumeData.phone || prev.phone,
              location: result.resumeData.location || prev.location,
              linkedin: result.resumeData.linkedin || prev.linkedin,
              portfolio: result.resumeData.portfolio || result.resumeData.website || prev.portfolio,
            }));
          }
          if (Array.isArray(result.sections) && result.sections.length > 0) {
            setSections(result.sections.map((s: any, i: number) => ({
              id: `parsed-${i}-${Date.now()}`,
              type: String(s.type || 'experience').toLowerCase(),
              content: String(s.content || ''),
            })));
          }
          setResumeMode('build');
          toast({ title: 'Template filled!', description: 'Resume data extracted and loaded into the builder.' });
          return;
        }
      }

      // Fallback: basic local parsing
      saveToHistory();
      const lines = uploadedText.split('\n').map(l => l.trim()).filter(Boolean);
      // Try to extract name from first non-empty line
      const nameLine = lines[0] || '';
      // Try to find email
      const emailMatch = uploadedText.match(/[\w.-]+@[\w.-]+\.\w+/);
      const phoneMatch = uploadedText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);

      setResumeData(prev => ({
        ...prev,
        fullName: nameLine.length < 50 ? nameLine : prev.fullName,
        email: emailMatch ? emailMatch[0] : prev.email,
        phone: phoneMatch ? phoneMatch[0] : prev.phone,
      }));

      // Put all text as experience
      setSections([{
        id: `parsed-exp-${Date.now()}`,
        type: 'experience',
        content: uploadedText.substring(0, 2000),
      }]);
      setResumeMode('build');
      toast({ title: 'Basic extraction done', description: 'Content loaded. Edit sections to organize your resume.' });
    } catch {
      toast({ title: 'Parsing failed', description: 'Could not extract resume data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Download as PDF
  const exportResume = async () => {
    try {
      // Use current data or template defaults to avoid blank output
      const srcSections = (sections && sections.length > 0) ? sections : templates[selectedTemplate].sections;
      const srcData = (resumeData && (resumeData.fullName || resumeData.email)) ? resumeData : templates[selectedTemplate].data;

      const formattedSections = srcSections.map(s => ({
        id: s.id,
        title: s.type.charAt(0).toUpperCase() + s.type.slice(1),
        content: s.content
      }));

      const html = generateResumePDFHTML(srcData, formattedSections, fontFamily);
      const filename = `resume-${(srcData.fullName || 'untitled').replace(/\s+/g, '_')}`;
      
      await downloadPDF(html, { filename, margin: 15 });
      try { await awardAchievement(userId, 'resume_export'); } catch {}
      try { await trackCareerUse(); } catch {}
      toast({ title: 'Downloaded!', description: 'Resume saved as PDF' });
    } catch (error: any) {
      console.error('Export error:', error);
      toast({ title: 'Download failed', description: error?.message || 'Could not download resume', variant: 'destructive' });
    }
  };

  // Save resume
  const saveResume = async (customLabel?: string) => {
    if (overPageLimit) {
      toast({ title: "Page limit reached", description: "Reduce content or spacing to save within one page.", variant: "destructive" });
      return;
    }
    if (!userId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    
    try {
      await addDoc(collection(db, "users", userId, "career_resumes"), {
        label: customLabel || `${resumeData.fullName}, Resume`,
        resumeData,
        sections,
        template: selectedTemplate,
        createdAt: serverTimestamp(),
      });
      try { await awardAchievement(userId, 'first_resume'); } catch {}
      try { await trackCareerUse(); } catch {}
      toast({ title: "Saved", description: "Resume saved successfully" });
      setSaveOpen(false);
      if (active === 'saves') loadSavedAll();
    } catch (error) {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  // Generate LinkedIn post
  const generateLinkedIn = async () => {
    if (!liTopic.trim()) {
      toast({ title: "Topic required", variant: "destructive" });
      return;
    }
    
    setFunFact(getRandomFunFact());
    setLoading(true);
    try {
      // Track usage for LinkedIn post generation
      try { await incrementMonthlyUsage(userId, { inputChars: Math.max(1, liTopic.trim().length) }); } catch (e: any) {
        toast({ title: 'Limit reached', description: e?.message || 'You have reached your monthly limit.', variant: 'destructive' });
        setLoading(false);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1200));
      const topic = liTopic.trim();
      const variations: string[] = [];
      variations.push(
        `Proud to share progress on ${topic}. This effort emphasized clear objectives, disciplined execution, and measurable outcomes. Grateful for the collaboration that helped de-risk key assumptions and deliver consistent results. Happy to discuss lessons learned with anyone tackling similar work. #ProfessionalDevelopment #Execution #Impact`,
      );
      variations.push(
        `Recently completed a milestone related to ${topic}. The focus was on quality, reliability, and stakeholder alignment. Thanks to everyone who contributed feedback along the way. Looking forward to applying these practices to the next initiative. #Leadership #Quality #Collaboration`,
      );
      variations.push(
        `Successfully advanced ${topic} 🚀 with a strong emphasis on clarity, iteration, and outcomes. Appreciative of the cross-functional partnership that kept us on track ✅. Excited to build on this momentum. #Teamwork #ContinuousImprovement #Results`,
      );
      variations.push(
        `Wrapped a key phase of ${topic} 📈. We prioritized user value, tight feedback loops, and maintainability ✅. Thanks to the team for the thoughtful collaboration. Next step: scale what’s working. #ProductDevelopment #Growth #Engineering`,
      );
      variations.push(
        `Big news-I’ve been working on ${topic} and it’s been a rewarding ride 🙌. Learned a ton, got great input from the team, and can’t wait to keep pushing this forward 🎯. If you’ve done something similar, I’d love to hear your tips! #Learning #Community #Tech`,
      );
      setLiVariations(variations);
    } finally {
      setLoading(false);
    }
  };

  // Save LinkedIn post
  const saveLinkedIn = async (selectedIndex: number) => {
    if (!userId) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    
    try {
      const selected = liVariations[selectedIndex] || liVariations[0];
      await addDoc(collection(db, "users", userId, "linkedin_posts"), {
        topic: liTopic,
        post_type: liPostType,
        tone: liTone,
        viral_boost: true,
        generated_posts: liVariations,
        selected_post: selected,
        created_at: serverTimestamp(),
      });
      try { await awardAchievement(userId, 'linkedin_saved'); } catch {}
      try { await trackCareerUse(); } catch {}
      toast({ title: "Saved", description: "Post saved to your dashboard." });
      if (active === 'saves') loadSavedAll();
    } catch (error) {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  // Generate interview questions
  const generateInterview = async () => {
    if (!ivRole.trim()) {
      toast({ title: "Role required", variant: "destructive" });
      return;
    }
    setFunFact(getRandomFunFact());
    setLoading(true);
    try {
      // Usage is tracked server-side

      // Try backend interview generation first
      let questions: string[] | null = null;
      try {
                const resp = await fetch(`${API_BASE}/career/interview/start`, {
          method: 'POST',
          headers: await getAuthHeaders(),
          body: JSON.stringify({ interview_type: ivType, job_title: ivRole, company_name: ivCompany, userId })
        });
        if (resp.status === 403) {
          const data = await resp.json().catch(() => ({}));
          toast({ title: 'Limit reached', description: data?.error || 'Monthly limit reached', variant: 'destructive' });
          setLoading(false);
          return;
        }
        const data = await resp.json().catch(()=>({}));
        if (resp.ok && Array.isArray(data.questions) && data.questions.length) {
          questions = data.questions.slice(0, 10).map((q: any) => String(q));
        }
      } catch {}
      // Fallback: local static questions
      if (!questions) {
        await new Promise(resolve => setTimeout(resolve, 600));
        questions = [
          `Can you walk me through your experience with ${ivRole} and what specifically draws you to this field?`,
          `Describe a complex project you worked on recently. What was your role and what were the key challenges you faced?`,
          `How do you approach learning new technologies or skills when required for a project?`,
          `Tell me about a time you had to deal with a difficult team member or stakeholder. How did you handle the situation?`,
          `What metrics do you use to measure the success of your work, and can you provide a specific example?`,
          `How do you stay updated with the latest trends and best practices in ${ivRole}?`,
          `Describe a situation where you had to make a technical decision without complete information. What was your process?`,
          `What's your experience with agile methodologies, and how do you handle changing requirements mid-sprint?`,
          `Can you give an example of how you've mentored junior team members or contributed to team knowledge sharing?`,
          `Where do you see yourself in your career in 3-5 years, and how does this role align with those goals?`
        ];
      }
      setIvQuestions(questions);
      setIvInSession(true);
      setIvIndex(0);
      setIvAnswer('');
      setIvFeedbacks(new Array(questions.length).fill(undefined as any));
      setIvAnswers(Array(questions.length).fill(''));
      setIvSummary(null);
      setIvSessionId(null);
      setReviewMode(false);
      toast({ title: "Questions ready", description: `${questions.length} questions generated` });
    } catch (error) {
      toast({ title: "Generation failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

const submitInterviewAnswer = async () => {
  if (!ivInSession || ivIndex >= ivQuestions.length) return;
  const a = ivAnswer.trim();
  if (!a) { toast({ title:'Answer required', variant:'destructive' }); return; }
  
  setLoading(true);
  try {
    // Try backend evaluation first
    let feedback: IvFeedback | null = null;
    try {
            const resp = await fetch(`${API_BASE}/career/interview/answer`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ question: ivQuestions[ivIndex], answer: a, feedback_tone: 'Professional' })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && typeof data === 'object') {
        feedback = {
          clarity: Number(data.clarity || 0),
          confidence: Number(data.confidence || 0),
          relevance: Number(data.relevance || 0),
          feedback: String(data.feedback || ''),
          improved: String(data.improved || ''),
        };
      }
    } catch {}

    // Fallback: heuristic if API fails
    if (!feedback) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const txt = a;
      const len = txt.length;
      const hasBullets = /(^|\n)[\-•\*]/.test(txt);
      const hasNumbers = /\d|%/.test(txt);
      const mentionsRole = ivRole && new RegExp(ivRole.split(/\s+/).join('|'), 'i').test(txt);
      const sentences = txt.split(/[.!?\n]+/).filter(s => s.trim().length > 0).length;
      const base = Math.min(90, Math.max(10, Math.round(len / 6)));
      let clarity = base + (hasBullets ? 8 : 0) + (sentences > 2 ? 6 : 0);
      let confidence = base + (hasNumbers ? 8 : 0);
      let relevance = base + (mentionsRole ? 8 : 0);
      if (len < 30) { clarity = Math.min(clarity, 25); confidence = Math.min(confidence, 25); relevance = Math.min(relevance, 25); }
      clarity = Math.max(10, Math.min(90, clarity));
      confidence = Math.max(10, Math.min(90, confidence));
      relevance = Math.max(10, Math.min(90, relevance));
      feedback = {
        clarity,
        confidence,
        relevance,
        feedback: len < 30
          ? 'Response was too brief to evaluate effectively. Provide a structured answer with context, actions, and measurable outcomes.'
          : 'Clear structure and relevant details detected. Strengthen by adding quantitative outcomes and connecting actions to business impact.',
        improved: len < 30
          ? 'Use the STAR method (Situation, Task, Action, Result). Add 1-2 metrics (%, time saved, revenue impact) and tie your answer back to the role.'
          : 'Tighten the narrative with 1-2 precise metrics and explicitly map your experience to the target role’s requirements.'
      };
    }

    // Persist feedback and answer; then advance
    if (feedback) {
          // Build local copies to compute next target index deterministically
      const nextFeedbacks = (() => {
        const arr = Array.isArray(ivFeedbacks) ? [...ivFeedbacks] : [] as any[];
        arr[ivIndex] = feedback!;
        return arr as any;
      })();
      const nextAnswers = (() => {
        const arr = Array.isArray(ivAnswers) ? [...ivAnswers] : [] as any[];
        arr[ivIndex] = a;
        return arr as any;
      })();
      setIvFeedbacks(nextFeedbacks);
      setIvAnswers(nextAnswers as any);
      // Navigate to first unanswered; if none remain, user will see completion state
      let nextIdx = nextAnswers.findIndex((x: any) => !x || !String(x).trim());
      if (nextIdx === -1) {
        toast({ title: 'All questions answered', description: 'Review and finish when ready.' });
        nextIdx = ivQuestions.length; // out of range; render will show completion only when all are answered
      }
      setIvIndex(nextIdx);
      setIvAnswer('');
    }
  } catch (error) {
    toast({ title: 'Evaluation failed', variant: 'destructive' });
  } finally {
    setLoading(false);
  }
};

  // Finish interview
  const finishInterview = async () => {
    setFunFact(getRandomFunFact());
    setLoading(true);
    try {
      // Calculate overall scores from answered questions only
      const answeredIdx = ivAnswers.map((ans, i) => (ans && ans.trim().length > 0 ? i : -1)).filter(i => i >= 0);
      const used = answeredIdx.filter(i => ivFeedbacks[i]);
      let scores = { clarity: 0, confidence: 0, relevance: 0 };
      if (used.length > 0) {
        const clarity = Math.round(used.reduce((sum, i) => sum + (ivFeedbacks[i]!.clarity), 0) / used.length);
        const confidence = Math.round(used.reduce((sum, i) => sum + (ivFeedbacks[i]!.confidence), 0) / used.length);
        const relevance = Math.round(used.reduce((sum, i) => sum + (ivFeedbacks[i]!.relevance), 0) / used.length);
        scores = { clarity, confidence, relevance };
      } else {
        scores = { clarity: 0, confidence: 0, relevance: 0 };
      }
      setIvSummary(scores);
      
      // Save session
      if (userId) {
        await addDoc(collection(db, "users", userId, "interview_sessions"), {
          job_title: ivRole,
          interview_type: ivType,
          company_name: ivCompany,
          questions: ivQuestions,
          user_answers: ivAnswers,
          ai_feedback: ivFeedbacks,
          scores: scores,
          status: 'completed',
          timestamp: serverTimestamp(),
          completed_at: serverTimestamp(),
        });
        try { await awardAchievement(userId, 'interview_completed'); } catch {}
        try { await trackCareerUse(); } catch {}
      }
      
      setIvInSession(false);
      setReviewMode(true);
      toast({ title: "Session completed", description: "Interview session saved" });
    } catch (error) {
      toast({ title: "Failed to finish", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload for career recommendations
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await extractTextFromFile(file);
      setCpText(text);
      toast({ title: 'File uploaded', description: 'Resume content loaded successfully' });
    } catch (error) {
      toast({ title: "Upload failed", description: "Could not read the file", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Handle resume upload for Upload & Review mode
  const handleResumeUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setFunFact(getRandomFunFact());
      setUploadedFile(file);
      setUploadedText('');
      setUploadedReview(null);
      setPdfPages([]);
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const text = await extractTextFromFile(file);
      setUploadedText(text);
      if (isPdf) {
        const pageDataUrls = await renderPdfPages(file);
        setPdfPages(pageDataUrls);
      }
      toast({ title: 'Resume uploaded', description: 'File loaded successfully. Click "Grade My Resume" for AI feedback.' });
    } catch (error) {
      toast({ title: "Upload failed", description: "Could not read the file", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Grade uploaded resume with AI
  const gradeUploadedResume = async () => {
    if (loading) return;
    if (!uploadedText) {
      toast({ title: 'No resume uploaded', description: 'Please upload a resume first.', variant: 'destructive' });
      return;
    }

    try {
      setLoading(true);
      setFunFact(getRandomFunFact());

            const resp = await fetch(`${API_BASE}/career/rate-resume`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({ text: uploadedText, role: '', userId })
      });

      if (resp.status === 403) {
        const data = await resp.json().catch(() => ({}));
        toast({ title: 'Limit reached', description: data?.error || 'Monthly limit reached', variant: 'destructive' });
        return;
      }

      const result = await resp.json().catch(() => null);
      if (!resp.ok || result?.error) throw new Error(result?.error || 'Failed');

      const review = {
        score: Number(result.score) || 0,
        summary: String(result.summary || ''),
        strengths: Array.isArray(result.strengths) ? result.strengths : [],
        improvements: Array.isArray(result.improvements) ? result.improvements : [],
        examples: Array.isArray(result.examples) ? result.examples : [],
      };

      setUploadedReview(review);
      toast({ title: 'Resume graded', description: `Score: ${review.score}/100` });
    } catch (error) {
      toast({ title: 'Grading failed', description: 'Could not grade resume', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Clear uploaded resume
  const clearUploadedResume = () => {
    setUploadedFile(null);
    setUploadedText('');
    setUploadedReview(null);
    setPdfPages([]);
  };

  return (
    <div className="max-w-7xl mx-auto relative px-3 md:px-0">
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
              <h3 className="text-lg font-semibold">Career Tools</h3>
              <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="space-y-2">
              <Button variant={active === 'resume' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setActive('resume'); setSidebarOpen(false); }}>
                <FileText className="w-4 h-4 mr-2" />
                Resume Builder
              </Button>
              <Button variant={active === 'linkedin' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setActive('linkedin'); setSidebarOpen(false); }}>
                <Linkedin className="w-4 h-4 mr-2" />
                LinkedIn
              </Button>
              <Button variant={active === 'interview' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setActive('interview'); setSidebarOpen(false); }}>
                <Mic className="w-4 h-4 mr-2" />
                Interview Prep
              </Button>
              <Button variant={active === 'planner' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setActive('planner'); setSidebarOpen(false); }}>
                <FileText className="w-4 h-4 mr-2" />
                Career Recs
              </Button>
              <Button variant={active === 'saves' ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => { setActive('saves'); setSidebarOpen(false); }}>
                <BookOpen className="w-4 h-4 mr-2" />
                My Saves
              </Button>
            </div>
          </div>
        </>
      )}

      <Tabs value={active} onValueChange={setActive} className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-6" data-tour="career-tabs">
            <TabsTrigger value="resume" className="gap-2" data-tour="career-resume">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Resume Builder</span>
            </TabsTrigger>
            <TabsTrigger value="linkedin" className="gap-2" data-tour="career-linkedin">
              <Linkedin className="w-4 h-4" />
              <span className="hidden sm:inline">LinkedIn</span>
            </TabsTrigger>
            <TabsTrigger value="interview" className="gap-2" data-tour="career-interview">
              <Mic className="w-4 h-4" />
              <span className="hidden sm:inline">Interview</span>
            </TabsTrigger>
            <TabsTrigger value="planner" className="gap-2" data-tour="career-planner">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Career Recs</span>
            </TabsTrigger>
            <TabsTrigger value="saves" className="gap-2" data-tour="career-saves-tab">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">My Saves</span>
            </TabsTrigger>
          </TabsList>

        {/* Resume Builder Tab */}
        <TabsContent value="resume" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Resume Builder, Professional Templates</CardTitle>
                  <CardDescription>
                    Choose a template and edit your resume in real-time. Click on any section to edit it.
                  </CardDescription>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 sm:hidden">📱 For the best experience, we recommend using a laptop or desktop.</p>
                </div>
                {resumeMode === 'build' && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button 
                    onClick={undo}
                    disabled={history.length === 0}
                    className="w-full sm:w-auto bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                  >
                    <Undo className="w-4 h-4 mr-2" />
                    Undo
                  </Button>
                  <Button 
                    onClick={redo}
                    disabled={future.length === 0}
                    className="w-full sm:w-auto bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                  >
                    <Redo className="w-4 h-4 mr-2" />
                    Redo
                  </Button>
                  <Button 
                    onClick={exportResume} 
                    className="w-full sm:w-auto bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button 
                    onClick={optimizeResume}
                    disabled={loading || !canUseCareer || sections.length === 0}
                    className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600 border-0"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Optimize (AI)
                  </Button>
                  <div className="relative">
                    <UsageAnimation show={showResumeAnim} />
                    <Button 
                      onClick={() => { triggerResumeAnim(); rateResume(); }}
                      className="w-full sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-700"
                    >
                      Rate My Resume (AI)
                    </Button>
                  </div>
                  <Button 
                    onClick={() => aiReview && setAiReviewOpen(true)}
                    disabled={!aiReview}
                    className="w-full sm:w-auto bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                  >
                    View Last Review
                  </Button>
                  <Button 
                    onClick={() => { if (overPageLimit) { toast({ title: 'Page limit reached', description: 'Reduce content or spacing to save within one page.', variant: 'destructive' }); return; } setSaveOpen(true); setSaveLabel(`${resumeData.fullName || 'My'} Resume`); }} 
                    disabled={!canUseCareer || overPageLimit}
                    className="w-full sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-700"
                  >
                    <SaveIcon className="w-4 h-4 mr-2" />
                    Save Resume
                  </Button>
                </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* Template Selection */}
              <div className="mb-6">
                <Label className="text-sm font-medium mb-3 block">Choose Template</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {Object.entries(templates).map(([key, template]) => (
                    <div
                      key={key}
                      className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                        selectedTemplate === key && resumeMode === 'build'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400' 
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                      onClick={() => { setResumeMode('build'); applyTemplate(key as TemplateType); }}
                    >
                      <div className="font-medium text-gray-900 dark:text-white break-words">{template.name}</div>
                      <div className="text-xs sm:text-sm leading-snug break-words text-gray-500 dark:text-gray-400 mt-1">{template.description}</div>
                    </div>
                  ))}
                  {/* Upload & Review Option */}
                  <div
                    className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                      resumeMode === 'upload'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400' 
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    onClick={() => setResumeMode('upload')}
                  >
                    <div className="font-medium text-gray-900 dark:text-white break-words flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Upload & Review
                    </div>
                    <div className="text-xs sm:text-sm leading-snug break-words text-gray-500 dark:text-gray-400 mt-1">Upload your resume for AI grading and feedback</div>
                  </div>
                </div>
              </div>

              {/* Upload & Review Content */}
              {resumeMode === 'upload' && (
                <div className="space-y-6">
                  {!uploadedFile ? (
                    <div 
                      className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-12 text-center cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                      onClick={() => document.getElementById('resume-upload-input')?.click()}
                    >
                      <input
                        id="resume-upload-input"
                        type="file"
                        accept=".pdf,.docx,.doc,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                        onChange={handleResumeUpload}
                        className="hidden"
                      />
                      <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                      <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Drop your resume here or click to upload
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Supports PDF, DOCX, DOC, PPTX, XLSX, CSV, and TXT files
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* File info and actions */}
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <FileText className="w-4 h-4" />
                          <span className="font-medium">{uploadedFile.name}</span>
                          <Badge variant="outline">
                            {(uploadedFile.size / 1024).toFixed(1)} KB
                          </Badge>
                        </div>
                        <div className="flex gap-2 ml-auto">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById('resume-upload-input')?.click()}
                            disabled={loading}
                          >
                            <Upload className="w-4 h-4 mr-1" />
                            Change
                          </Button>
                          <input
                            id="resume-upload-input"
                            type="file"
                            accept=".pdf,.docx,.doc,.pptx,.xlsx,.xls,.csv,.txt,image/*,.heic,.heif"
                            onChange={handleResumeUpload}
                            className="hidden"
                          />
                          <Button
                            onClick={gradeUploadedResume}
                            size="sm"
                            disabled={loading}
                            className="dark:bg-blue-600 dark:hover:bg-blue-700"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Grade My Resume
                          </Button>
                          <Button
                            onClick={fillTemplateFromUpload}
                            size="sm"
                            disabled={loading}
                            className="bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:from-purple-600 hover:to-blue-600 border-0"
                          >
                            <FileUp className="w-4 h-4 mr-1" />
                            Fill Template
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={clearUploadedResume}
                            disabled={loading}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Resume Display */}
                        <div className="space-y-4">
                          {pdfPages.length > 0 ? (
                            <div className="space-y-4 max-h-[700px] overflow-y-auto border rounded-lg p-2 bg-gray-50 dark:bg-gray-900">
                              {pdfPages.map((pageUrl, index) => (
                                <div key={index} className="relative">
                                  <img 
                                    src={pageUrl} 
                                    alt={`Page ${index + 1}`}
                                    className="w-full border rounded shadow-sm"
                                  />
                                  <Badge className="absolute top-2 right-2 bg-black/50">
                                    Page {index + 1}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900 max-h-[600px] overflow-y-auto">
                              <pre className="whitespace-pre-wrap text-sm font-mono">
                                {uploadedText || 'Processing...'}
                              </pre>
                            </div>
                          )}
                        </div>

                        {/* AI Feedback Panel */}
                        <div className="space-y-4">
                          {uploadedReview ? (
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-lg">AI Resume Review</h3>
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                    {uploadedReview.score}
                                  </span>
                                  <span className="text-gray-500">/100</span>
                                </div>
                              </div>
                              
                              {uploadedReview.summary && (
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                                  <p className="text-sm">{uploadedReview.summary}</p>
                                </div>
                              )}

                              {uploadedReview.strengths && uploadedReview.strengths.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-green-600 dark:text-green-400 mb-2 flex items-center gap-2">
                                    <CheckSquare className="w-4 h-4" />
                                    Strengths
                                  </h4>
                                  <ul className="space-y-1">
                                    {uploadedReview.strengths.map((s, i) => (
                                      <li key={i} className="text-sm flex items-start gap-2">
                                        <span className="text-green-500 mt-1">•</span>
                                        <span>{s}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {uploadedReview.improvements && uploadedReview.improvements.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-orange-600 dark:text-orange-400 mb-2 flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4" />
                                    Areas for Improvement
                                  </h4>
                                  <ul className="space-y-1">
                                    {uploadedReview.improvements.map((imp, i) => (
                                      <li key={i} className="text-sm flex items-start gap-2">
                                        <span className="text-orange-500 mt-1">•</span>
                                        <span>{imp}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {uploadedReview.examples && uploadedReview.examples.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-purple-600 dark:text-purple-400 mb-2">
                                    Suggested Improvements
                                  </h4>
                                  <div className="space-y-3">
                                    {uploadedReview.examples.map((ex, i) => (
                                      <div key={i} className="p-3 border rounded-lg bg-white dark:bg-gray-800 text-sm space-y-2">
                                        <div>
                                          <span className="text-xs font-medium text-red-500">Before:</span>
                                          <p className="text-gray-600 dark:text-gray-400 line-through">{ex.original}</p>
                                        </div>
                                        <div>
                                          <span className="text-xs font-medium text-green-500">After:</span>
                                          <p className="text-gray-900 dark:text-white">{ex.improved}</p>
                                        </div>
                                        {ex.rationale && (
                                          <p className="text-xs text-gray-500 italic">{ex.rationale}</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-8 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg min-h-[400px]">
                              <Eye className="w-12 h-12 text-gray-400 mb-4" />
                              <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Ready for AI Review
                              </h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                Click "Grade My Resume" to get detailed AI feedback on your resume.
                              </p>
                              <Button onClick={gradeUploadedResume} className="gap-2">
                                <Eye className="w-4 h-4" />
                                Grade My Resume
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Build Resume Content */}
              {resumeMode === 'build' && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Left Sidebar - Editing Tools */}
                <div className="lg:col-span-1 space-y-6">
                  {/* Personal Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Personal Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <Label className="text-xs">Full Name</Label>
                        <Input
                          value={resumeData.fullName}
                          onChange={(e) => updateResumeData('fullName', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Email</Label>
                        <Input
                          value={resumeData.email}
                          onChange={(e) => updateResumeData('email', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Phone</Label>
                        <Input
                          value={resumeData.phone}
                          onChange={(e) => updateResumeData('phone', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Location</Label>
                        <Input
                          value={resumeData.location}
                          onChange={(e) => updateResumeData('location', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">LinkedIn URL</Label>
                        <Input
                          value={resumeData.linkedin}
                          onChange={(e) => updateResumeData('linkedin', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                          placeholder="linkedin.com/in/yourname"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Portfolio URL</Label>
                        <Input
                          value={resumeData.portfolio}
                          onChange={(e) => updateResumeData('portfolio', e.target.value)}
                          className="dark:bg-gray-800 dark:border-gray-700"
                          placeholder="yourportfolio.com"
                        />
                      </div>
                      {loading && (
                <div className="absolute inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-sm flex items-center justify-center z-10">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 max-w-md mx-4 text-center border dark:border-gray-700">
                    <div className="flex items-center justify-center mb-2 text-blue-600 dark:text-blue-400">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      <span>Working on it…</span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      {funFact || 'Tip: Use concrete metrics in your answers for stronger impact.'}
                    </div>
                  </div>
                </div>
              )}
              {loading && (
                <div className="absolute inset-0 bg-black/30 dark:bg-black/40 backdrop-blur-sm flex items-center justify-center z-10">
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 max-w-md mx-4 text-center border dark:border-gray-700">
                    <div className="flex items-center justify-center mb-2 text-blue-600 dark:text-blue-400">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      <span>Working on it…</span>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      {funFact || 'Tip: Use concrete metrics in your answers for stronger impact.'}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
                  </Card>

                  {/* Add Sections */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Add Sections</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {['summary', 'experience', 'education', 'skills', 'projects', 'certifications'].map(type => (
                        <Button
                          key={type}
                          size="sm"
                          className="w-full justify-start bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                          onClick={() => addSection(type)}
                          disabled={overPageLimit}
                        >
                          + Add {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                </div>

                {/* Main Content - Resume Preview */}
                <div className="lg:col-span-3 space-y-6">
                  {/* Global Formatting Controls (only above canvas) */}
                  <div className="mb-0 overflow-x-auto">
                    <div className="min-w-max flex items-end gap-2 flex-wrap md:flex-nowrap">
                      <div className="space-y-1 w-32">
                        <Label className="text-xs whitespace-nowrap">Title Font Size</Label>
                        <select
                          className="h-8 rounded-md px-2 text-xs bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          value={titleFontSize}
                          onChange={(e) => setTitleFontSize(Number(e.target.value))}
                        >
                          <option value={16}>16px</option>
                          <option value={18}>18px</option>
                          <option value={20}>20px</option>
                          <option value={22}>22px</option>
                        </select>
                      </div>
                      <div className="space-y-1 w-40">
                        <Label className="text-xs whitespace-nowrap">Text/Description Font Size</Label>
                        <select
                          className="h-8 rounded-md px-2 text-xs bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          value={bodyFontSize}
                          onChange={(e) => setBodyFontSize(Number(e.target.value))}
                        >
                          <option value={10}>10px</option>
                          <option value={11}>11px</option>
                          <option value={12}>12px</option>
                          <option value={13}>13px</option>
                          <option value={14}>14px</option>
                        </select>
                      </div>
                      <div className="space-y-1 w-32">
                        <Label className="text-xs whitespace-nowrap">Line Height</Label>
                        <select
                          className="h-8 rounded-md px-2 text-xs bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          value={lineHeight}
                          onChange={(e) => setLineHeight(Number(e.target.value))}
                        >
                          <option value={1.0}>Compact</option>
                          <option value={1.2}>Tight</option>
                          <option value={1.4}>Normal</option>
                          <option value={1.6}>Spacious</option>
                        </select>
                      </div>
                      <div className="space-y-1 w-32">
                        <Label className="text-xs whitespace-nowrap">Section Gap</Label>
                        <select
                          className="h-8 rounded-md px-2 text-xs bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          value={sectionGap}
                          onChange={(e) => setSectionGap(Number(e.target.value))}
                        >
                          <option value={0}>0px</option>
                          <option value={4}>4px</option>
                          <option value={8}>8px</option>
                          <option value={12}>12px</option>
                          <option value={16}>16px</option>
                        </select>
                      </div>
                      <div className="space-y-1 w-40">
                        <Label className="text-xs whitespace-nowrap">Title → Description Gap</Label>
                        <select
                          className="h-8 rounded-md px-2 text-xs bg-blue-100 text-blue-900 border border-blue-300 hover:bg-blue-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                          value={titleDescGap}
                          onChange={(e) => setTitleDescGap(Number(e.target.value))}
                        >
                          <option value={0}>0px</option>
                          <option value={2}>2px</option>
                          <option value={4}>4px</option>
                          <option value={6}>6px</option>
                          <option value={8}>8px</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  {/* Resume Preview */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Live Preview, click sections to edit
                        {overPageLimit && (
                          <span className="ml-2 text-sm text-yellow-600 dark:text-yellow-400">
                            (Page Limit Reached)
                          </span>
                        )}
                      </div>
                    </div>
                    {renderResumePreview()}
                  </div>

                  {/* Sections List for Reordering */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Reorder Sections (Drag and Drop)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {sections.map((section, index) => (
                          <div key={section.id + '-wrapper'}>
                            {dragOverIndex === index && (
                              <div className="h-2 -my-1">
                                <div className="h-0.5 bg-blue-500 rounded"></div>
                              </div>
                            )}
                            <div
                              key={section.id}
                              draggable
                              onDragStart={() => handleDragStart(index)}
                              onDragEnter={() => handleDragEnter(index)}
                              onDragLeave={handleDragLeave}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => e.preventDefault()}
                              className={`flex items-center gap-3 p-3 border rounded-lg cursor-move transition-all overflow-hidden ${
                                dragOverIndex === index 
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 border-2' 
                                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                              }`}
                            >
                              <GripVertical className="w-4 h-4 text-gray-400" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-white">
                                  {section.type.charAt(0).toUpperCase() + section.type.slice(1)}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                  {section.content.substring(0, 50)}...
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => deleteSection(section.id)}
                                className="shrink-0 bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        {/* Trailing drop zone for end of list */}
                        <div
                          onDragEnter={() => handleDragEnter(sections.length)}
                          onDragOver={(e) => e.preventDefault()}
                          className="mt-1"
                        >
                          {dragOverIndex === sections.length && (
                            <div className="h-2">
                              <div className="h-0.5 bg-blue-500 rounded"></div>
                            </div>
                          )}
                        </div>
                        {sections.length === 0 && (
                          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                            <p>No sections added yet</p>
                            <p className="text-sm">Add sections using the buttons on the left</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  
                </div>
              </div>
              )}
            </CardContent>
          </Card>

          {/* Section Editor Popup */}
          {editingSection && (
            <div 
              className="fixed bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-xl z-50 p-4 max-w-2xl"
              style={{ top: editPosition.top, left: editPosition.left }}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-white">Edit {editingSection.type.charAt(0).toUpperCase() + editingSection.type.slice(1)}</h3>
                <Button size="sm" onClick={closeSectionEditor} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              
              
              <Textarea
                value={editingSection.content}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditingSection(prev => {
                    if (!prev) return prev;
                    const was = prev.content || '';
                    if (!overPageLimit || val.length <= was.length) {
                      return { ...prev, content: val };
                    }
                    toast({ title: "Page limit reached", description: "Delete or shorten content to continue.", variant: "destructive" });
                    return prev;
                  });
                }}
                className="min-h-[300px] font-mono text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder={`Enter your ${editingSection.type} content...`}
              />
              
              <div className="flex justify-end gap-2 mt-4">
                <Button onClick={closeSectionEditor} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
                  Cancel
                </Button>
                <Button onClick={closeSectionEditor} className="dark:bg-blue-600 dark:hover:bg-blue-700">
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* AI Review Dialog */}
        <Dialog open={aiReviewOpen} onOpenChange={setAiReviewOpen}>
          <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
            <DialogHeader>
              <DialogTitle className="dark:text-white">AI Resume Review</DialogTitle>
            </DialogHeader>
            {aiReview ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">{aiReview.score}/100</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{new Date(aiReview.timestamp).toLocaleString()}</div>
                </div>
                {Array.isArray(aiReview.tips) && aiReview.tips.length > 0 ? (
                  <div>
                    <div className="font-medium mb-2 text-gray-900 dark:text-white">Top Improvements</div>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                      {aiReview.tips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ) : (Array.isArray(aiReview.improvements) && aiReview.improvements.length > 0) ? (
                  <div>
                    <div className="font-medium mb-2 text-gray-900 dark:text-white">Improvements</div>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                      {aiReview.improvements.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ) : aiReview.summary ? (
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{aiReview.summary}</div>
                ) : null}
                
                <DialogFooter>
                  <Button onClick={() => setAiReviewOpen(false)} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">Close</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-400">No review yet. Click "Rate My Resume (AI)" to generate one.</div>
            )}
          </DialogContent>
        </Dialog>

        {/* LinkedIn Generator Tab */}
        <TabsContent value="linkedin">
          <Card>
            <CardHeader className="flex flex-col items-center text-center">
              <div className="flex justify-center mb-2">
                <Linkedin className="w-10 h-10 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-center">AI LinkedIn Post Writer</CardTitle>
              <CardDescription className="text-center">Create professional LinkedIn posts to grow your network and visibility</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 relative">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Topic / Achievement</Label>
                  <Input
                    placeholder="e.g., Built a full-stack application using Next.js"
                    value={liTopic}
                    onChange={(e) => setLiTopic(e.target.value)}
                    className="dark:bg-gray-800 dark:border-gray-700"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tone</Label>
                  <select
                    className="w-full h-10 rounded-md border bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    value={liTone}
                    onChange={(e) => setLiTone(e.target.value)}
                  >
                    <option>Professional</option>
                    <option>Casual</option>
                    <option>Inspirational</option>
                    <option>Technical</option>
                  </select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Post Type</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  value={liPostType}
                  onChange={(e) => setLiPostType(e.target.value)}
                >
                  <option>Project Update</option>
                  <option>Achievement/Reflection</option>
                  <option>Learning Experience</option>
                  <option>Career Milestone</option>
                </select>
              </div>

              <div className="relative">
                <UsageAnimation show={showLinkedInAnim} />
                <Button
                  onClick={() => { triggerLinkedInAnim(); generateLinkedIn(); }}
                  disabled={loading || !liTopic.trim() || !canUseCareer}
                  className="w-full dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Generate
                </Button>
              </div>

              {liVariations.length > 0 && (
                <div className="space-y-4 mt-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Generated Posts</h3>
                  {liVariations.map((post, index) => (
                    <Card key={index} className="dark:bg-gray-800 dark:border-gray-700">
                      <CardContent className="p-4">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-3">
                          <span className="text-sm text-gray-500 dark:text-gray-400">Variation {index + 1}</span>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              size="sm"
                              onClick={() => navigator.clipboard.writeText(post)}
                              className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0 text-xs"
                            >
                              <Copy className="w-3 h-3 mr-1" />
                              Copy
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openEditLinkedinGenerated(index)}
                              className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0 text-xs"
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                            <Button 
                              size="sm"
                              onClick={() => saveLinkedIn(index)}
                              disabled={!canUseCareer}
                              className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0 text-xs"
                            >
                              <SaveIcon className="w-3 h-3 mr-1" />
                              Save
                            </Button>
                          </div>
                        </div>
                        <div className="text-sm whitespace-pre-line text-gray-700 dark:text-gray-300">{post}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Interview Prep Tab */}
        <TabsContent value="interview">
          <Card>
            <CardHeader className="flex flex-col items-center text-center">
              <div className="flex justify-center mb-2">
                <Mic className="w-10 h-10 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-center">Interview Preparation Coach</CardTitle>
              <CardDescription className="text-center">Practice with AI-generated interview questions and get detailed feedback</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 relative">
              {!ivInSession && !reviewMode ? (
                <>
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Interview Type</Label>
                      <select
                        className="w-full h-10 rounded-md border bg-background px-3 text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                        value={ivType}
                        onChange={(e) => setIvType(e.target.value)}
                      >
                        <option>Technical</option>
                        <option>Behavioral</option>
                        <option>System Design</option>
                        <option>Leadership</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Target Role</Label>
                      <Input
                        placeholder="e.g., Senior Software Engineer"
                        value={ivRole}
                        onChange={(e) => setIvRole(e.target.value)}
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company (optional)</Label>
                      <Input
                        placeholder="e.g., Google, Amazon"
                        value={ivCompany}
                        onChange={(e) => setIvCompany(e.target.value)}
                        className="dark:bg-gray-800 dark:border-gray-700"
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <UsageAnimation show={showInterviewAnim} />
                      <Button
                        type="button"
                        onClick={() => { triggerInterviewAnim(); try { localStorage.setItem('interview_draft', JSON.stringify({ ivType, ivRole, ivCompany })); } catch {}; generateInterview(); }}
                        disabled={loading || !ivRole.trim() || !canUseCareer}
                        className="w-full dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4 mr-2" />
                        )}
                        Generate
                      </Button>
                    </div>
                  </div>
                </>
              ) : reviewMode ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Interview Review</h3>
                    <div className="flex gap-2">
                      <Button
                        onClick={redoInterview}
                        disabled={loading || !canUseCareer}
                        className="dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        Redo Interview
                      </Button>
                      <Button
                        onClick={() => setReviewMode(false)}
                        className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                      >
                        Close Review
                      </Button>
                    </div>
                  </div>

                  {ivSummary && (
                    <Card className="dark:bg-gray-800 dark:border-gray-700">
                      <CardContent className="p-6">
                        <div className="text-center mb-6">
                          <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Overall Performance</h4>
                          <div className="grid grid-cols-3 gap-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold text-green-600">{ivSummary.clarity}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Clarity</div>
                            </div>
                            <div className="text-center">
                              <div className="text-3xl font-bold text-blue-600">{ivSummary.confidence}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Confidence</div>
                            </div>
                            <div className="text-center">
                              <div className="text-3xl font-bold text-purple-600">{ivSummary.relevance}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">Relevance</div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-4">
                    {ivQuestions.map((question, index) => (
                      <Card key={index} className="dark:bg-gray-800 dark:border-gray-700">
                        <CardContent className="p-6">
                          <div className="mb-4">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-sm font-medium">
                                {index + 1}
                              </div>
                              <h4 className="font-semibold text-gray-900 dark:text-white">Question</h4>
                            </div>
                            <p className="text-gray-700 dark:text-gray-300">{question}</p>
                          </div>

                          <div className="mb-4">
                            <h5 className="font-medium text-gray-900 dark:text-white mb-2">Your Answer</h5>
                            <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                              {ivAnswers[index] || "No answer provided"}
                            </div>
                          </div>

                          {ivFeedbacks[index] && (
                            <div>
                              <h5 className="font-medium text-gray-900 dark:text-white mb-2">AI Feedback</h5>
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded text-sm">
                                <div className="grid grid-cols-3 gap-4 mb-3 text-xs">
                                  <div className="text-center">
                                    <div className="font-semibold text-green-600">{ivFeedbacks[index].clarity}</div>
                                    <div className="text-gray-600 dark:text-gray-400">Clarity</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="font-semibold text-blue-600">{ivFeedbacks[index].confidence}</div>
                                    <div className="text-gray-600 dark:text-gray-400">Confidence</div>
                                  </div>
                                  <div className="text-center">
                                    <div className="font-semibold text-purple-600">{ivFeedbacks[index].relevance}</div>
                                    <div className="text-gray-600 dark:text-gray-400">Relevance</div>
                                  </div>
                                </div>
                                <div className="text-gray-700 dark:text-gray-300 mb-3">
                                  {ivFeedbacks[index].feedback}
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900 dark:text-white mb-1">Improved Version:</div>
                                  <div className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                    {ivFeedbacks[index].improved}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                    {(() => { const answered = (Array.isArray(ivAnswers) ? ivAnswers.filter(x => x && String(x).trim().length > 0).length : 0); const total = ivQuestions.length; const allDone = total > 0 && answered === total; return allDone ? (
                      <h3 className="font-semibold text-gray-900 dark:text-white">Interview Completed</h3>
                    ) : (
                      <h3 className="font-semibold text-gray-900 dark:text-white">Answered {answered} of {total}</h3>
                    ); })()}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={saveInterviewDraft}
                        disabled={!canUseCareer || loading}
                        className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0 text-sm"
                      >
                        Save for Later
                      </Button>
                      <Button
                        onClick={() => setIvInSession(false)}
                        className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0 text-sm"
                      >
                        End Session
                      </Button>
                    </div>
                  </div>
                  
                  {(() => { const answered = (Array.isArray(ivAnswers) ? ivAnswers.filter(x => x && String(x).trim().length > 0).length : 0); const total = ivQuestions.length; const allDone = total > 0 && answered === total; return !allDone; })() ? (
                    <>
                      {/* Back navigation removed per requirements */}
                      
                      <Card className="dark:bg-gray-800 dark:border-gray-700">
                        <CardContent className="p-4">
                          <div className="font-medium text-lg mb-3 text-gray-900 dark:text-white">{ivQuestions[ivIndex]}</div>
                          {ivAnswers[ivIndex] && ivAnswers[ivIndex].trim().length > 0 ? (
                            <div className="space-y-3">
                              <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                {ivAnswers[ivIndex]}
                              </div>
                              {ivFeedbacks[ivIndex] && (
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded text-sm">
                                  <div className="grid grid-cols-3 gap-4 mb-3 text-xs">
                                    <div className="text-center">
                                      <div className="font-semibold text-green-600">{ivFeedbacks[ivIndex].clarity}</div>
                                      <div className="text-gray-600 dark:text-gray-400">Clarity</div>
                                    </div>
                                    <div className="text-center">
                                      <div className="font-semibold text-blue-600">{ivFeedbacks[ivIndex].confidence}</div>
                                      <div className="text-gray-600 dark:text-gray-400">Confidence</div>
                                    </div>
                                    <div className="text-center">
                                      <div className="font-semibold text-purple-600">{ivFeedbacks[ivIndex].relevance}</div>
                                      <div className="text-gray-600 dark:text-gray-400">Relevance</div>
                                    </div>
                                  </div>
                                  <div className="text-gray-700 dark:text-gray-300 mb-3">
                                    {ivFeedbacks[ivIndex].feedback}
                                  </div>
                                  {ivFeedbacks[ivIndex].improved && (
                                    <div>
                                      <div className="font-medium text-gray-900 dark:text-white mb-1">Improved Version:</div>
                                      <div className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                        {ivFeedbacks[ivIndex].improved}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <Textarea
                              placeholder="Type your answer here..."
                              value={ivAnswer}
                              onChange={(e) => setIvAnswer(e.target.value)}
                              className="min-h-[120px] dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            />
                          )}
                        </CardContent>
                      </Card>
                      
                      <div className="flex gap-2 justify-end">
                        {!(ivAnswers[ivIndex] && ivAnswers[ivIndex].trim().length > 0) ? (
                          <>
                            <Button
                              onClick={() => {
                                // Mark unanswered and jump to the next unanswered question (wrap-around)
                                setIvAnswers(prev => { const copy = Array.isArray(prev) ? [...prev] : []; copy[ivIndex] = ''; return copy; });
                                const total = ivQuestions.length;
                                let next = -1;
                                for (let i = 1; i <= total; i++) {
                                  const j = (ivIndex + i) % total;
                                  const val = ivAnswers[j];
                                  if (!val || !String(val).trim()) { next = j; break; }
                                }
                                setIvIndex(next === -1 ? ivIndex : next);
                                setIvAnswer('');
                              }}
                              className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0"
                            >
                              Skip
                            </Button>
                            <Button
                              onClick={submitInterviewAnswer}
                              disabled={loading || !ivAnswer.trim()}
                              className="dark:bg-blue-600 dark:hover:bg-blue-700"
                            >
                              {loading ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : null}
                              Submit Answer
                            </Button>
                          </>
                        ) : (
                          <>
                            {/* When already answered, no editing; provide navigation via top buttons */}
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <Card className="dark:bg-gray-800 dark:border-gray-700">
                        <CardContent className="p-4">
                          <div className="text-center py-4">
                            <div className="font-medium text-lg mb-2 text-gray-900 dark:text-white">Interview Completed!</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              You've answered all questions.
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      
                      <div className="flex justify-end gap-2">
                        <Button onClick={finishInterview} disabled={loading} className="dark:bg-blue-600 dark:hover:bg-blue-700">
                          {loading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          Finish & See Results
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Career Recommendations Tab */}
        <TabsContent value="planner">
          <Card>
            <CardHeader className="flex flex-col items-center text-center">
              <div className="flex justify-center mb-2">
                <FileText className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <CardTitle className="text-center">Career Recommendations</CardTitle>
              <CardDescription className="text-center">Get personalized career path suggestions based on your experience and skills</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label>Paste Your Experience or Upload Resume</Label>
                  <div className="flex flex-col gap-3 mt-2">
                    <div className="flex-1">
                      <Textarea
                        placeholder="Paste your resume text, experience, skills, or career goals here..."
                        value={cpText}
                        onChange={(e) => setCpText(e.target.value)}
                        className="min-h-[200px] dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Input
                        type="file"
                        accept=".txt,.pdf,.docx,.doc,.pptx,.xlsx,.xls,.csv,image/*,.heic,.heif"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="resume-upload"
                        disabled={loading}
                      />
                      <Label htmlFor="resume-upload" className="cursor-pointer">
                        <Button asChild className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
                          <span>
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Resume
                          </span>
                        </Button>
                      </Label>
                      <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                        Supports: .txt, .pdf, .docx, .pptx, .xlsx, .csv
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="relative">
                <UsageAnimation show={showCareerAnim} />
                <Button
                  onClick={() => { triggerCareerAnim(); getCareerRecommendations(); }}
                  disabled={loading || !cpText.trim() || !canUseCareer}
                  className="w-full dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Generate
                </Button>
              </div>

              {cpRecs.length > 0 && (
                <div className="space-y-4 mt-6">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Recommended Career Paths ({cpRecs.length} roles)</h3>
                    <div className="flex gap-2">
                      <Button
                        onClick={saveCareerPlan}
                        disabled={!canUseCareer}
                        className="dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        <SaveIcon className="w-4 h-4 mr-2" />
                        Save
                      </Button>
                    </div>
                  </div>
                  
                  {cpRecs.map((rec, index) => (
                    <Card key={index} className="dark:bg-gray-800 dark:border-gray-700">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full w-8 h-8 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="font-bold text-lg text-gray-900 dark:text-white">{rec.title}</div>
                              <Button size="sm" onClick={() => saveSingleCareerRec(index)} disabled={!canUseCareer} className="dark:bg-blue-600 dark:hover:bg-blue-700">
                                <SaveIcon className="w-4 h-4 mr-2" /> Save
                              </Button>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{rec.reasoning}</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Saves Tab */}
        <TabsContent value="saves">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>My Saved Items</CardTitle>
                <CardDescription>
                  Access your saved resumes, LinkedIn posts, interview sessions, and career plans
                  {selectionMode && selectedItems.size > 0 && ` • ${selectedItems.size} selected`}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {loadingSaved ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : savedItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-4" />
                  <p>No saved items yet</p>
                  <p className="text-sm">Generate and save content in other tabs to see it here</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Filters */}
                  <div className="w-full overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted border shadow-sm min-w-max">
                      {(['all', 'resume', 'linkedin', 'interview', 'career_recs'] as const).map(f => (
                        <button
                          key={f}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${filters.includes(f as any) || (f === 'all' && filters.length === 0) ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent/60'}`}
                          onClick={() => {
                            if (f === 'all') {
                              setFilters([]);
                            } else {
                              setFilters(prev => {
                                if (prev.includes(f as any)) {
                                  // Remove if already selected
                                  return prev.filter(x => x !== f);
                                } else {
                                  // Add if not selected, but limit to 2 max
                                  if (prev.length >= 2) {
                                    // Replace the first filter with the new one
                                    return [prev[1], f as any];
                                  } else {
                                    return [...prev, f as any];
                                  }
                                }
                              });
                            }
                          }}
                        >
                          {f === 'all' ? 'All' : f === 'resume' ? 'Resume' : f === 'linkedin' ? 'LinkedIn' : f === 'interview' ? 'Interview' : 'Career Recs'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Select Multiple Button */}
                  <div className="flex flex-wrap gap-2">
                    {!selectionMode ? (
                      <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
                        <CheckSquare className="w-4 h-4 mr-2" />
                        Select Multiple
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => {
                          const filteredItems = savedItems.filter(item => filters.length === 0 || filters.includes(item.type));
                          if (selectedItems.size === filteredItems.length) {
                            setSelectedItems(new Set());
                          } else {
                            setSelectedItems(new Set(filteredItems.map(i => i.id)));
                          }
                        }}>
                          {selectedItems.size === savedItems.filter(item => filters.length === 0 || filters.includes(item.type)).length ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          setSelectionMode(false);
                          setSelectedItems(new Set());
                        }}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Saved Items (match Flashcards library) */}
                  <div className="space-y-3">
                    {savedItems
                      .filter(item => filters.length === 0 || filters.includes(item.type))
                      .map(item => (
                        <div
                          key={item.id}
                          className="group p-3 border rounded-lg bg-background transition-all hover:bg-card hover:border-primary/40 hover:shadow-sm ring-1 ring-transparent hover:ring-2 hover:ring-primary/40 cursor-pointer"
                          onClick={() => {
                            if (selectionMode) {
                              toggleItemSelection(item.id);
                            } else {
                              openSavedPreview(item);
                            }
                          }}
                          role="button"
                        >
                          <CardContent className="p-4">
                            <div className="flex gap-3">
                              {selectionMode && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 flex-shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleItemSelection(item.id);
                                  }}
                                >
                                  {selectedItems.has(item.id) ? (
                                    <CheckSquare className="w-5 h-5 text-primary" />
                                  ) : (
                                    <Square className="w-5 h-5" />
                                  )}
                                </Button>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-col gap-2">
                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-semibold break-words" title={item.title}>{item.title.length > 30 ? item.title.slice(0, 30) + '...' : item.title}</h4>
                                    <Badge variant="outline" className="mt-1 inline-block">
                                      {(() => {
                                        const labelMap: Record<string,string> = {
                                          resume: 'RESUME',
                                          linkedin: 'LINKEDIN',
                                          interview: 'INTERVIEW',
                                          planner: 'CAREER RECS',
                                          career_recs: 'CAREER RECS',
                                        };
                                        return labelMap[item.type] || item.type.toUpperCase();
                                      })()}
                                    </Badge>
                                    {item.subtitle && (
                                      <div className="text-xs text-muted-foreground mt-1">{item.subtitle}</div>
                                    )}
                                  </div>
                                  {!selectionMode && (
                                    <div className="flex flex-wrap items-center gap-1">
                                      <Button variant="outline" size="sm" className="flex whitespace-nowrap text-xs" onClick={(e) => { e.stopPropagation(); item.type === 'resume' ? previewSavedResume(item) : openSavedPreview(item); }}>
                                        <Eye className="w-3 h-3 mr-1" /> View
                                      </Button>
                                      {item.type === 'interview' && (
                                        <Button variant="outline" size="sm" className="flex whitespace-nowrap text-xs" onClick={(e) => { e.stopPropagation(); loadInterviewDraft(item.id); }}>
                                          <FileText className="w-3 h-3 mr-1" /> Edit
                                        </Button>
                                      )}
                                      {item.type === 'resume' && (
                                        <Button variant="outline" size="sm" className="flex whitespace-nowrap text-xs" onClick={(e) => { e.stopPropagation(); openSavedResumeToEdit(item); }}>
                                          <FileText className="w-3 h-3 mr-1" /> Edit
                                        </Button>
                                      )}
                                      {item.type === 'linkedin' && (
                                        <Button variant="outline" size="sm" className="flex whitespace-nowrap text-xs" onClick={(e) => { e.stopPropagation(); openEditLinkedinSaved(item); }}>
                                          <FileText className="w-3 h-3 mr-1" /> Edit
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setRenameId(item.id); setRenameType(item.type); setRenameText(item.title); setRenameOpen(true); }} aria-label="Rename">
                                        <Pencil className="w-3 h-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); setConfirmId(item.id); setConfirmType(item.type); setConfirmTitle(item.title); setConfirmOpen(true); }} aria-label="Delete">
                                        <Trash2 className="w-3 h-3 text-destructive" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </div>
                      ))}
                  </div>
                </div>
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

      {/* Save Resume Dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Save Resume</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="dark:text-white">Resume Name</Label>
              <Input
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                placeholder="Enter a name for your resume"
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setSaveOpen(false)} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
              Cancel
            </Button>
            <Button 
              onClick={() => saveResume(saveLabel)} 
              disabled={!saveLabel.trim()}
              className="dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              Save Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LinkedIn Edit Dialog */}
      <Dialog open={liEditOpen} onOpenChange={setLiEditOpen}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Edit LinkedIn Post</DialogTitle>
          </DialogHeader>
          <Textarea
            value={liEditText}
            onChange={(e) => setLiEditText(e.target.value)}
            className="min-h-[240px] dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <DialogFooter className="flex gap-2">
            {liEditSavedId ? (
              <Button onClick={updateSavedLinkedin} disabled={loading} className="dark:bg-blue-600 dark:hover:bg-blue-700">
                Update Saved
              </Button>
            ) : (
              <>
                <Button onClick={applyLinkedinEditLocally} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
                  Apply Locally
                </Button>
                <Button onClick={saveEditedLinkedinAsNew} disabled={loading || !canUseCareer} className="dark:bg-blue-600 dark:hover:bg-blue-700">
                  Save as New
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Saved Item Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl w-[90vw]">
          <DialogHeader>
            <DialogTitle>{previewTitle || 'Preview'}</DialogTitle>
          </DialogHeader>
          {previewHTML ? (
            <div className="h-[85vh]">
              <iframe title="Preview" srcDoc={previewHTML} className="w-full h-full" />
            </div>
          ) : (
            <div className="prose dark:prose-invert max-w-none text-sm prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeForMath(previewBody || 'Preview not available.')}
              </ReactMarkdown>
            </div>
          )}
          <DialogFooter>
            {previewType === 'linkedin' && !!previewBody && (
              <Button
                variant="outline"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(previewBody); toast({ title: 'Copied', description: 'Post text copied to clipboard.' }); } catch { toast({ title: 'Copy failed', variant: 'destructive' }); }
                }}
              >
                <Copy className="w-4 h-4 mr-2" /> Copy
              </Button>
            )}
            {previewType === 'resume' && !!previewHTML && (
              <Button
                onClick={async () => {
                  try {
                    await downloadPDF(previewHTML, { filename: `resume-${previewTitle.replace(/\s+/g, '_')}`, margin: 15 });
                    toast({ title: 'Downloaded!', description: 'Resume saved as PDF' });
                  } catch {
                    toast({ title: 'Download failed', description: 'Could not download PDF', variant: 'destructive' });
                  }
                }}
              >
                Download
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setPreviewOpen(false); setPreviewHTML(null); setPreviewBody(''); setPreviewType(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">
              {confirmId === "bulk" ? "Delete Multiple Items?" : `Delete "${confirmTitle}"?`}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            This action cannot be undone. {confirmId === "bulk" && `${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'} will be deleted.`}
          </p>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
              Cancel
            </Button>
            <Button 
              variant="destructive"
              disabled={loading}
              onClick={async () => {
                if (confirmId === "bulk") {
                  await bulkDeleteItems();
                } else {
                  await deleteSavedItem();
                  setConfirmOpen(false);
                  toast({ title: "Deleted", description: "Item has been deleted." });
                }
              }}
            >
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deleting...</> : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Rename Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="dark:text-white">New Name</Label>
              <Input
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                placeholder="Enter new name"
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRenameOpen(false)} className="bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 border-0">
              Cancel
            </Button>
            <Button onClick={async () => {
              await renameSavedItem();
              setRenameOpen(false);
              toast({ title: "Renamed", description: "Item has been renamed." });
            }} className="dark:bg-blue-600 dark:hover:bg-blue-700">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};
