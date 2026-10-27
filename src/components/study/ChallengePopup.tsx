import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Trophy, BookOpen, Brain, Lightbulb, Save, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { FlashcardViewer } from "@/components/FlashcardViewer";
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp, onSnapshot, increment, type QuerySnapshot, type DocumentData } from "firebase/firestore";
import { db, auth } from "../../../firebase";
import { sanitizeHtml } from "@/lib/sanitize";
import { getReferenceAnswer, gradeQuizAnswers, isShortAnswerQuestion } from "@/lib/quiz-grading";

// --- Utilities moved outside component for performance ---

// Helper to format summary type for display (e.g., "key_points" -> "Key Points")
const formatSummaryType = (type: string) => {
  if (!type) return '';
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// Utilities to normalize option values and answers for robust matching
const normalizeForMath = (val: any) => {
  try {
    let out = typeof val === 'string' ? val : (val && typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val || ""));
    out = out.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
    // Unescape inline/block TeX delimiters often returned as \\( ... \\) and \\[ ... \\]
    out = out.replace(/\\\(/g, "$" ).replace(/\\\)/g, "$");
    out = out.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$");
    out = out.replace(/([^\n])\$\$/g, "$1\n$$");
    out = out.replace(/\$\$([^\n])/g, "$$\n$1");
    // Promote single-$ around environments into $$...$$
    out = out.replace(/\$(\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*)\$/g, (_m, inner) => `$$${inner}$$`);
    // Wrap bare environments on their own lines into $$...$$
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
  } catch { return String(val || ""); }
};

const normalizeString = (val: any) => {
  if (val === undefined || val === null) return "";
  return String(val)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents
};

const getOptionText = (opt: any): string => {
  if (typeof opt === 'string') return opt;
  if (typeof opt === 'number') return String(opt);
  if (opt && typeof opt === 'object') {
    // common fields that may hold the visible text
    const cand = opt.label ?? opt.text ?? opt.value ?? opt.option ?? opt.name;
    return cand !== undefined ? String(cand) : String(opt);
  }
  return String(opt ?? '');
};

interface NormalizedOption {
  id: string | number; // index or key
  text: string;
  originalIndex: number;
}

const normalizeOptions = (question: any): NormalizedOption[] => {
  const src = question?.options;
  if (!src) return [];
  
  if (Array.isArray(src)) {
    return src.map((opt, idx) => {
      // Try to find an inherent ID if opt is an object
      let inherentId: string | number = idx;
      if (opt && typeof opt === 'object') {
           if (opt.id !== undefined) inherentId = opt.id;
           else if (opt.key !== undefined) inherentId = opt.key;
           else if (opt.value !== undefined && typeof opt.value !== 'object') inherentId = opt.value; // Some structures use value as ID
      }
      
      return {
        id: inherentId,
        text: getOptionText(opt),
        originalIndex: idx
      };
    });
  }
  
  if (typeof src === 'object') {
    return Object.entries(src).map(([key, val], idx) => ({
      id: key,
      text: getOptionText(val),
      originalIndex: idx
    }));
  }
  
  return [];
};

const checkAnswer = (userAnswerIndex: any, question: any, options: NormalizedOption[]) => {
  if (userAnswerIndex === undefined || userAnswerIndex === null) return false;
  
  // Get the selected option from the rendered list
  const selectedOption = options[userAnswerIndex];
  if (!selectedOption) return false;

  // Possible correct answer values from DB
  // Includes snake_case variants common in many DBs
  const correctRaw = (
    question.correctAnswer ??
    question.correct_answer ?? // Common snake_case variant
    question.correct ??
    question.answer ??
    question.correct_option ??
    question.correctOption ??
    question.correct_index ??
    question.correctIndex
  );

  // Helper to check a single correct value against the user's selection
  const checkSingle = (val: any) => {
    // 1. Check exact index match (if val is number)
    if (typeof val === 'number' && val === userAnswerIndex) {
      return true;
    }

    // 2. Check ID match (case-insensitive)
    // This must compare keys or IDs, not values
    if (String(val).toLowerCase().trim() === String(selectedOption.id).toLowerCase().trim()) {
      return true;
    }

    // 3. Check Text Match (normalized)
    const correctStr = normalizeString(val);
    const selectedStr = normalizeString(selectedOption.text);
    
    // Handle case where correct answer text might be the KEY of the option
    // e.g. correct="a", option key="a", option text="Hola"
    const selectedKeyStr = normalizeString(selectedOption.id);
    // Normalization of the correct val as a key to compare against option id
    const correctKeyStr = normalizeString(val);

    if (correctStr && selectedStr && correctStr === selectedStr) {
      return true;
    }

    if (correctKeyStr && selectedKeyStr && correctKeyStr === selectedKeyStr) {
      return true;
    }
    
    return false;
  };

  if (correctRaw === undefined || correctRaw === null) {
    return false;
  }

  // Handle array of correct answers (multiple valid answers)
  if (Array.isArray(correctRaw)) {
    return correctRaw.some(checkSingle);
  }

  return checkSingle(correctRaw);
};

// FIXED QUIZ SCORE CALCULATION (robust to multiple correct answer keys and option shapes)
const calculateQuizScore = (answers: any[], questions: any[]) => {
  if (!answers || !questions || answers.length === 0 || questions.length === 0) {
    return { score: 0, correctAnswers: 0 };
  }
  
  let correctCount = 0;
  
  for (let i = 0; i < Math.min(answers.length, questions.length); i++) {
    const userAnswer = answers[i];
    const question = questions[i];
    const opts = normalizeOptions(question);
    
    // Only count as correct if userAnswer is defined (user selected something)
    if (userAnswer !== undefined && userAnswer !== null) {
      const isCorrect = checkAnswer(userAnswer, question, opts);
      
      if (isCorrect) {
        correctCount++;
      }
    }
  }
  
  const score = Math.round((correctCount / questions.length) * 100);
  return { score, correctAnswers: correctCount };
};

interface ChallengePopupProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: any;
  userId: string;
  username: string;
  onSaveToLibrary: (content: any, ownerUsername: string) => void;
  onScoreUpdate: (score: number, attempts: number) => void;
  onOpenProfile: (userId: string) => void;
}

export const ChallengePopup: React.FC<ChallengePopupProps> = ({
  isOpen,
  onClose,
  challenge,
  userId,
  username,
  onSaveToLibrary,
  onScoreUpdate
}) => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [attempts, setAttempts] = useState(1);
  const [currentScore, setCurrentScore] = useState<number | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [showLeaderboardDialog, setShowLeaderboardDialog] = useState(false);
  const runsUnsubRef = useRef<null | (() => void)>(null);

  // Quiz/Flashcard specific state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [masteredCards, setMasteredCards] = useState<Set<string>>(new Set());
  const [revealedSolutions, setRevealedSolutions] = useState<Set<string>>(new Set());
  
  // Short answer grading state
  const [isShortAnswer, setIsShortAnswer] = useState(false);
  const [shortScores, setShortScores] = useState<number[]>([]);
  const [shortFeedbacks, setShortFeedbacks] = useState<string[]>([]);
  const [expectedAnswers, setExpectedAnswers] = useState<string[]>([]);
  const [grading, setGrading] = useState(false);
  const gradingRunRef = useRef(0);
  
  // Flashcard navigation state for footer controls
  const [flashcardState, setFlashcardState] = useState<{
    currentIndex: number;
    totalCards: number;
    masteredCount: number;
    currentCardId: string;
    isCurrentMastered: boolean;
  } | null>(null);

  const stopLeaderboardSubscription = () => {
    if (runsUnsubRef.current) {
      runsUnsubRef.current();
      runsUnsubRef.current = null;
    }
  };

  const toggleSolution = (id: string) => {
    const newRevealed = new Set(revealedSolutions);
    if (newRevealed.has(id)) {
      newRevealed.delete(id);
    } else {
      newRevealed.add(id);
    }
    setRevealedSolutions(newRevealed);
  };

  useEffect(() => {
    gradingRunRef.current += 1;
    setGrading(false);
    if (isOpen && challenge) {
      // Reset state when opening new challenge
      setCurrentQuestionIndex(0);
      setAnswers([]);
      setShowResults(false);
      setMasteredCards(new Set());
      setRevealedSolutions(new Set());
      setCurrentScore(null);
      setIsShortAnswer(false);
      setShortScores([]);
      setShortFeedbacks([]);
      setExpectedAnswers([]);
      setLeaderboardData([]); // Clear old leaderboard data
      
      loadContent();
      // OPTIMIZATION: Don't load leaderboard immediately - defer until user opens leaderboard dialog
      loadUserRunData();
    }
    return () => {
      gradingRunRef.current += 1;
      // cleanup any active leaderboard listener when dialog closes or challenge changes
      stopLeaderboardSubscription();
    };
  }, [isOpen, challenge]);

  // OPTIMIZATION: Load leaderboard only when dialog is opened (saves reads when user doesn't view leaderboard).
  // Always resubscribe on open - the optimistic post-completion entry must not
  // block the live subscription, and closing the dialog frees the listener.
  useEffect(() => {
    if (showLeaderboardDialog && challenge?.id) {
      loadLeaderboard();
    }
    if (!showLeaderboardDialog) {
      stopLeaderboardSubscription();
    }
  }, [showLeaderboardDialog, challenge?.id]);

  const loadContent = async () => {
    if (!challenge?.id) return;
    
    setLoading(true);
    try {
      // First try to use content directly from the challenge object if it exists
      if (challenge.content) {
        setContent(challenge.content);
        
        // Detect if this is a short answer quiz
        if (challenge.type === 'quiz' && challenge.content?.questions) {
          const hasShortAnswer = challenge.content.questions.some((q: any) => 
            q.question_type === 'short_answer' || !q.options || Object.keys(q.options || {}).length === 0
          );
          setIsShortAnswer(hasShortAnswer);
        }
        
        setLoading(false);
        return;
      }
      
      // If no direct content, try to fetch from Firestore
      const docRef = doc(db as any, "feed_posts", challenge.id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // 1) Try multiple possible content locations embedded on the post
        let extracted = data.content || data.quiz || data.flashcards || data.summary || data.lesson;
        
        // 2) If not embedded, try to follow sourceRef to user's library
        if (!extracted && (data.sourceRef || challenge.sourceRef)) {
          const src = (data.sourceRef || challenge.sourceRef) as { type: string; docId: string };
          const ownerId = data.ownerId || challenge.ownerId;
          
          // Handle various collection names including the new 'flashcard_sets'
          let collectionName = "summaries";
          if (src.type === "flashcards") collectionName = "flashcard_sets"; // New structure
          else if (src.type === "quiz") collectionName = "quizzes";
          else if (src.type === "lesson") collectionName = "lessons";
          else if (src.type === "summary") collectionName = "summaries";
          
          if (ownerId && src?.docId) {
            let srcRef = doc(db as any, "users", ownerId, collectionName, src.docId);
            let srcSnap = await getDoc(srcRef);
            
            // Fallback for flashcards: try legacy 'flashcards' collection if 'flashcard_sets' failed
            if (!srcSnap.exists() && src.type === "flashcards") {
               srcRef = doc(db as any, "users", ownerId, "flashcards", src.docId);
               srcSnap = await getDoc(srcRef);
            }

            if (srcSnap.exists()) {
              extracted = srcSnap.data();
              // --- NEW LOGIC FOR FLASHCARDS SUBCOLLECTION ---
              if (src.type === "flashcards") {
                
                // We need to fetch from the exact path where we found the set document
                // This handles both the primary 'flashcard_sets' path and the fallback 'flashcards' path
                const actualRef = srcSnap.ref;
                const flashcardsSubRef = collection(actualRef, "flashcards");
                
                const flashcardsSubSnap = await getDocs(flashcardsSubRef);
                const cards = flashcardsSubSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
                
                if (cards.length > 0) {
                  extracted = { ...extracted, flashcards: cards }; // Merge cards into the set object
                }
              }
              // --- END NEW LOGIC ---
              // --- NEW LOGIC FOR LESSONS (handle wrapped 'lesson' field) ---
              if (src.type === "lesson") {
                 console.log("📦 Processing lesson source:", extracted);
                 // Unwrapping strategy: if the wrapper has a 'lesson' object with sections, use it.
                 if (extracted.lesson && extracted.lesson.sections) {
                   console.log("📦 Unwrapped from .lesson property");
                   extracted = extracted.lesson;
                 } 
                 // Or if it has a 'content' object with sections (some formats), use it.
                 else if (extracted.content && extracted.content.sections) {
                   console.log("📦 Unwrapped from .content property");
                   extracted = extracted.content;
                 }
                 console.log("📦 Final extracted lesson:", extracted);
              }
              // --- END NEW LOGIC ---
            }
          }
        }
        
        // 3) Fallback to raw data
        let content = extracted || data;
        
        // Force unwrap lesson if needed, regardless of resolution method
        if (challenge.type === 'lesson') {
             // 1. Explicit .lesson wrapper
             if (content?.lesson && typeof content.lesson === 'object') {
                 console.log("📦 Unwrapping root .lesson property");
                 content = content.lesson;
             }
             // 2. Explicit .content wrapper
             else if (content?.content && typeof content.content === 'object') {
                 console.log("📦 Unwrapping root .content property");
                 content = content.content;
             }
             // 3. Fallback: if content is just a string but we expect an object, 
             // and maybe the actual data is in a sibling field like 'sections' or something else.
             // But actually, if content is a string, it's likely legacy HTML.
             // However, if we have sections at the top level of data but not in content,
             // we should check data again.
             else if (!content.sections && data?.lesson?.sections) {
                 content = data.lesson;
             }
        }
        
        setContent(content);
        
        // Detect if this is a short answer quiz
        if (challenge.type === 'quiz' && content?.questions) {
          const hasShortAnswer = content.questions.some((q: any) => 
            q.question_type === 'short_answer' || !q.options || Object.keys(q.options || {}).length === 0
          );
          setIsShortAnswer(hasShortAnswer);
        }

      } else {
        toast({
          title: "Content not found",
          description: "This challenge content could not be loaded.",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error("❌ Error loading content:", error);
      const errorMessage = error?.message || "Unknown error occurred";
      toast({
        title: "Error loading content",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadUserRunData = async () => {
    if (!challenge?.id || !userId) return;
    
    try {
      const runRef = doc(db as any, "feed_posts", challenge.id, "runs", userId);
      const runSnap = await getDoc(runRef);
      
      if (runSnap.exists()) {
        const data = runSnap.data();
        setAttempts((data.attempts || 0) + 1);
        setCurrentScore(data.score || null);
      } else {
        setAttempts(1);
      }
    } catch (error) {
      console.error("Error loading user run data:", error);
    }
  };

  const loadLeaderboard = () => {
    if (!challenge?.id) return;
    try {
      stopLeaderboardSubscription();
      const runsRef = collection(db as any, "feed_posts", challenge.id, "runs");
      const unsub = onSnapshot(runsRef as any, (snap: QuerySnapshot<DocumentData>) => {
        const userBestRuns = new Map<string, any>();
        snap.forEach((d: any) => {
          const data = d.data();
          // Include entries with a numeric score; completedAt might still be a server timestamp pending
          if (typeof data.score === 'number') {
            const uid = d.id;
            const currentRun = {
              userId: uid,
              username: data.username || "Anonymous",
              userPhotoURL: data.userPhotoURL || null,
              score: data.score,
              attempts: data.attempts || 1,
              completedAt: data.completedAt,
              joinedAt: data.joinedAt,
              masteredCards: data.masteredCards || 0,
            };
            const existing = userBestRuns.get(uid);
            if (!existing) {
              userBestRuns.set(uid, currentRun);
            } else {
              let isBetter = false;
              if (challenge.type === 'flashcards') {
                isBetter = currentRun.masteredCards > existing.masteredCards ||
                  (currentRun.masteredCards === existing.masteredCards && (currentRun.completedAt?.seconds || Infinity) < (existing.completedAt?.seconds || Infinity));
              } else {
                isBetter = currentRun.score > existing.score ||
                  (currentRun.score === existing.score && currentRun.attempts < existing.attempts) ||
                  (currentRun.score === existing.score && currentRun.attempts === existing.attempts && (currentRun.completedAt?.seconds || Infinity) < (existing.completedAt?.seconds || Infinity));
              }
              if (isBetter) userBestRuns.set(uid, currentRun);
            }
          }
        });
        const sortedRuns = Array.from(userBestRuns.values()).sort((a, b) => {
          if (challenge.type === 'flashcards') {
            if (b.masteredCards !== a.masteredCards) return b.masteredCards - a.masteredCards;
            return (a.completedAt?.seconds || Infinity) - (b.completedAt?.seconds || Infinity);
          } else {
            if (b.score !== a.score) return b.score - a.score;
            if (a.attempts !== b.attempts) return a.attempts - b.attempts;
            return (a.completedAt?.seconds || Infinity) - (b.completedAt?.seconds || Infinity);
          }
        });
        setLeaderboardData(sortedRuns);
      });
      runsUnsubRef.current = unsub;
    } catch (error) {
      console.error('Error subscribing to leaderboard:', error);
    }
  };

  const updateScore = async (score: number, masteredCardsCount?: number) => {
    
    if (!challenge?.id || !userId) {
      return;
    }
    
    try {
      const runRef = doc(db as any, "feed_posts", challenge.id, "runs", userId);
      
      // First, check if there's an existing run to compare against
      const existingRunSnap = await getDoc(runRef);
      let shouldUpdate = true;
      let bestAttempts = attempts;
      
      if (existingRunSnap.exists()) {
        const existingData = existingRunSnap.data();
        
        if (challenge.type === "flashcards") {
          // For flashcards: update ONLY if more cards mastered
          // We ignore attempts for ranking, and we preserve the earlier completedAt if mastered count is same
          const existingMastered = existingData.masteredCards || 0;
          shouldUpdate = (masteredCardsCount || 0) > existingMastered;
          
          // If not updating score, we keep existing best attempts
          bestAttempts = existingData.attempts || 1;
        } else {
          // For quizzes: update if higher score, or same score but fewer attempts
          const existingScore = existingData.score || 0;
          
          shouldUpdate = score > existingScore || 
                        (score === existingScore && attempts < (existingData.attempts || 1));
          
          // Keep the best attempt count for the same score
          if (score === existingScore) {
            bestAttempts = Math.min(attempts, existingData.attempts || 1);
          }
        }
      }
      
      // Only update if this is actually a better result
      if (shouldUpdate) {
        const updateData: any = {
          score,
          completedAt: serverTimestamp(),
          attempts: bestAttempts,
          username: username || "Anonymous",
          userPhotoURL: auth.currentUser?.photoURL || null,
          joinedAt: existingRunSnap.exists() ? existingRunSnap.data()?.joinedAt : serverTimestamp()
        };
        
        // For flashcards, also track mastered cards count
        if (challenge.type === "flashcards" && masteredCardsCount !== undefined) {
          updateData.masteredCards = masteredCardsCount;
        }
        
        await setDoc(runRef as any, updateData, { merge: true });
        
        // If this is the user's first completion, increment participantCount
        if (!existingRunSnap.exists()) {
          try {
            const postRef = doc(db as any, "feed_posts", challenge.id);
            await updateDoc(postRef as any, {
              participantCount: increment(1),
              lastActivityAt: serverTimestamp()
            } as any);
          } catch (participantError) {
            console.error("Error updating participantCount:", participantError);
            // Don't fail the whole operation if this fails
          }
        }
      }
      
      setCurrentScore(score);
      
      // Call the callback to update parent component
      onScoreUpdate?.(score, attempts);

      // Optimistically update local leaderboard so the user sees their result immediately
      setLeaderboardData(prev => {
        const run = {
          userId,
          username: username || "Anonymous",
          userPhotoURL: auth.currentUser?.photoURL || null,
          score,
          attempts,
          completedAt: { seconds: Math.floor(Date.now() / 1000) },
          joinedAt: null,
          masteredCards: challenge.type === 'flashcards' ? (masteredCardsCount || 0) : 0,
        } as any;
        // Keep only best per user
        const others = prev.filter(r => r.userId !== userId);
        // Insert and sort
        const merged = [...others, run].sort((a, b) => {
          if (challenge.type === 'flashcards') {
            if ((b.masteredCards || 0) !== (a.masteredCards || 0)) return (b.masteredCards || 0) - (a.masteredCards || 0);
            return (a.completedAt?.seconds || Infinity) - (b.completedAt?.seconds || Infinity);
          } else {
            if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
            if ((a.attempts || 0) !== (b.attempts || 0)) return (a.attempts || 0) - (b.attempts || 0);
            return (a.completedAt?.seconds || Infinity) - (b.completedAt?.seconds || Infinity);
          }
        });
        return merged;
      });
    } catch (error: any) {
      console.error("Error updating score:", error);
      toast({
        title: "Error saving score",
        description: error.message || "Could not save your score.",
        variant: "destructive"
      });
    }
  };

  const gradeShortAnswers = async () => {
    if (!content?.questions || grading) return false;
    const run = gradingRunRef.current;
    setGrading(true);
    try {
      const data = await gradeQuizAnswers(challenge?.title || 'Quiz Challenge', content.questions, answers, index => {
        const question = content.questions[index];
        const options = normalizeOptions(question);
        const correct = checkAnswer(answers[index], question, options);
        const expected = options.find((_, optionIndex) => checkAnswer(optionIndex, question, options));
        return {
          score: correct ? 100 : 0,
          feedback: correct ? 'Correct answer.' : 'Incorrect answer.',
          expectedAnswer: expected?.text || '',
        };
      });
      
      if (run !== gradingRunRef.current) return false;
      const items = data.items;
      const perScores = items.map(it => Number(it.score || 0));
      const perFeedbacks = items.map(it => String(it.feedback || ''));
      const perExpected = items.map(it => it.expectedAnswer);
      
      setShortScores(perScores);
      setShortFeedbacks(perFeedbacks);
      setExpectedAnswers(perExpected);
      
      // Calculate overall percentage
      const overall = Number(data.overall ?? Math.round(perScores.reduce((a,b) => a + b, 0) / Math.max(1, perScores.length)));
      
      // Update score in leaderboard
      await updateScore(overall);
      if (run !== gradingRunRef.current) return false;
      toast({
        title: 'Graded',
        description: `Overall score: ${overall}%`
      });
      return true;
    } catch (error: any) {
      if (run !== gradingRunRef.current) return false;
      console.error('Grading error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to grade answers',
        variant: 'destructive'
      });
      return false;
    } finally {
      if (run === gradingRunRef.current) setGrading(false);
    }
  };

  const saveToLibrary = async () => {
    if (!content || !challenge) return;
    
    setSaving(true);
    try {
      // Reset scores/progress when saving - user starts fresh with their own copy
      const contentToSave = {
        ...content,
        originalCreator: challenge.ownerUsername,
        savedFrom: "feed",
        savedAt: new Date().toISOString(),
        // Reset all score/progress fields so user starts fresh
        mastered_ids: [],
        mastered_count: 0,
        score: 0,
        attempts: 0,
        last_score: null,
        best_score: null,
        completed: false,
        completedAt: null,
      };

      onSaveToLibrary?.(contentToSave, challenge.ownerUsername || "Unknown");
      
      toast({
        title: "Saved to library",
        description: `${challenge.type} saved to your library with attribution to @${challenge.ownerUsername}`,
      });
    } catch (error) {
      toast({
        title: "Failed to save",
        description: "Could not save to your library.",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const renderQuizContent = () => {
    if (!content?.questions || content.questions.length === 0) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No quiz questions available</p>
        </div>
      );
    }
    
    if (showResults) {
      // Calculate score based on quiz type
      let score = 0;
      let correctAnswers = 0;
      
      if (isShortAnswer) {
        // For short answer, use the overall score from AI grading
        score = shortScores.length > 0 
          ? Math.round(shortScores.reduce((a, b) => a + b, 0) / shortScores.length)
          : 0;
      } else {
        // For multiple choice, use the fixed score calculation
        const mcResult = calculateQuizScore(answers, content.questions);
        score = mcResult.score;
        correctAnswers = mcResult.correctAnswers;
      }
      
      return (
        <ScrollArea className="h-[60vh]">
          <div className="space-y-6 pr-4">
            <div className="text-center">
              <h3 className="text-2xl font-bold mb-2">Quiz Complete!</h3>
              <div className="text-4xl font-bold text-primary mb-2">{score}%</div>
              {!isShortAnswer && (
                <p className="text-muted-foreground mb-4">
                  {correctAnswers} out of {content.questions.length} correct
                </p>
              )}
            </div>

            <div className="space-y-4">
              {content.questions.map((question: any, index: number) => {
                const userAnswer = answers[index];
                const questionOptions = normalizeOptions(question);
                
                // Determine if user is correct
                checkAnswer(userAnswer, question, questionOptions);
                
                // Find correct index for highlighting
                // We check which option makes checkAnswer true
                const correctIndex = questionOptions.findIndex((_, optIndex) => 
                  checkAnswer(optIndex, question, questionOptions)
                );
                
                return (
                  <Card key={index} className="p-4">
                    <h4 className="font-medium mb-3">{question.question}</h4>
                    
                    {isShortAnswerQuestion(question) ? (
                      // Short answer display
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-muted">
                          <p className="text-sm font-medium text-muted-foreground mb-1">Your Answer:</p>
                          <p className="text-sm">{userAnswer || 'No answer provided'}</p>
                        </div>
                        
                        {shortScores[index] !== undefined && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Score:</span>
                              <Badge variant={shortScores[index] >= 70 ? 'default' : shortScores[index] >= 50 ? 'secondary' : 'destructive'}>
                                {shortScores[index]}/100
                              </Badge>
                            </div>
                            
                            {shortFeedbacks[index] && (
                              <div className="p-3 rounded-lg bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                                <p className="text-sm whitespace-pre-wrap">{shortFeedbacks[index]}</p>
                              </div>
                            )}
                            
                            {expectedAnswers[index] && (
                              <div className="p-3 rounded-lg bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 border border-green-200 dark:border-green-800">
                                <p className="text-sm">
                                  <span className="font-medium">{getReferenceAnswer(question) ? 'Grading reference answer:' : 'Expected answer:'}</span>
                                  <br />
                                  <span>{expectedAnswers[index]}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      // Multiple choice display
                      <div className="space-y-2">
                        {questionOptions.map((option, optIndex) => {
                          const isUserChoice = optIndex === userAnswer;
                          const isCorrectChoice = optIndex === correctIndex;
                          
                          const base = 'p-3 rounded-lg border flex items-center justify-between';
                          let color = 'bg-muted text-muted-foreground border-border';
                          let icon = null as React.ReactNode | null;
                          
                          if (isCorrectChoice) {
                            color = 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-900/50';
                            icon = <span className="font-bold">✓</span>;
                          } else if (isUserChoice && !isCorrectChoice) {
                            color = 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-900/50';
                            icon = <span className="font-bold">✗</span>;
                          }
                          
                          return (
                            <div key={optIndex} className={`${base} ${color}`}>
                              <span className="break-words overflow-hidden flex-1 min-w-0">{option.text}</span>
                              {icon}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {!isShortAnswerQuestion(question) && question.explanation && (
                      <div className="mt-3 p-3 rounded-lg bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        <p className="text-sm">
                          <strong>Explanation:</strong> {question.explanation}
                        </p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            <div className="flex gap-3 pb-4">
              <Button
                onClick={() => {
                  setShowResults(false);
                  setCurrentQuestionIndex(0);
                  setAnswers([]);
                  setShortScores([]);
                  setShortFeedbacks([]);
                  setExpectedAnswers([]);
                }}
              >
                Retake Quiz
              </Button>
            </div>
          </div>
        </ScrollArea>
      );
    }
    
    const currentQuestion = content.questions[currentQuestionIndex];
    const selectedAnswer = answers[currentQuestionIndex];
    
    // Handle both array and object formats for options, and object items
    const optionsArray = normalizeOptions(currentQuestion);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Badge variant="outline">
            Question {currentQuestionIndex + 1} of {content.questions.length}
          </Badge>
          <Progress 
            value={(currentQuestionIndex / content.questions.length) * 100} 
            className="w-32"
            indicatorStyle={theme === 'dark' ? { backgroundColor: '#FEF8CA' } : undefined}
            style={theme !== 'dark' ? { backgroundColor: '#FEF8CA' } : undefined}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{currentQuestion.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isShortAnswerQuestion(currentQuestion) ? (
              <Textarea
                placeholder="Type your answer here..."
                value={typeof selectedAnswer === 'string' ? selectedAnswer : ''}
                onChange={(e) => {
                  const newAnswers = [...answers];
                  newAnswers[currentQuestionIndex] = e.target.value;
                  setAnswers(newAnswers);
                }}
                className="min-h-[120px]"
                disabled={grading}
              />
            ) : (
              optionsArray.map((option, index) => (
                <Button
                  key={index}
                  variant={selectedAnswer === index ? "default" : "outline"}
                  className="w-full justify-start text-left h-auto p-3 whitespace-normal break-words"
                  disabled={grading}
                  onClick={() => {
                    const newAnswers = [...answers];
                    newAnswers[currentQuestionIndex] = index;
                    setAnswers(newAnswers);
                  }}
                >
                  <span className="break-words overflow-hidden">{option.text}</span>
                </Button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            onClick={async () => {
              if (currentQuestionIndex < content.questions.length - 1) {
                setCurrentQuestionIndex(currentQuestionIndex + 1);
              } else {
                if (isShortAnswer) {
                  // Grade short answer questions with AI
                  if (await gradeShortAnswers()) setShowResults(true);
                } else {
                  // Calculate score for multiple choice
                  const { score, correctAnswers } = calculateQuizScore(answers, content.questions);
                  console.log("Quiz completed, using fixed score calculation:", {
                    correctAnswers,
                    totalQuestions: content.questions.length,
                    calculatedScore: score,
                    answers
                  });
                  updateScore(score);
                  setShowResults(true);
                }
              }
            }}
            disabled={grading || (isShortAnswerQuestion(currentQuestion) ? typeof selectedAnswer !== 'string' || !selectedAnswer.trim() : selectedAnswer === undefined)}
          >
            {currentQuestionIndex < content.questions.length - 1 ? (
              'Next Question'
            ) : grading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Grading...
              </>
            ) : (
              'Finish Quiz'
            )}
          </Button>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    console.log("🎨 Rendering content:", { loading, content, challengeType: challenge?.type });
    
    if (loading) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading content...</p>
        </div>
      );
    }

    if (!content) {
      return (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Content not available</p>
          <p className="text-xs text-muted-foreground mt-2">
            Challenge ID: {challenge?.id} | Type: {challenge?.type}
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-4"
            onClick={() => {
              console.log("🔄 Retrying content load...");
              loadContent();
            }}
          >
            Retry Loading
          </Button>
        </div>
      );
    }

    switch (challenge?.type) {
      case "summary":
        if (content) {
          // Render enhanced summary view
          return (
            <div className="space-y-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold">{content.title}</h3>
                    <div className="flex gap-2">
                      {content.summary_type && <Badge variant="secondary">{formatSummaryType(content.summary_type)}</Badge>}
                      {content.word_count && <Badge variant="outline">{content.word_count} words</Badge>}
                    </div>
                  </div>
                  
                  <div className="space-y-6">
                    {/* Show Original Text first in a collapsible */}
                    {content.original_text && (
                      <Collapsible>
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm" className="flex items-center gap-2 w-full justify-between">
                            <span className="font-semibold">Original Source Text</span>
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2">
                          <div className="max-h-60 overflow-y-auto p-4 bg-muted rounded-md text-xs text-muted-foreground whitespace-pre-wrap border">
                            {content.original_text}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Show the Summary */}
                    <div>
                      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Summary
                      </h4>
                      <div className="prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {normalizeForMath(String(content.summary_text || content.content || content))}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }
        return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content.summary || content.content || content) }} />;
      case "lesson":
        // Try to find lesson data if content is the wrapper or the raw object
        const lessonData = (content && content.sections) ? content : 
                           (content && content.lesson && content.lesson.sections) ? content.lesson :
                           (content && content.content && content.content.sections) ? content.content : null;

        if (lessonData && lessonData.sections) {
          // Render enhanced lesson view if structured data is available
          return (
            <div className="space-y-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-2xl font-bold">{lessonData.title}</h3>
                      <p className="text-muted-foreground">{lessonData.description}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="mb-2">{lessonData.duration}</Badge>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="capitalize">{lessonData.difficulty}</Badge>
                        <Badge variant="outline">{lessonData.audience}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                    <div className="p-3 border rounded-lg">
                      <div className="text-sm font-medium">Total Duration</div>
                      <div className="text-lg font-bold">{lessonData.duration}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-sm font-medium">Sections</div>
                      <div className="text-lg font-bold">{lessonData.sections?.length || 0}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-sm font-medium">Level</div>
                      <div className="text-lg font-bold capitalize">{lessonData.difficulty}</div>
                    </div>
                    <div className="p-3 border rounded-lg">
                      <div className="text-sm font-medium">Audience</div>
                      <div className="text-lg font-bold">{lessonData.audience}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {lessonData.sections.map((section: any, index: number) => (
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
                      <h4 className="font-semibold mb-2">Content Overview</h4>
                      <div className="prose dark:prose-invert max-w-none text-sm prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {normalizeForMath(section.content)}
                        </ReactMarkdown>
                      </div>
                    </div>
                    {section.examples && section.examples.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-3">Examples</h4>
                        <div className="space-y-3">
                          {section.examples.map((example: any, exIdx: number) => (
                            <div key={exIdx} className="p-4 border rounded-lg">
                              <div className="font-medium mb-2">Example {exIdx + 1}:</div>
                              <div className="bg-muted p-3 rounded mb-2 text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(example.problem)}
                                </ReactMarkdown>
                              </div>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => toggleSolution(`example-${index}-${exIdx}`)}
                              >
                                {revealedSolutions.has(`example-${index}-${exIdx}`) ? 'Hide Solution' : 'Show Solution'}
                              </Button>
                              {revealedSolutions.has(`example-${index}-${exIdx}`) && (
                                <div className="mt-3 space-y-2">
                                  <div className="p-3 bg-muted rounded border">
                                    <div className="font-medium text-sm mb-1">Solution:</div>
                                    <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                        {normalizeForMath(example.solution)}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                  {example.explanation && (
                                    <div className="p-3 bg-muted rounded border">
                                      <div className="font-medium text-sm mb-1">Explanation:</div>
                                      <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
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
                  </CardContent>
                </Card>
              ))}

              {/* Flashcards embedded in lesson */}
              {lessonData.flashcards && lessonData.flashcards.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Lightbulb className="w-5 h-5" />
                      Flashcards
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {lessonData.flashcards.map((flashcard: any, index: number) => (
                        <div key={index} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
                          <div className="font-medium mb-2">Card {index + 1}</div>
                          <div className="space-y-2">
                            <div className="p-3 bg-muted rounded border">
                              <div className="text-sm font-semibold">Front:</div>
                              <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(String(flashcard.front || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                            <div className="p-3 bg-muted rounded border">
                              <div className="text-sm font-semibold">Back:</div>
                              <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(String(flashcard.back || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quiz embedded in lesson */}
              {lessonData.quiz && lessonData.quiz.questions && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5" />
                      Quiz
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {lessonData.quiz.questions.map((question: any, index: number) => (
                      <div key={index} className="p-4 border rounded-lg">
                        <div className="font-medium mb-3">
                          Question {index + 1}:{' '}
                          <span className="prose dark:prose-invert max-w-none inline prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                              {normalizeForMath(String(question.question || ''))}
                            </ReactMarkdown>
                          </span>
                        </div>
                        {question.options && (
                          <div className="space-y-2 mb-3">
                            {question.options.map((option: string, optIndex: number) => (
                              <div key={optIndex} className="flex items-center gap-2 p-2 border rounded">
                                <div className="w-6 h-6 rounded-full border flex items-center justify-center text-sm">
                                  {String.fromCharCode(65 + optIndex)}
                                </div>
                                <span className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {normalizeForMath(String(option || ''))}
                                  </ReactMarkdown>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => toggleSolution(`quiz-${index}`)}
                        >
                          {revealedSolutions.has(`quiz-${index}`) ? 'Hide Answer' : 'Show Answer'}
                        </Button>
                        {revealedSolutions.has(`quiz-${index}`) && (
                          <div className="mt-3 space-y-2">
                            <div className="p-3 bg-muted rounded border">
                              <div className="font-medium text-sm mb-1">Correct Answer:</div>
                              <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {normalizeForMath(String(question.answer || ''))}
                                </ReactMarkdown>
                              </div>
                            </div>
                            {question.explanation && (
                              <div className="p-3 bg-muted rounded border">
                                <div className="font-medium text-sm mb-1">Explanation:</div>
                                <div className="text-sm prose dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {normalizeForMath(String(question.explanation || ''))}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          );
        }
        // Fallback for legacy lessons
        const htmlContent = typeof content === 'string' ? content : (content.lesson || content.content || '');
        if (typeof htmlContent === 'string') {
             return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(htmlContent) }} />;
        }
        return <div className="p-4 text-muted-foreground">Unable to display lesson content.</div>;
      case "quiz":
        return renderQuizContent();
      case "flashcards":
        // Force flashcard rendering for flashcards type
        // We will aggressively try to find any array data and treat it as cards
        
        // 1. Try content.flashcards (standard)
        let foundCards = Array.isArray(content.flashcards) ? content.flashcards : [];
        
        // 2. Try content.questions (legacy/cross-saved)
        if (foundCards.length === 0 && Array.isArray(content.questions)) {
          foundCards = content.questions;
        }
        
        // 3. Try content itself if it is an array
        if (foundCards.length === 0 && Array.isArray(content)) {
          foundCards = content;
        }

        // Transform whatever we found into the format expected by FlashcardViewer {id, question, answer}
        // This normalization step is key - we map any property names to question/answer
        if (foundCards.length > 0) {
           const formattedCards = foundCards.map((c: any, i: number) => ({
             id: c.id || String(i),
             // Check all possible question fields: front, question, etc.
             question: c.question || c.front || c.q || "No question",
             // Check all possible answer fields: back, answer, options[0], etc.
             // If options exists and is array, take first element as answer (common for 1-option "quiz" style flashcards)
             answer: c.answer || c.back || c.a || (Array.isArray(c.options) ? c.options[0] : "No answer")
           }));
           
           // Store formattedCards in a ref so footer can access them
           const toggleMasteredHandler = (id: string, next: boolean) => {
             const nextMastered = new Set(masteredCards);
             if (next) nextMastered.add(id);
             else nextMastered.delete(id);
             setMasteredCards(nextMastered);
             const count = nextMastered.size;
             const score = Math.round((count / formattedCards.length) * 100);
             updateScore(score, count);
           };
           
           return (
             <div className="flex flex-col items-center justify-center w-full">
               <FlashcardViewer 
                 cards={formattedCards}
                 mastered={Array.from(masteredCards).reduce((acc, id) => ({...acc, [id]: true}), {})}
                 onToggleMastered={toggleMasteredHandler}
                 onScored={(_points) => {}}
                 hideControls={true}
                 onStateChange={(state) => setFlashcardState(state)}
               />
             </div>
           );
        }
        
        // Fallback if absolutely no data found
        return (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No flashcards found in this content.</p>
          </div>
        ); 
      default:
        return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content.content || content || "No content available") }} />;
    }
  };

  const getIcon = (type: string | undefined | null) => {
    switch (type) {
      case "quiz": return <Brain className="h-5 w-5" />;
      case "flashcards": return <Lightbulb className="h-5 w-5" />;
      case "summary": return <BookOpen className="h-5 w-5" />;
      case "lesson": return <BookOpen className="h-5 w-5" />;
      default: return <BookOpen className="h-5 w-5" />;
    }
  };

  const showSaveButton = challenge && !challenge.isOwner && content;
  // Safely check type for null/undefined before accessing property
  // Ensure challenge is truthy before accessing type.
  // Leaderboard only for quizzes
  const showLeaderboard = challenge && challenge.type === "quiz";

  // Use effects to detect clicks outside if Dialog doesn't handle it automatically, 
  // but Shadcn Dialog typically handles outside clicks via onOpenChange(false).
  // The requirement is: "click out of it... close the quiz and not save it as completed"
  
  // The current implementation of onClose just closes the dialog. 
  // Saving only happens if updateScore is called explicitly (e.g. on finish).
  // However, we need to ensure that closing doesn't trigger any "finish" logic.
  // Currently, updateScore is called in renderQuizContent's 'Finish Quiz' button
  // or FlashcardViewer's onScored callback.
  
  // If the user clicks out, onOpenChange(false) -> onClose() is called.
  // We just need to make sure we don't trigger updateScore in the cleanup effect.
  // There is no cleanup effect that saves score, so this should already be the behavior.
  
  // But let's double check if there are any auto-save mechanisms.
  // There are none in the unmount effect.
  
  // Wait, the user might mean they want to be able to exit without it counting as a "completed run" with 0 score.
  // The run is created when they JOIN.
  // If they close without finishing, the run remains "joined" but score is null/incomplete.
  // This is correct behavior.
  
  // However, perhaps they want to ensure the dialog closes cleanly.
  // Let's verify the onClose prop usage.
  
  const getChallengeLabel = () => {
    return challenge?.type || 'challenge';
  };

  const challengeLabel = getChallengeLabel();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col mx-auto">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {challenge && getIcon(challenge.type)}
            <span className="capitalize text-sm sm:text-base truncate max-w-[200px] sm:max-w-none">
              {challenge?.title || "Challenge"}
            </span>
            {challenge?.ownerUsername && (
              <Badge variant="outline" className="text-xs sm:ml-auto">
                by @{challenge.ownerUsername}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
             Complete the {challengeLabel} to earn points and appear on the leaderboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="pr-4 pb-4">
            {renderContent()}
          </div>
        </div>

        <div className="flex-shrink-0 pt-4 border-t space-y-2">
          {/* Flashcard navigation controls in footer */}
          {challenge?.type === "flashcards" && flashcardState && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('flashcard-prev'));
                  }}
                  className="flex-1 sm:flex-none"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                  <span className="hidden sm:inline ml-1">Previous</span>
                </Button>
                
                <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                  <span className="font-medium">
                    {flashcardState.currentIndex + 1}/{flashcardState.totalCards}
                  </span>
                  <span className="text-muted-foreground hidden sm:inline">
                    Mastered: {flashcardState.masteredCount}/{flashcardState.totalCards}
                  </span>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('flashcard-next'));
                  }}
                  className="flex-1 sm:flex-none"
                >
                  <span className="hidden sm:inline mr-1">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              
              <Button
                variant={flashcardState.isCurrentMastered ? "default" : "outline"}
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => {
                  const nextMastered = new Set(masteredCards);
                  if (flashcardState.isCurrentMastered) {
                    nextMastered.delete(flashcardState.currentCardId);
                  } else {
                    nextMastered.add(flashcardState.currentCardId);
                  }
                  setMasteredCards(nextMastered);
                  const score = Math.round((nextMastered.size / flashcardState.totalCards) * 100);
                  updateScore(score, nextMastered.size);
                }}
              >
                {flashcardState.isCurrentMastered ? "Unmark" : "Mark Mastered"}
              </Button>
            </div>
          )}
          
          {/* Save and leaderboard buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-4">
              {currentScore !== null && (
                <Badge variant="secondary" className="text-xs sm:text-sm">
                  Best: {currentScore}%
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {showSaveButton && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveToLibrary}
                  disabled={saving}
                  className="flex-1 sm:flex-none"
                >
                  <Save className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">{saving ? <><Loader2 className="inline w-3 h-3 mr-1 animate-spin" />Saving...</> : "Save to Library"}</span>
                </Button>
              )}

              {showLeaderboard && (
                <Button 
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none"
                  onClick={() => {
                    loadLeaderboard();
                    setShowLeaderboardDialog(true);
                  }}
                >
                  <Trophy className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Leaderboard</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Leaderboard Dialog */}
        <Dialog open={showLeaderboardDialog} onOpenChange={setShowLeaderboardDialog}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Trophy className="h-4 w-4 sm:h-5 sm:w-5" />
                Leaderboard
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm truncate">
                {challenge?.title}
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex-1 overflow-y-auto space-y-2">
              {leaderboardData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No completions yet</p>
                  <p className="text-sm">Be the first to complete this challenge!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leaderboardData.slice(0, 10).map((run, index) => (
                    <div
                      key={run.userId}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        run.userId === userId ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-800' :
                          index === 1 ? 'bg-gray-100 text-gray-800' :
                          index === 2 ? 'bg-orange-100 text-orange-800' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {index + 1}
                        </div>
                        {run.userPhotoURL ? (
                          <img 
                            src={run.userPhotoURL} 
                            alt={run.username}
                            className="w-10 h-10 rounded-full object-cover border-2 border-background"
                            onError={(e) => {
                              // Fallback to initials if image fails to load
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              if (target.nextElementSibling) {
                                (target.nextElementSibling as HTMLElement).style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div 
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-primary/10 text-primary border-2 border-background ${
                            run.userPhotoURL ? 'hidden' : ''
                          }`}
                        >
                          {run.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-sm">
                            {run.username}
                            {run.userId === userId && (
                              <span className="text-primary ml-1">(You)</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm">
                          {challenge?.type === "flashcards" ? 
                            `${run.masteredCards} cards` : 
                            `${run.score}%`
                          }
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {challenge?.type !== "flashcards" && (
                            <>{run.attempts} attempt{run.attempts !== 1 ? 's' : ''}</>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
};
