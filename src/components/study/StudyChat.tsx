import { useState, useRef, useEffect, useMemo } from "react";
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
import {
  collection,
  addDoc,
  getDocs,
  doc,
  query,
  orderBy,
  updateDoc,
  setDoc,
  serverTimestamp,
  getDoc,
  writeBatch,
  limit,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, MessageSquare, Plus, Trash2, Pencil, Menu, X, FileText, Paperclip, Copy, CheckCheck, Users, GraduationCap, User, Search, Ghost, Smile, ChevronDown, CheckSquare, Square, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { recordDailyVisit } from "@/lib/achievements";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { awardAchievement, incrementCounterAndMaybeAward, awardActionXP, incrementCounter } from "@/lib/achievements";
import { CrossCreatePicker } from "@/components/CrossCreatePicker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { extractTextFromFile } from "@/lib/extractTextFromFile";
import { BUBBLE_COLOR_PRESETS, bubbleColorFor } from "@/lib/bubble-colors";

interface Message {
  role: "user" | "assistant";
  content: string;
  assistant_personality_id?: string;
  attachedFileNames?: string[]; // File names attached with the message
}

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  personality_id?: string;
  personalities?: string[];
}

interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

interface AIPersonality {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
  color: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const StudyChat = ({ userId }: { userId: string }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>("");
  const [creatingSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mobileSessionsRef = useRef<HTMLDivElement>(null);
  const desktopSessionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [autoScroll, setAutoScroll] = useState(false);
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  usePlanGate();
  const userData = useUserData();
  const [deepAwardedBySession, setDeepAwardedBySession] = useState<Record<string, boolean>>({});
  
  // Compute from context instead of local state
  const plan = userData.profile.plan || 'free';
  const monthlyQuota = useMemo(() => {
    const rawQuota = Number(userData.profile.monthly_quota || 0);
    return rawQuota > 0 ? rawQuota : (plan === 'free' ? 5 : plan === 'basic' ? 50 : plan === 'advanced' ? 200 : plan === 'pro' ? 500 : 5);
  }, [userData.profile.monthly_quota, plan]);
  useMemo(() => {
    const wl = userData.profile.word_limit;
    if (typeof wl === 'number') return wl;
    return plan === 'pro' ? 15000 : plan === 'advanced' ? 7000 : plan === 'basic' ? 5000 : 3000;
  }, [userData.profile.word_limit, plan]);
  const usesBlocked = useMemo(() => {
    const uses = Number(userData.counters.uses_this_month || 0);
    const extra = Number(userData.counters.extra_uses_balance || 0);
    return monthlyQuota > 0 ? (uses >= monthlyQuota && extra <= 0) : false;
  }, [userData.counters.uses_this_month, userData.counters.extra_uses_balance, monthlyQuota]);
  const [askOpen, setAskOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [askText, setAskText] = useState("");
  const [askUrl, setAskUrl] = useState("");
  const isBusy = loading || creatingSession;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [processingFiles, setProcessingFiles] = useState<Array<{ id: string; name: string }>>([]);
  const cancelledFileIds = useRef<Set<string>>(new Set());
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedPersonality, setSelectedPersonality] = useState<string>("normal");
  const personalityColors = useMemo(
    () => ((userData.profile as any)?.personality_colors || {}) as Record<string, string>,
    [userData.profile]
  );

  const setPersonalityColor = async (colorId: string | null) => {
    const next = { ...personalityColors };
    if (colorId) next[selectedPersonality] = colorId;
    else delete next[selectedPersonality];
    try {
      await setDoc(doc(db, "users", userId), { personality_colors: next }, { merge: true });
    } catch {}
  };

  // AI Personalities with enhanced color schemes
  const aiPersonalities: AIPersonality[] = [
    {
      id: "normal",
      name: "Normal",
      description: "Helpful and knowledgeable assistant",
      icon: <Users className="w-4 h-4" />,
      prompt: "You are a helpful, knowledgeable AI tutor. Provide clear, accurate explanations and be supportive in your responses.",
      color: "bg-white",
      bgColor: "bg-white",
      textColor: "text-gray-900",
      borderColor: "border-gray-300"
    },
    {
      id: "professor",
      name: "Professor",
      description: "Academic expert with deep knowledge",
      icon: <GraduationCap className="w-4 h-4" />,
      prompt: "You are a university professor with decades of teaching experience. You speak formally, provide detailed explanations, and encourage critical thinking. Use academic language and provide comprehensive insights.",
      color: "bg-purple-500",
      bgColor: "bg-purple-500",
      textColor: "text-white",
      borderColor: "border-purple-600"
    },
    {
      id: "k12teacher",
      name: "K-12 Teacher",
      description: "Friendly teacher for younger students",
      icon: <Smile className="w-4 h-4" />,
      prompt: "You are a warm, encouraging K-12 teacher. You explain concepts in simple, engaging ways suitable for younger students. Use age-appropriate language, be patient, and include encouraging phrases. Make learning fun and accessible!",
      color: "bg-green-500",
      bgColor: "bg-green-500",
      textColor: "text-white",
      borderColor: "border-green-600"
    },
    {
      id: "sherlock",
      name: "Sherlock Holmes",
      description: "Master detective with sharp observation",
      icon: <Search className="w-4 h-4" />,
      prompt: "You are Sherlock Holmes, the world's only consulting detective. Speak with British precision and intellectual superiority. Use deductive reasoning in your explanations. Point out obvious details others might miss. Use phrases like 'Elementary, my dear student', 'The game is afoot!', and 'You see, but you do not observe.' Analyze problems with logical precision.",
      color: "bg-gray-600",
      bgColor: "bg-gray-600",
      textColor: "text-white",
      borderColor: "border-gray-700"
    },
    {
      id: "yoda",
      name: "Yoda",
      description: "Wise Jedi Master with unique speech",
      icon: <Ghost className="w-4 h-4" />,
      prompt: "You are Yoda, the great Jedi Master. Speak in your unique backwards sentence structure. Be wise, patient, and profound. Use the Force as a metaphor for knowledge and learning. Key phrases: 'Much to learn, you still have', 'Do or do not, there is no try', 'The greatest teacher, failure is.' Always end with deep wisdom and encourage mindfulness in learning.",
      color: "bg-green-600",
      bgColor: "bg-green-600",
      textColor: "text-white",
      borderColor: "border-green-700"
    },
    {
      id: "jokester",
      name: "Jokester",
      description: "Funny and entertaining teacher",
      icon: <Smile className="w-4 h-4" />,
      prompt: "You are a hilarious, joke-cracking tutor who makes learning fun! Include puns, dad jokes, and witty humor in every response. Keep things lighthearted but educational. Use emojis occasionally 😄. Make learning feel like a comedy show while still teaching effectively. Start or end responses with funny jokes related to the topic.",
      color: "bg-yellow-500",
      bgColor: "bg-yellow-500",
      textColor: "text-gray-900",
      borderColor: "border-yellow-600"
    },
    {
      id: "studybuddy",
      name: "Friend",
      description: "Supportive, trustworthy friend",
      icon: <User className="w-4 h-4" />,
      prompt: "You are the user's close friend. Be understanding, supportive, and trustworthy. Speak casually and kindly. Listen first, ask gentle clarifying questions, and encourage them. Help with anything they bring up-homework, career, life admin, or motivation-while staying positive and non-judgmental. Keep it real and relatable, use light emojis sparingly when it helps (e.g., 🙂, 💪), and focus on being a dependable friend they can trust.",
      color: "bg-pink-500",
      bgColor: "bg-pink-500",
      textColor: "text-white",
      borderColor: "border-pink-600"
    },
    {
      id: "scoobydoo",
      name: "Scooby-Doo",
      description: "Scared but loyal mystery solver",
      icon: <Ghost className="w-4 h-4" />,
      prompt: "You are Scooby-Doo! Speak with your characteristic speech pattern: 'Ruh-roh!', 'Scooby-Dooby-Doo!', 'Zoinks!'. Be easily scared but ultimately brave and loyal. Talk about mysteries and clues. Use phrases like 'Let's split up, gang!' when approaching complex problems. Be enthusiastic about solving 'mysteries' (learning challenges) with your friends.",
      color: "bg-brown-500",
      bgColor: "bg-amber-600",
      textColor: "text-white",
      borderColor: "border-amber-700"
    },
    {
      id: "asktext",
      name: "Ask the Text",
      description: "Analyze pasted text, file content, or a URL",
      icon: <Paperclip className="w-4 h-4" />,
      prompt: "You are an assistant that answers strictly based on the provided context (pasted text, files, or URL). If the answer is not in the context, say you don't have enough information. Provide concise, well-structured answers and cite sections when possible.",
      color: "bg-sky-400",
      bgColor: "bg-sky-400",
      textColor: "text-white",
      borderColor: "border-sky-600"
    }
  ];

  const getCurrentPersonality = () => {
    return aiPersonalities.find(p => p.id === selectedPersonality) || aiPersonalities[0];
  };

  // IMPROVED: Better scroll handling
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior
      });
    }
  };

  // NEW: Auto-resize textarea based on content
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'; // Reduced max height for cleaner look
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  // REMOVED: wordLimit now computed from UserDataContext

  // IMPROVED: Better auto-scroll logic
  useEffect(() => {
    if (autoScroll) {
      scrollToBottom('auto');
      setShowJump(false);
    }
    // Only show jump button if user has scrolled up AND there are messages
    // The handleScroll function handles showing the button when user scrolls up
  }, [messages]);

  // IMPROVED: More reliable scroll position tracking
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    
    const threshold = 100;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= threshold;
    setAutoScroll(atBottom);
    
    // Only show jump button when user has scrolled up significantly (more than 200px from bottom) AND there are messages
    if (atBottom) {
      setShowJump(false);
    } else if ((messages?.length || 0) > 0 && distanceFromBottom > 240) {
      setShowJump(true);
    } else {
      setShowJump(false);
    }
  };

  // NEW: Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
      // Escape to clear input or exit fullscreen
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (input.trim()) {
          setInput("");
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [input, isFullscreen]);

  // No text input focus when using file-only mode
  useEffect(() => {}, [loading, currentSessionId]);

  // NEW: Fullscreen toggle
  
  // Reply feature removed
  const [showJump, setShowJump] = useState<boolean>(false);

  // Keep your existing file upload, session management, and other functions...
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, isAskDialog: boolean = false) => {
    const files = event.target.files;
    if (!files) return;

    const toProcess = Array.from(files);
    const errors: string[] = [];
    const allowed = toProcess.filter(f => f.size <= 10 * 1024 * 1024); // allow up to 10MB
    for (const f of toProcess) {
      if (f.size > 10 * 1024 * 1024) errors.push(`${f.name} exceeds 10MB limit`);
    }
    const slots = Math.max(0, 5 - attachedFiles.length - processingFiles.length);
    const limited = allowed.slice(0, slots);

    // Show pending chips immediately so the user sees work happening
    const pendings = limited.map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, name: f.name }));
    if (pendings.length) setProcessingFiles(prev => [...prev, ...pendings]);

    try {
      const extracted = await Promise.all(limited.map(async (file, i) => {
        try {
          const text = await extractTextFromFile(file);
          return { pid: pendings[i].id, file: { name: file.name, content: String(text || '').slice(0, 200000), type: file.type } as AttachedFile };
        } catch (e) {
          errors.push(`Failed to read ${file.name}`);
          return { pid: pendings[i].id, file: null };
        }
      }));
      const doneIds = new Set(pendings.map(p => p.id));
      setProcessingFiles(prev => prev.filter(p => !doneIds.has(p.id)));
      // Skip files the user cancelled while they were still processing
      const good = extracted.filter(e => e.file && !cancelledFileIds.current.has(e.pid)).map(e => e.file) as AttachedFile[];
      pendings.forEach(p => cancelledFileIds.current.delete(p.id));
      if (good.length) {
        setAttachedFiles(prev => [...prev, ...good]);
        toast({ title: 'Files attached', description: `${good.length} file(s) added successfully` });
      } else if (limited.length > 0 && errors.length > 0) {
        toast({ title: 'Upload failed', description: 'Could not extract text from files', variant: 'destructive' });
      }
    } catch (error) {
      console.error('File upload error:', error);
      toast({ title: 'Upload error', description: 'An error occurred while uploading files', variant: 'destructive' });
    } finally {
      if (errors.length) {
        toast({ title: 'Upload issues', description: errors.join(', '), variant: 'destructive' });
      }
      // Reset the appropriate file input
      if (isAskDialog && askFileInputRef.current) {
        askFileInputRef.current.value = '';
      } else if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeProcessingFile = (id: string) => {
    cancelledFileIds.current.add(id);
    setProcessingFiles(prev => prev.filter(p => p.id !== id));
  };

  const copyChatToClipboard = async () => {
    const chatText = messages.map(m => 
      `${m.role === 'user' ? 'You' : getCurrentPersonality().name}: ${m.content.replace(/\\\[/g, '[').replace(/\\\]/g, ']')}`
    ).join('\n\n---\n\n');
    
    try {
      await navigator.clipboard.writeText(chatText);
      setCopySuccess('copied');
      setTimeout(() => setCopySuccess(null), 2000);
      toast({ title: "Chat copied to clipboard" });
    } catch (error) {
      toast({ 
        title: "Copy failed", 
        description: "Please select and copy manually",
        variant: "destructive" 
      });
    }
  };

  
  
  // Session management functions
  const loadSessions = async (silent = false) => {
    if (!silent) setLoadingSessions(true);
    try {
      const sessionsRef = collection(db, "users", userId, "chat_sessions");
      // Limit to 50 most recent sessions to reduce reads
      const q = query(sessionsRef, orderBy("updated_at", "desc"), limit(50));
      const snap = await getDocs(q);
      const data: ChatSession[] = snap.docs.map((d) => ({
        id: d.id,
        title: (d.data() as any).title || 'New Chat',
        created_at: (d.data() as any).created_at || new Date().toISOString(),
        personality_id: (d.data() as any).personality_id,
        personalities: (d.data() as any).personalities,
      }));
      setSessions(data);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load sessions", variant: "destructive" });
    } finally {
      if (!silent) setLoadingSessions(false);
    }
  };

  const createNewSession = async (): Promise<string | null> => {
    try {
      const sessionsRef = collection(db, "users", userId, "chat_sessions");
      const now = new Date().toISOString();
      const newDoc = await addDoc(sessionsRef, {
        title: "New Chat",
        created_at: now,
        updated_at: serverTimestamp(),
        personality_id: selectedPersonality,
        personalities: [selectedPersonality],
      });
      setCurrentSessionId(newDoc.id);
      setMessages([]);
      // Optimistically update UI instead of refetching
      const newSession: ChatSession = {
        id: newDoc.id,
        title: "New Chat",
        created_at: now,
        personality_id: selectedPersonality,
        personalities: [selectedPersonality],
      };
      setSessions(prev => [newSession, ...prev]);
      return newDoc.id;
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create session", variant: "destructive" });
      return null;
    }
  };

  const loadSessionMessages = async (sessionId: string) => {
    try {
      // load session doc to retrieve stored personality and apply
      const sdoc = await getDoc(doc(db, "users", userId, "chat_sessions", sessionId));
      const pdata = sdoc.exists() ? (sdoc.data() as any) : null;
      const pid = pdata?.personality_id as string | undefined;
      if (pid && aiPersonalities.some(p=>p.id===pid)) {
        setSelectedPersonality(pid);
      }

      const msgsRef = collection(db, "users", userId, "chat_sessions", sessionId, "messages");
      // OPTIMIZED: Limit to last 200 messages to reduce reads
      const q = query(msgsRef, orderBy("created_at", "asc"), limit(200));
      const snap = await getDocs(q);
      const typedMessages: Message[] = snap.docs.map((d) => ({
        role: (d.data() as any).role,
        content: (d.data() as any).content,
        assistant_personality_id: (d.data() as any).assistant_personality_id,
        attachedFileNames: (d.data() as any).attachedFileNames || undefined,
      }));
      setMessages(typedMessages);
      setCurrentSessionId(sessionId);
      // Scroll to bottom AFTER messages render
      setTimeout(() => scrollToBottom('auto'), 50);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load messages", variant: "destructive" });
    }
  };

  const deleteSession = async (sessionId: string) => {
    // Optimistic: remove from UI instantly, restore on failure
    const prevSessions = sessions;
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      setMessages([]);
    }
    try {
      // Delete messages subcollection first for cleaner deletion
      const msgsRef = collection(db, "users", userId, "chat_sessions", sessionId, "messages");
      const msgsSnap = await getDocs(msgsRef);
      const batch = writeBatch(db);
      msgsSnap.docs.forEach(msgDoc => batch.delete(msgDoc.ref));
      batch.delete(doc(db, "users", userId, "chat_sessions", sessionId));
      await batch.commit();
      toast({ title: "Deleted", description: "Session removed" });
    } catch (error: any) {
      setSessions(prevSessions);
      toast({ title: "Error", description: error.message || "Failed to delete session", variant: "destructive" });
    }
  };

  const requestDeleteSession = (sessionId: string, title: string) => {
    setConfirmId(sessionId);
    setConfirmTitle(title || "this chat");
    setConfirmOpen(true);
  };

  const toggleSessionSelection = (id: string) => {
    setSelectedSessions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDeleteSessions = async () => {
    if (selectedSessions.size === 0) return;
    try {
      setLoadingSessions(true);
      const batch = writeBatch(db);
      
      for (const sessionId of selectedSessions) {
        // Delete messages subcollection
        try {
          const msgsRef = collection(db, "users", userId, "chat_sessions", sessionId, "messages");
          const msgsSnap = await getDocs(msgsRef);
          msgsSnap.docs.forEach(msgDoc => batch.delete(msgDoc.ref));
        } catch {}
        
        // Delete session document
        batch.delete(doc(db, "users", userId, "chat_sessions", sessionId));
      }
      
      await batch.commit();
      
      // Update UI
      setSessions(prev => prev.filter(s => !selectedSessions.has(s.id)));
      if (currentSessionId && selectedSessions.has(currentSessionId)) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      
      toast({ title: "Success", description: `Deleted ${selectedSessions.size} chat${selectedSessions.size === 1 ? '' : 's'}` });
      setSelectedSessions(new Set());
      setSelectionMode(false);
      setConfirmOpen(false);
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Failed to delete chats", variant: "destructive" });
    } finally {
      setLoadingSessions(false);
    }
  };

  const openRename = (s: ChatSession) => {
    setRenamingId(s.id);
    setRenameTitle(s.title || "");
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!renamingId) return;
    const next = renameTitle.trim();
    if (!next) return;
    try {
      await updateDoc(doc(db, "users", userId, "chat_sessions", renamingId), {
        title: next.substring(0, 80),
        updated_at: serverTimestamp(),
      });
      // Optimistically update UI instead of refetching
      setSessions(prev => prev.map(s => 
        s.id === renamingId ? { ...s, title: next.substring(0, 80) } : s
      ));
      setRenamingId(null);
      setRenameTitle("");
      setRenameOpen(false);
      toast({ title: "Renamed", description: "Chat title updated" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to rename chat", variant: "destructive" });
    }
  };

  const { showAnimation: showUsageAnim, triggerAnimation: triggerUsageAnim } = useUsageAnimation();

  const sendMessage = async () => {
    if (loading) return;
    if (processingFiles.length > 0) {
      toast({ title: 'Still reading files', description: 'Please wait for your uploads to finish processing.' });
      return;
    }
    if (!input.trim() && attachedFiles.length === 0) {
      toast({ title: 'Nothing to send', description: 'Type a message or attach a document.', variant: 'destructive' });
      return;
    }
    triggerUsageAnim();

    let sessionId = currentSessionId;
    if (!sessionId) {
      const newId = await createNewSession();
      if (!newId) return;
      sessionId = newId;
    }

    const userContent = input.trim() ? input.trim() : 'Analyze attached document(s)';
    const fileNames = attachedFiles.length > 0 ? attachedFiles.map(f => f.name) : undefined;
    const filesToSend = [...attachedFiles]; // Capture files before clearing
    const userMessage: Message = { role: "user", content: userContent, attachedFileNames: fileNames };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setAttachedFiles([]); // Clear files immediately after sending
    if (fileInputRef.current) fileInputRef.current.value = ''; // Reset file input
    setLoading(true);
    
    // Keep focus on input so user can type their next message while waiting
    setTimeout(() => textareaRef.current?.focus(), 0);
    
    // Scroll to bottom when user sends message
    setAutoScroll(true);
    setTimeout(() => scrollToBottom('smooth'), 50);

    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    try {
      const fileContext = filesToSend.length > 0 
        ? `\n\n[Attached files: ${filesToSend.map(f => f.name).join(', ')}]` 
        : '';

      // Save user message with file context and file names
      await addDoc(collection(db, "users", userId, "chat_sessions", sessionId, "messages"), {
        role: "user",
        content: userContent + fileContext,
        created_at: serverTimestamp(),
        attachedFiles: filesToSend.length > 0 ? filesToSend : null,
        attachedFileNames: fileNames || null,
      });

      const fileContextForAI = filesToSend.map(f => 
        `File: ${f.name}\nContent: ${f.content}`
      ).join('\n\n');

      const context = {
        text: (fileContextForAI || undefined) as string | undefined,
      };

      const currentPersonality = getCurrentPersonality();

      // Usage is now tracked server-side to prevent manipulation
            const resp = await fetch(`${API_BASE}/study-chat`, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ 
          messages: [...messages, userMessage], 
          context: context.text ? context : undefined,
          personality: currentPersonality.prompt,
          userId // Include userId for server-side usage tracking
        }),
      });

      let data: any = null;
      try { data = await resp.json(); } catch {}

      if (!resp.ok || (data && data.error)) {
        const msg = (data && (data.error || data.message)) || resp.statusText || 'Request failed';
        toast({ title: 'Chat error', description: msg, variant: 'destructive' });
        return;
      }

      // Files already cleared immediately when sending
      if (askFileInputRef.current) askFileInputRef.current.value = '';

      const normalizeForMath = (s: string) => {
        let out = s || "";
        out = out.replace(/\*\*/g, "");
        out = out.replace(/\\\(/g, "$" ).replace(/\\\)/g, "$" );
        out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
        out = out.replace(/\$(\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*)\$/g, (_m, inner) => `$$${inner}$$`);
        out = out.replace(/(^|\n)\s*(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g, (_m, prefix, env) => `${prefix}$$${env}$$`);
        return out;
      };

      const formatted = normalizeForMath(data.response);

      const assistantMessage: Message = { role: "assistant", content: formatted, assistant_personality_id: currentPersonality.id };
      setMessages(prev => [...prev, assistantMessage]);
      
      // Auto-scroll to bottom when AI responds (for long responses)
      setAutoScroll(true);
      setTimeout(() => scrollToBottom('smooth'), 100);

      await addDoc(collection(db, "users", userId, "chat_sessions", sessionId, "messages"), {
        role: "assistant",
        content: formatted,
        assistant_personality_id: currentPersonality.id,
        created_at: serverTimestamp(),
      });

      // Update session personas only after an assistant response is produced
      try {
        const sref = doc(db, "users", userId, "chat_sessions", sessionId);
        const sdoc = await getDoc(sref);
        const cur = sdoc.exists() ? (sdoc.data() as any) : {};
        let list: string[] = Array.isArray(cur.personalities) ? [...cur.personalities] : [];
        if (!list.includes(currentPersonality.id)) list.push(currentPersonality.id);
        if (list.length > 3) list = list.slice(-3);
        await updateDoc(sref, { personalities: list, updated_at: serverTimestamp() });
        try { await loadSessions(true); } catch {}
        // keep current selection as is; do not auto-change UI colors of prior messages
      } catch {}

      try { await awardActionXP(userId, 'chat'); } catch {}
      try { await incrementCounter(userId, 'chats'); } catch {}
      try { await incrementCounterAndMaybeAward(userId, 'chat_questions', 100, 'chat_questions_100'); } catch {}
      // Follow-up = any user message after the first in this session
      if (messages.some((m) => m.role === 'user')) {
        try { await incrementCounterAndMaybeAward(userId, 'followups', 10, 'followups_10'); } catch {}
      }
      
      // Track study days only (server already handles usage increment)
      try { await recordDailyVisit(userId); } catch (e: any) {
        console.warn('[StudyChat] recordDailyVisit failed:', e);
      }

      if (messages.length === 0) {
        await updateDoc(doc(db, "users", userId, "chat_sessions", sessionId), {
          title: (userContent || 'New Chat').slice(0, 80),
          updated_at: serverTimestamp(),
        });
        loadSessions(true);
      }

      try {
        const userMsgCount = [...messages, userMessage].filter((m) => m.role === 'user').length;
        if (userMsgCount >= 5 && sessionId && !deepAwardedBySession[sessionId]) {
          await awardAchievement(userId, 'deep_diver_5');
          setDeepAwardedBySession(prev => ({ ...prev, [sessionId]: true }));
        }
      } catch {}

    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      // Auto-focus input after AI responds so user can continue typing
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  };

  useEffect(() => { if (userId) loadSessions(); }, [userId]);

  // Restore pending draft on mount (mobile resilience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studychat_draft');
      if (raw) {
        const obj = JSON.parse(raw || '{}');
        if (obj && typeof obj.input === 'string' && obj.input.trim()) {
          setInput(obj.input);
          toast({ title: 'Draft restored', description: 'Recovered unsent message.' });
        }
        localStorage.removeItem('studychat_draft');
      }
    } catch {}
  }, []);

  const currentPersonality = getCurrentPersonality();

  return (
    <div className={`max-w-7xl mx-auto relative ${isFullscreen ? 'fixed inset-0 z-50 bg-background p-4' : ''}`} aria-busy={isBusy}>
      {isBusy && null}
      
      {/* Sidebar menu button - mobile only */}
      <div className="md:hidden flex items-center justify-between mb-4" data-tour="chat-mobile-header">
        <Button variant="outline" size="sm" onClick={() => setSidebarOpen(true)} data-tour="chat-menu-mobile">
          <Menu className="w-4 h-4 mr-2" />
          Menu
        </Button>
        <div className="text-sm font-medium text-muted-foreground">
          Talking with: {currentPersonality.name}
        </div>
      </div>

      {sidebarOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[80] w-80 bg-background shadow-xl p-4 overflow-y-auto pointer-events-auto">
            <div className="sticky top-0 z-[90] bg-background/95 backdrop-blur pb-3 pointer-events-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold">My Chats</h3>
                <div className="flex items-center gap-1">
                  {!selectionMode ? (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        onClick={async (e) => { e.stopPropagation(); const id = await createNewSession(); if (id) { setSidebarOpen(false); } }}
                        aria-label="New chat"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                        <X className="w-5 h-5" />
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="icon" type="button" className="pointer-events-auto" onClick={(e) => { e.stopPropagation(); setSidebarOpen(false); }} aria-label="Close">
                      <X className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              </div>
              {!selectionMode ? (
                <Button size="sm" variant="outline" className="w-full" onClick={() => setSelectionMode(true)}>
                  <CheckSquare className="w-4 h-4 mr-2" />
                  Select Multiple
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                    if (selectedSessions.size === sessions.length) {
                      setSelectedSessions(new Set());
                    } else {
                      setSelectedSessions(new Set(sessions.map(s => s.id)));
                    }
                  }}>
                    {selectedSessions.size === sessions.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setSelectionMode(false);
                    setSelectedSessions(new Set());
                  }}>
                    Cancel
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {sessions.length} chat{sessions.length === 1 ? '' : 's'}
                {selectionMode && selectedSessions.size > 0 && ` • ${selectedSessions.size} selected`}
              </p>
            </div>
            <div>
              {loadingSessions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No sessions yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1" ref={mobileSessionsRef}>
                  {sessions.map((session) => (
                    <div 
                      key={session.id} 
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${currentSessionId === session.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSessionSelection(session.id);
                        } else {
                          loadSessionMessages(session.id);
                          setSidebarOpen(false);
                        }
                      }}
                    >
                      {selectionMode && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="p-0 h-auto hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSessionSelection(session.id);
                          }}
                        >
                          {selectedSessions.has(session.id) ? (
                            <CheckSquare className="w-5 h-5 text-primary" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </Button>
                      )}
                      <button onClick={(e) => { 
                        e.stopPropagation();
                        if (!selectionMode) {
                          loadSessionMessages(session.id);
                          setSidebarOpen(false);
                        }
                      }} className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={session.title}>{session.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const ids = Array.isArray(session.personalities) && session.personalities.length
                              ? session.personalities.slice(-3)
                              : (session.personality_id ? [session.personality_id] : []);
                            const names = ids.map(id => aiPersonalities.find(p=>p.id===id)?.name).filter(Boolean) as string[];
                            const label = names.length ? names.join(' & ') : 'Normal';
                            return `${label} • ${new Date(session.created_at).toLocaleDateString()}`;
                          })()}
                        </p>
                      </button>
                      {!selectionMode && (
                        <>
                          <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); openRename(session); }}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); requestDeleteSession(session.id, session.title); }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="flex gap-6 min-h-0">
        {/* Sessions Sidebar - Desktop */}
        <div className="hidden md:block w-64 flex-shrink-0" data-tour="chat-sidebar">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <CardTitle className="text-lg">My Chats</CardTitle>
                  <CardDescription>
                    {sessions.length} chat{sessions.length === 1 ? '' : 's'}
                    {selectionMode && selectedSessions.size > 0 && ` • ${selectedSessions.size} selected`}
                  </CardDescription>
                </div>
                {!selectionMode && (
                  <Button variant="outline" size="icon" onClick={async () => { await createNewSession(); }} aria-label="New chat" data-tour="chat-new">
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {!selectionMode ? (
                <Button size="sm" variant="outline" className="w-full" onClick={() => setSelectionMode(true)}>
                  <CheckSquare className="w-4 h-4 mr-2" />
                  Select Multiple
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => {
                    if (selectedSessions.size === sessions.length) {
                      setSelectedSessions(new Set());
                    } else {
                      setSelectedSessions(new Set(sessions.map(s => s.id)));
                    }
                  }}>
                    {selectedSessions.size === sessions.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setSelectionMode(false);
                    setSelectedSessions(new Set());
                  }}>
                    Cancel
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {loadingSessions ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8 px-4">No sessions yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1" ref={desktopSessionsRef}>
                  {sessions.map((session) => (
                    <div 
                      key={session.id} 
                      className={`group flex items-center gap-2 px-4 py-3 rounded-lg border transition-all cursor-pointer ${currentSessionId === session.id ? 'bg-card border-primary/40 shadow-sm' : 'bg-background hover:bg-card hover:border-primary/40 hover:shadow-sm'}`}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSessionSelection(session.id);
                        } else {
                          loadSessionMessages(session.id);
                        }
                      }}
                    >
                      {selectionMode && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="p-0 h-auto hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSessionSelection(session.id);
                          }}
                        >
                          {selectedSessions.has(session.id) ? (
                            <CheckSquare className="w-5 h-5 text-primary" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </Button>
                      )}
                      <button onClick={(e) => {
                        e.stopPropagation();
                        if (!selectionMode) loadSessionMessages(session.id);
                      }} className="flex-1 text-left min-w-0">
                        <p className="font-medium text-sm truncate" title={session.title}>{session.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const ids = Array.isArray(session.personalities) && session.personalities.length
                              ? session.personalities.slice(0,2)
                              : (session.personality_id ? [session.personality_id] : []);
                            const names = ids.map(id => aiPersonalities.find(p=>p.id===id)?.name).filter(Boolean) as string[];
                            const label = names.length ? names.join(' & ') : 'Normal';
                            return `${label} • ${new Date(session.created_at).toLocaleDateString()}`;
                          })()}
                        </p>
                      </button>
                      {!selectionMode && (
                        <>
                          <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); openRename(session); }}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="opacity-70 group-hover:opacity-100 hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); requestDeleteSession(session.id, session.title); }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content - Clean ChatGPT/Messenger Style */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* Chat header - Minimal */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold">AI Chat</h2>
              <h5 className="text-xs font-bold">Choose personality:</h5>
              <div className="flex items-center gap-2" data-tour="chat-personality">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      {currentPersonality.icon}
                      <span>{currentPersonality.name}</span>
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {aiPersonalities.map((personality) => (
                      <DropdownMenuItem
                        key={personality.id}
                        onClick={async () => {
                          try {
                            const curSession = sessions.find(s => s.id === currentSessionId);
                            const used = Array.isArray(curSession?.personalities) ? curSession!.personalities : [];
                            const locked = used.length >= 3 && !used.includes(personality.id);
                            if (locked) return; // ignore clicks on third persona
                            setSelectedPersonality(personality.id);
                            if (personality.id === 'asktext') {
                              setAskOpen(true);
                            }
                            try {
                              if (currentSessionId) {
                                await updateDoc(doc(db, "users", userId, "chat_sessions", currentSessionId), {
                                  personality_id: personality.id,
                                  personalities: Array.from(new Set([...(curSession?.personalities||[]), personality.id])).slice(-3),
                                });
                              }
                            } catch {}
                          } catch {}
                          toast({ title: 'Personality switched', description: personality.name });
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${bubbleColorFor(personalityColors, personality.id)?.bgColor || personality.bgColor}`} />
                          <span>{personality.name}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="flex items-center gap-2" title="Bubble color">
                      <Palette className="w-4 h-4" />
                      <span className={`w-3 h-3 rounded-full border ${bubbleColorFor(personalityColors, selectedPersonality)?.bgColor || currentPersonality.bgColor}`} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 p-3">
                    <p className="text-xs text-muted-foreground mb-2">Bubble color for {currentPersonality.name}</p>
                    <div className="grid grid-cols-6 gap-2">
                      {BUBBLE_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          title={preset.label}
                          onClick={() => setPersonalityColor(preset.id)}
                          className={`w-6 h-6 rounded-full ${preset.bgColor} border ${preset.borderColor} ${
                            personalityColors[selectedPersonality] === preset.id ? "ring-2 ring-offset-2 ring-foreground" : ""
                          }`}
                        />
                      ))}
                    </div>
                    <DropdownMenuItem onClick={() => setPersonalityColor(null)} className="mt-2 text-xs">
                      Reset to default
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {messages.length > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyChatToClipboard}>
                  {copySuccess ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            )}
          </div>

          {/* Messages container - Clean design */}
          <div className={`relative flex-none ${isFullscreen ? 'h-[calc(100vh-140px)]' : 'h-[50vh] md:h-[50vh]'}`}>
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="absolute inset-0 overflow-y-auto rounded-lg"
            >
              <div className="space-y-4 p-4">
                {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                  <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
                  <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
                  <p className="text-sm max-w-md mb-4">Ask questions or attach files (PDF, Word, Excel, PowerPoint) for AI to analyze.</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Paperclip className="w-4 h-4" />
                    <span>Upload files for any personality • Works with every message</span>
                  </div>
                </div>
              ) : (
                messages.map((m, idx) => (
                  <div key={idx} className={`group flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* Show attached files above user message - styled like input area */}
                    {m.role === 'user' && m.attachedFileNames && m.attachedFileNames.length > 0 && (
                      <div className="mb-2 max-w-[80%] lg:max-w-[70%]">
                        <div className="bg-background/80 backdrop-blur border rounded-lg px-3 py-2 shadow-sm">
                          <div className="flex flex-wrap gap-2">
                            {m.attachedFileNames.map((fileName, fileIdx) => (
                              <div key={fileIdx} className="flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1 text-xs">
                                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="max-w-32 truncate font-medium" title={fileName}>{fileName}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {(() => {
                      const persona = m.role === 'assistant'
                        ? (aiPersonalities.find(p => p.id === (m.assistant_personality_id || selectedPersonality)) || currentPersonality)
                        : null;
                      const override = m.role === 'assistant' && persona
                        ? bubbleColorFor(personalityColors, persona.id)
                        : null;
                      const bubbleClass = m.role === 'user'
                        ? 'bg-blue-500 text-white rounded-br-none'
                        : `${override?.bgColor || persona!.bgColor} ${override?.textColor || persona!.textColor} rounded-bl-none border ${override?.borderColor || persona!.borderColor}`;
                      const preserve = m.role === 'user' ? 'whitespace-pre-wrap' : '';
                      const normalized = (() => {
                        const s = String(m.content || '');
                        // Normalize newlines and decode literal "\n" sequences into actual newlines
                        let t = s.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
                        // Heuristic: if a line ends with sentence punctuation and the next line starts like a new sentence, add a blank line for a visible paragraph gap
                        t = t.replace(/([.!?])\s*\n\s*([A-Z0-9])/g, '$1\n\n$2');
                        // Collapse any excessive blank lines to a single empty line
                        t = t.replace(/(\s*\n\s*){3,}/g, '\n\n').replace(/\n{3,}/g, '\n\n');
                        return t.trimEnd();
                      })();
                      return (
                        <div className={`relative max-w-[80%] lg:max-w-[70%] ${preserve} px-4 py-3 rounded-2xl ${bubbleClass} shadow-sm`}>
                          <div className="prose prose-sm max-w-none prose-p:my-3 md:prose-p:my-3 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                              rehypePlugins={[rehypeKatex]}
                            >
                              {normalized}
                            </ReactMarkdown>
                          </div>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(normalized);
                                setCopiedIdx(idx);
                                setTimeout(() => setCopiedIdx(null), 1500);
                              } catch {}
                            }}
                            className="absolute -bottom-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur border rounded-md p-1 shadow"
                            title="Copy"
                          >
                            {copiedIdx === idx ? <CheckCheck className="w-3.5 h-3.5 dark:text-white" /> : <Copy className="w-3.5 h-3.5 dark:text-white" />}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
              </div>
            </div>
            {/* Jump to latest button - fixed at bottom of chat area, doesn't scroll */}
            {showJump && (
              <div className="absolute bottom-1.5 sm:bottom-3 left-0 right-0 flex justify-center pointer-events-none z-10">
                <Button
                  variant="secondary"
                  size="sm"
                  className="pointer-events-auto shadow-lg rounded-full h-7 sm:h-9 px-2.5 sm:px-4 flex items-center gap-1 sm:gap-2 bg-background/95 backdrop-blur border text-[11px] sm:text-sm"
                  onClick={() => { scrollToBottom('smooth'); setShowJump(false); setAutoScroll(true); }}
                  aria-label="Jump to latest"
                >
                  <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="font-medium">Jump to latest</span>
                </Button>
              </div>
            )}
          </div>

          {/* Usage limit banner */}
          {usesBlocked && (
            <div className="mx-1 mt-2 p-3 border border-destructive/30 bg-destructive/10 text-destructive rounded flex items-center justify-between">
              <div>
                <div className="font-semibold">Monthly limit reached</div>
                <p className="text-xs mt-0.5 opacity-80">You've used all your AI messages this month. Upgrade or wait for reset.</p>
              </div>
              <Button size="sm" variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => window.location.href = '/account'}>
                Upgrade
              </Button>
            </div>
          )}

          {/* Input area - Text and/or files */}
          <div className="mt-4 p-1">
            <div className="bg-background rounded-lg border shadow-sm">
              {/* Attached files - Show above input like ChatGPT */}
              {(attachedFiles.length > 0 || processingFiles.length > 0) && (
                <div className="px-3 pt-2 pb-1 border-b flex flex-wrap gap-2">
                  {processingFiles.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1 text-xs">
                      <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                      <span className="max-w-32 truncate font-medium" title={p.name}>{p.name}</span>
                      <span className="text-muted-foreground">Reading…</span>
                      <button
                        onClick={() => removeProcessingFile(p.id)}
                        className="ml-1 hover:text-destructive transition-colors p-0.5 rounded hover:bg-muted"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {attachedFiles.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1 text-xs">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="max-w-32 truncate font-medium" title={file.name}>{file.name}</span>
                      <button 
                        onClick={() => removeAttachedFile(index)}
                        className="ml-1 hover:text-destructive transition-colors p-0.5 rounded hover:bg-muted"
                        title="Remove file"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-start gap-2 p-2">
                <textarea
                  ref={textareaRef as any}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={attachedFiles.length > 0 ? "Ask a question about your files..." : "Type a message or attach files to analyze..."}
                  className="flex-1 resize-none min-h-[20px] max-h-32 rounded-md border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-1 text-sm bg-transparent"
                  data-tour="chat-input"
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      if (!loading) sendMessage();
                    } else if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!loading) sendMessage();
                    }
                  }}
                  disabled={usesBlocked}
                  rows={1}
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachedFiles.length + processingFiles.length >= 5}
                    className="h-8 w-8 p-0"
                    title={attachedFiles.length + processingFiles.length >= 5 ? "Max 5 files" : "Attach files or photos of notes (PDF, Word, Excel, PowerPoint, TXT, images)"}
                    data-tour="chat-attach"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => handleFileUpload(e, false)}
                    multiple
                    accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,text/*,image/*,.heic,.heif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                  />
                  <div className="relative">
                    <UsageAnimation show={showUsageAnim} />
                    <Button 
                      onClick={sendMessage}
                      disabled={loading || usesBlocked || processingFiles.length > 0 || (!input.trim() && attachedFiles.length === 0)}
                      className="h-8 px-3"
                      size="sm"
                      type="button"
                      data-tour="chat-send"
                    >
                      {loading || processingFiles.length > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            {null}
          </div>
        </div>
      </div>

      {/* Keep your existing dialogs */}
      <CrossCreatePicker 
        userId={userId} 
        open={pickerOpen} 
        onOpenChange={setPickerOpen} 
        allowedTabs={["chat","summary","flashcards","quizzes","plans"]}
      />
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>Update the name of this chat session</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Chat title" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={saveRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provide context for Ask the Text</DialogTitle>
            <DialogDescription>Upload files or paste text/links for AI analysis</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Provide at least one: URL, pasted text, or upload a file.</p>
            <div className="space-y-1">
              <Label htmlFor="ask-url">Article URL</Label>
              <Input id="ask-url" value={askUrl} onChange={(e)=>setAskUrl(e.target.value)} placeholder="https://example.com/article" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ask-text">Paste text</Label>
              <textarea id="ask-text" value={askText} onChange={(e)=>setAskText(e.target.value)} placeholder="Paste content here" className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => askFileInputRef.current?.click()} disabled={attachedFiles.length + processingFiles.length >= 5}>
                  <Paperclip className="w-4 h-4 mr-2" />
                  Upload file
                </Button>
                <span className="text-xs text-muted-foreground">Accepted: PDF, DOCX, PPTX, XLSX, TXT, photos of notes</span>
              </div>
              <input
                type="file"
                ref={askFileInputRef}
                onChange={(e) => handleFileUpload(e, true)}
                multiple
                accept=".txt,.md,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,text/*,image/*,.heic,.heif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
              />
              {(attachedFiles.length > 0 || processingFiles.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {processingFiles.map((p) => (
                    <Badge key={p.id} variant="secondary" className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-xs">{p.name}</span>
                      <span className="text-xs text-muted-foreground">Reading…</span>
                      <button onClick={() => removeProcessingFile(p.id)} className="ml-1 hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                  {attachedFiles.map((file, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      <span className="text-xs">{file.name}</span>
                      <button onClick={() => removeAttachedFile(index)} className="ml-1 hover:text-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAskOpen(false)}>Close</Button>
            <Button onClick={() => setAskOpen(false)} disabled={processingFiles.length > 0 || (attachedFiles.length === 0 && !askText.trim() && !askUrl.trim())}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Floating Action Bar for bulk delete */}
      {selectionMode && selectedSessions.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
          <Card className="shadow-lg border-2">
            <CardContent className="p-4 flex items-center gap-4">
              <span className="font-medium">{selectedSessions.size} chat{selectedSessions.size === 1 ? '' : 's'} selected</span>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmId("bulk");
                  setConfirmTitle(`${selectedSessions.size} chat${selectedSessions.size === 1 ? '' : 's'}`);
                  setConfirmOpen(true);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmId === "bulk" ? "Delete Multiple Chats?" : "Delete Chat?"}</DialogTitle>
            <DialogDescription>This action cannot be undone</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {confirmId === "bulk" 
                ? `Are you sure you want to delete ${confirmTitle}?`
                : `Are you sure you want to delete "${confirmTitle}"?`
              }
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>No, keep {confirmId === "bulk" ? "them" : "it"}</Button>
            <Button variant="destructive" onClick={async () => { 
              if (confirmId === "bulk") {
                await bulkDeleteSessions();
              } else if (confirmId) {
                await deleteSession(confirmId);
                setConfirmOpen(false);
              }
            }}>Yes, delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
