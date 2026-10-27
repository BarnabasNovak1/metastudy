import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

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

    const looksLikeFormula = /\=/.test(candidate) && /[0-9()[\]\/\*%+-]/.test(candidate);
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

interface FlashcardData {
  id: string;
  question: string;
  answer: string;
}

interface FlashcardViewerProps {
  cards: FlashcardData[];
  mastered?: Record<string, boolean>;
  onToggleMastered?: (id: string, next: boolean) => void;
  onReviewed?: () => void;
  onScored?: (points: number) => void;
  hideControls?: boolean;
  onStateChange?: (state: { currentIndex: number; totalCards: number; masteredCount: number; currentCardId: string; isCurrentMastered: boolean }) => void;
  externalNavigation?: { goNext: () => void; goPrev: () => void } | null;
}

export const FlashcardViewer = ({ cards, mastered = {}, onToggleMastered, onReviewed, onScored, hideControls = false, onStateChange }: FlashcardViewerProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [filterMode, setFilterMode] = useState<'all'|'unmastered'>('all');
  const [feedback, setFeedback] = useState<null | 'correct' | 'wrong'>(null);
  const [hint, setHint] = useState<string>("");
  const advanceTimerRef = useRef<number | null>(null);

  const safeCards = cards || [];
  const viewCards = filterMode === 'all' ? safeCards : safeCards.filter(c => !mastered[c.id]);
  const masteredCount = safeCards.reduce((acc, c) => acc + (mastered[c.id] ? 1 : 0), 0);
  const currentCard = viewCards[currentIndex] || viewCards[0] || safeCards[0];

  // When filter or inputs change, keep the same card if possible
  // Find current ID in the new view and adjust index
  const currentId = (viewCards[currentIndex]?.id) || (currentCard?.id);
  const remapIndex = () => {
    if (!currentId) { setCurrentIndex(0); return; }
    const idx = viewCards.findIndex(c => c.id === currentId);
    setCurrentIndex(idx >= 0 ? idx : 0);
  };

  const handleNext = () => {
    setIsFlipped(false);
    const len = viewCards.length || 1;
    setCurrentIndex((prev) => (prev + 1) % len);
    onReviewed && onReviewed();
    setAnswerText("");
    setChecked(null);
    setFeedback(null);
    setHint("");
  };

  const handlePrevious = () => {
    setIsFlipped(false);
    const len = viewCards.length || 1;
    setCurrentIndex((prev) => (prev - 1 + len) % len);
    onReviewed && onReviewed();
    setAnswerText("");
    setChecked(null);
  };

  // Report state changes to parent for external controls
  useEffect(() => {
    if (onStateChange && currentCard) {
      onStateChange({
        currentIndex,
        totalCards: viewCards.length,
        masteredCount,
        currentCardId: currentCard.id,
        isCurrentMastered: !!mastered[currentCard.id]
      });
    }
  }, [currentIndex, viewCards.length, masteredCount, currentCard?.id, mastered, onStateChange]);

  // Listen for external navigation events
  useEffect(() => {
    const handleNext = () => {
      setIsFlipped(false);
      const len = viewCards.length || 1;
      setCurrentIndex((prev) => (prev + 1) % len);
      onReviewed && onReviewed();
      setAnswerText("");
      setChecked(null);
      setFeedback(null);
      setHint("");
    };
    const handlePrev = () => {
      setIsFlipped(false);
      const len = viewCards.length || 1;
      setCurrentIndex((prev) => (prev - 1 + len) % len);
      onReviewed && onReviewed();
      setAnswerText("");
      setChecked(null);
    };
    
    window.addEventListener('flashcard-next', handleNext);
    window.addEventListener('flashcard-prev', handlePrev);
    return () => {
      window.removeEventListener('flashcard-next', handleNext);
      window.removeEventListener('flashcard-prev', handlePrev);
    };
  }, [viewCards.length, onReviewed]);

  if (safeCards.length === 0) {
    return (
      <Card className="p-8">
        <CardContent className="text-center text-muted-foreground">
          No flashcards available
        </CardContent>
      </Card>
    );
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const lev = (a: string, b: string) => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 1) return 2;
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

  const checkAnswer = () => {
    const ok = approxEqual(answerText, currentCard.answer);
    setChecked(ok);
    if (ok && practiceMode) {
      try { onScored && onScored(1); } catch {}
      // Auto-mark mastered if not already marked
      try {
        if (onToggleMastered && !mastered[currentCard.id]) {
          onToggleMastered(currentCard.id, true);
        }
      } catch {}
    }
    // Build hint on incorrect
    if (!ok) {
      try {
        const ans = String(currentCard.answer || "");
        const words = ans.trim().split(/\s+/).filter(Boolean);
        const first = words[0] || ans.charAt(0) || '';
        const masked = first ? `${first[0]}${first.length>1?first.slice(1,2):''}${first.length>2?'…':''}` : '';
        const extra = words.length > 1 ? `${words.length} words` : `${ans.replace(/\s+/g,'').length} chars`;
        setHint(`Hint: starts with "${masked}" • ${extra}`);
      } catch { setHint(""); }
    }
    if (ok) {
      setFeedback('correct');
      // Auto-advance after ~1s only when correct
      try {
        if (advanceTimerRef.current) { window.clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
        advanceTimerRef.current = window.setTimeout(() => { handleNext(); }, 1000);
      } catch {}
    } else {
      setFeedback('wrong');
      // Do not auto-advance on incorrect; stay on the card for another attempt
      try {
        if (advanceTimerRef.current) { window.clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
      } catch {}
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto px-3 md:px-0">
          {/* Filter controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant={filterMode === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setFilterMode('all'); setTimeout(remapIndex, 0); }}
              >
                Show: All
              </Button>
              <Button
                variant={filterMode === 'unmastered' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setFilterMode('unmastered'); setTimeout(remapIndex, 0); }}
              >
                Show: Only Unmastered
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {masteredCount} mastered • {cards.length - masteredCount} unmastered • {cards.length} total
            </div>
          </div>

          {viewCards.length === 0 && (
            <Card className="p-8">
              <CardContent className="text-center text-muted-foreground">
                All cards are mastered. Switch to "Show: All" to review everything.
              </CardContent>
            </Card>
          )}

          <div 
            className="perspective-1000 cursor-pointer"
            onClick={() => setIsFlipped(!isFlipped)}
          >
            <div 
              className={`relative w-full h-[280px] transition-all duration-500 transform-style-3d ${
                isFlipped ? 'rotate-y-180' : ''
              }`}
              style={{
                transformStyle: 'preserve-3d',
                transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0)',
              }}
            >
              {/* Front of card */}
              <Card 
                className={`absolute inset-0 backface-hidden flex items-center justify-center p-8 transition-shadow duration-300 ${feedback==='correct' ? 'border-2 border-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.35)]' : feedback==='wrong' ? 'border-2 border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.35)]' : ''}`}
                style={{ backfaceVisibility: 'hidden' }}
              >
                <CardContent className="text-center space-y-6">
                  <div className="inline-flex items-center gap-2 bg-primary/10 rounded-full px-4 py-2 border border-primary/20">
                    <span className="text-sm font-medium text-primary">Question</span>
                  </div>
                  <div className="text-2xl md:text-3xl font-semibold break-words prose prose-lg max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {normalizeForMath(currentCard.question)}
                    </ReactMarkdown>
                  </div>
                  {!practiceMode && (
                    <p className="text-sm text-muted-foreground">Click to reveal answer</p>
                  )}
                  {practiceMode && (
                    <div className="space-y-2 max-w-md mx-auto" onClick={(e)=> e.stopPropagation()} onMouseDown={(e)=> e.stopPropagation()}>
                      <Input
                        value={answerText}
                        onChange={(e)=>{ setAnswerText(e.target.value); setChecked(null); }}
                        placeholder="Type your answer"
                        onKeyDown={(e)=>{ if (e.key==='Enter') { e.preventDefault(); checkAnswer(); } }}
                        onClick={(e)=> e.stopPropagation()}
                        onMouseDown={(e)=> e.stopPropagation()}
                      />
                      {checked === false && hint && (
                        <div className="text-xs text-muted-foreground">{hint}</div>
                      )}
                      <div className="flex items-center justify-center gap-2">
                        <Button size="sm" onClick={(e)=>{ e.stopPropagation(); checkAnswer(); }}>Check</Button>
                        {checked !== null && (
                          <span className={`text-sm ${checked ? 'text-green-600' : 'text-red-600'}`}>
                            {checked ? 'Correct' : 'Try again'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Back of card */}
              <Card 
                className="absolute inset-0 backface-hidden flex items-center justify-center p-8"
                style={{ 
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)'
                }}
              >
                <CardContent className="text-center space-y-6">
                  <div className="inline-flex items-center gap-2 bg-secondary/10 rounded-full px-4 py-2 border border-secondary/20">
                    <span className="text-sm font-medium text-secondary">Answer</span>
                  </div>
                  <div className="text-lg md:text-xl leading-relaxed break-words prose prose-lg max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {normalizeForMath(currentCard.answer)}
                    </ReactMarkdown>
                  </div>
                  <p className="text-sm text-muted-foreground">Click to see question</p>
                </CardContent>
              </Card>
            </div>
          </div>

      {!hideControls && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={handlePrevious}
            className="shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
            Previous
          </Button>

          <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto justify-center">
            <span className="text-sm font-medium whitespace-nowrap">
              {Math.min(currentIndex + 1, Math.max(1, viewCards.length))} / {Math.max(1, viewCards.length)}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Mastered: {masteredCount} / {cards.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFlipped(!isFlipped)}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button
              variant={practiceMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setPracticeMode(!practiceMode); setAnswerText(""); setChecked(null); }}
            >
              {practiceMode ? 'Practice: On' : 'Practice: Off'}
            </Button>
            {onToggleMastered && (
              <Button
                variant={mastered[currentCard.id] ? "default" : "outline"}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  try { onToggleMastered(currentCard.id, !mastered[currentCard.id]); } catch {}
                  if (practiceMode) { try { onScored && onScored(0.5); } catch {} }
                }}
              >
                {mastered[currentCard.id] ? "Unmark Mastered" : "Mark Mastered"}
              </Button>
            )}
          </div>

          <Button
            variant="outline"
            size="lg"
            onClick={handleNext}
            className="shrink-0"
          >
            Next
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      )}
    </div>
  );
};
