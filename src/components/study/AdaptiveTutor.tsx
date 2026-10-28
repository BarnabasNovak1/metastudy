import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../../../firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  BrainCircuit, BookOpen, CheckCircle2, ChevronRight, CircleAlert, FileText,
  Loader2, Plus, RotateCcw, Target, Trash2, XCircle, MinusCircle,
} from "lucide-react";
import {
  tutorApi, type ConceptMastery, type LearningObjective, type TutorDifficulty,
  type TutorEvaluation, type TutorQuestion, type TutorSessionListItem,
} from "@/lib/tutor";

interface AdaptiveTutorProps { userId: string }

type View = 'list' | 'setup' | 'question' | 'feedback' | 'summary';

interface SavedDoc { id: string; title: string; kind: 'summary' | 'lesson' }

const MASTERY_META: Record<ConceptMastery['status'], { label: string; cls: string }> = {
  untested: { label: 'Untested', cls: 'text-muted-foreground' },
  needs_review: { label: 'Needs review', cls: 'text-red-500' },
  developing: { label: 'Developing', cls: 'text-amber-600 dark:text-amber-400' },
  demonstrated: { label: 'Understood', cls: 'text-green-600 dark:text-green-400' },
};

const VERDICT_META = {
  correct: { label: 'Correct', icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400' },
  partial: { label: 'Partially correct', icon: MinusCircle, cls: 'text-amber-600 dark:text-amber-400' },
  incorrect: { label: 'Not quite', icon: XCircle, cls: 'text-red-500' },
  ambiguous: { label: 'Needs clarification', icon: CircleAlert, cls: 'text-amber-600 dark:text-amber-400' },
} as const;

export const AdaptiveTutor = ({ userId }: AdaptiveTutorProps) => {
  const { toast } = useToast();
  const [view, setView] = useState<View>('list');
  const [loading, setLoading] = useState(false);

  // list
  const [sessions, setSessions] = useState<TutorSessionListItem[]>([]);

  // setup
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [sourceText, setSourceText] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<TutorDifficulty>('medium');
  const [sessionLength, setSessionLength] = useState('5');

  // active session
  const [sessionId, setSessionId] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [objectives, setObjectives] = useState<LearningObjective[]>([]);
  const [question, setQuestion] = useState<TutorQuestion | null>(null);
  const [evaluation, setEvaluation] = useState<TutorEvaluation | null>(null);
  const [mastery, setMastery] = useState<ConceptMastery[]>([]);
  const [position, setPosition] = useState({ answered: 0, total: 5 });
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState('');

  const loadSessions = async () => {
    try {
      const { sessions } = await tutorApi.listSessions();
      setSessions(sessions);
    } catch (e: any) {
      toast({ title: 'Could not load sessions', description: e?.message, variant: 'destructive' });
    }
  };

  const loadSavedDocs = async () => {
    try {
      const [sumSnap, lesSnap] = await Promise.all([
        getDocs(query(collection(db, 'users', userId, 'summaries'), orderBy('created_at', 'desc'), limit(30))),
        getDocs(query(collection(db, 'users', userId, 'lessons'), orderBy('created_at', 'desc'), limit(30))),
      ]);
      const docs: SavedDoc[] = [
        ...sumSnap.docs.filter((d) => (d.data() as any).summary_type !== 'transcript')
          .map((d) => ({ id: d.id, title: String((d.data() as any).title || 'Untitled'), kind: 'summary' as const })),
        ...lesSnap.docs.map((d) => ({ id: d.id, title: String((d.data() as any).title || 'Untitled lesson'), kind: 'lesson' as const })),
      ];
      setSavedDocs(docs);
    } catch {}
  };

  useEffect(() => {
    if (!userId) return;
    loadSessions();
    loadSavedDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Cross-tool handoff ("Create from..." -> Practice with Tutor): seed the
  // setup form with the source title + text and open it.
  useEffect(() => {
    const onCross = (e: CustomEvent) => {
      const d = e?.detail;
      if (String(d?.type || '').toLowerCase() !== 'tutor') return;
      const text = String(d?.payload?.text || '');
      const title = String(d?.payload?.meta?.title || '');
      if (text) setSourceText(text);
      if (title && !topic) setTopic(title);
      setView('setup');
    };
    window.addEventListener('study-cross-action', onCross as EventListener);
    return () => window.removeEventListener('study-cross-action', onCross as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canStart = useMemo(
    () => topic.trim().length >= 3 && (sourceText.trim().length > 0 || selectedDocs.size > 0),
    [topic, sourceText, selectedDocs],
  );

  const beginSession = (data: { sessionId: string; title: string; objectives: LearningObjective[]; question: TutorQuestion; position: { answered: number; total: number } }) => {
    setSessionId(data.sessionId);
    setSessionTitle(data.title);
    setObjectives(data.objectives);
    setQuestion(data.question);
    setPosition(data.position);
    setEvaluation(null);
    setMastery([]);
    setAnswer('');
    setSelectedOption('');
    setView('question');
  };

  const startSession = async () => {
    if (!canStart || loading) return;
    setLoading(true);
    try {
      const data = await tutorApi.createSession({
        topic: topic.trim(),
        difficulty,
        sessionLength: Number(sessionLength),
        text: sourceText.trim() || undefined,
        documentIds: savedDocs.filter((d) => d.kind === 'summary' && selectedDocs.has(d.id)).map((d) => d.id),
        lessonIds: savedDocs.filter((d) => d.kind === 'lesson' && selectedDocs.has(d.id)).map((d) => d.id),
      });
      beginSession(data);
    } catch (e: any) {
      toast({ title: 'Could not start session', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const resumeSession = async (id: string) => {
    setLoading(true);
    try {
      const s = await tutorApi.getSession(id);
      setSessionId(s.sessionId);
      setSessionTitle(s.title);
      setObjectives(s.objectives);
      setMastery(s.mastery);
      setPosition(s.position);
      setEvaluation(null);
      setAnswer('');
      setSelectedOption('');
      if (s.status === 'active' && s.question) {
        setQuestion(s.question);
        setView('question');
      } else {
        setView('summary');
      }
    } catch (e: any) {
      toast({ title: 'Could not resume', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async () => {
    const finalAnswer = question?.type === 'mcq' ? selectedOption : answer.trim();
    if (!question || !finalAnswer || loading) return;
    setLoading(true);
    try {
      const res = await tutorApi.submitAnswer(sessionId, question.id, finalAnswer);
      setEvaluation(res.evaluation);
      setMastery(res.mastery);
      setPosition(res.position);
      if (res.completed) {
        setQuestion(null);
        setView('summary');
      } else {
        setQuestion(res.nextQuestion);
        setView('feedback');
      }
    } catch (e: any) {
      toast({ title: 'Could not evaluate', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const finishEarly = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await tutorApi.finishSession(sessionId);
      setMastery(res.mastery);
      setView('summary');
    } catch (e: any) {
      toast({ title: 'Could not finish', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const startReview = async (fromSessionId: string) => {
    setLoading(true);
    try {
      const data = await tutorApi.createReview(fromSessionId);
      beginSession(data);
    } catch (e: any) {
      toast({ title: 'Could not start review', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await tutorApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      toast({ title: 'Could not delete', description: e?.message, variant: 'destructive' });
    }
  };

  const goNext = () => {
    setEvaluation(null);
    setAnswer('');
    setSelectedOption('');
    setView('question');
  };

  const progressPct = position.total > 0 ? Math.round((position.answered / position.total) * 100) : 0;

  // ---------- LIST ----------
  if (view === 'list') {
    return (
      <div className="space-y-6">
        <Card className="border-2 border-foreground hard-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5" />
              Adaptive Tutor
            </CardTitle>
            <CardDescription>
              A diagnostic session that adapts each question to what you actually understand. Uses your own study material as the source of truth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setView('setup')} className="border-2 border-foreground" data-tour="tutor-new">
              <Plus className="w-4 h-4 mr-2" />
              New tutor session
            </Button>
          </CardContent>
        </Card>

        {sessions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your sessions</h3>
            {sessions.map((s) => (
              <Card key={s.id} className="border-2 border-foreground">
                <CardContent className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.answersCount}/{s.sessionLength} answered
                      {s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <Badge variant={s.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{s.status}</Badge>
                  <Button size="sm" variant="outline" className="border-2 border-foreground" disabled={loading} onClick={() => resumeSession(s.id)}>
                    {s.status === 'active' ? 'Resume' : 'Results'}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteSession(s.id)} aria-label="Delete session">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- SETUP ----------
  if (view === 'setup') {
    return (
      <Card className="border-2 border-foreground hard-shadow">
        <CardHeader>
          <CardTitle>New tutor session</CardTitle>
          <CardDescription>Pick your material and the tutor builds learning objectives, then diagnoses what you know.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tutor-topic">Topic or learning objective</Label>
            <Input
              id="tutor-topic"
              placeholder="e.g. Photosynthesis, SQL joins, the French Revolution"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="space-y-2" data-tour="tutor-setup-source">
            <Label>Source material</Label>
            {savedDocs.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto border-2 border-foreground p-2">
                {savedDocs.map((d) => {
                  const checked = selectedDocs.has(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 hover:bg-accent/60">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedDocs((prev) => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id);
                          else if (next.size < 5) next.add(d.id);
                          return next;
                        })}
                      />
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{d.title}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">{d.kind === 'lesson' ? 'Lesson' : 'Summary'}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <Textarea
              placeholder="Or paste your notes, a chapter, or slides text here..."
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              className="min-h-28 border-2 border-foreground"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as TutorDifficulty)}>
                <SelectTrigger className="border-2 border-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Session length</Label>
              <Select value={sessionLength} onValueChange={setSessionLength}>
                <SelectTrigger className="border-2 border-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">Short (5 questions)</SelectItem>
                  <SelectItem value="8">Standard (8 questions)</SelectItem>
                  <SelectItem value="12">Deep (12 questions)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setView('list')}>Cancel</Button>
            <Button onClick={startSession} disabled={!canStart || loading} className="border-2 border-foreground">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Target className="w-4 h-4 mr-2" />}
              Start diagnostic
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------- SUMMARY ----------
  if (view === 'summary') {
    return (
      <div className="space-y-6">
        <Card className="border-2 border-foreground hard-shadow">
          <CardHeader>
            <CardTitle>{sessionTitle || 'Session complete'}</CardTitle>
            <CardDescription>{position.answered} of {position.total} questions answered</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {objectives.length > 0 && mastery.length === 0 && (
              <p className="text-sm text-muted-foreground">This session ended before any answers were scored.</p>
            )}
            <div className="space-y-2">
              {mastery.map((m) => {
                const meta = MASTERY_META[m.status];
                return (
                  <div key={m.conceptId} className="border-2 border-foreground p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium truncate">{m.title}</div>
                      <span className={`text-xs font-semibold uppercase tracking-wider ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <Progress value={m.masteryScore} className="h-2 flex-1" />
                      <span className="text-xs text-muted-foreground tabular-nums">{m.masteryScore}/100 · {m.attempts} {m.attempts === 1 ? 'try' : 'tries'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" className="border-2 border-foreground" disabled={loading} onClick={() => startReview(sessionId)}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Review missed concepts
              </Button>
              <Button variant="ghost" onClick={() => { setView('list'); loadSessions(); }}>
                Back to sessions
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------- QUESTION + FEEDBACK ----------
  return (
    <div className="space-y-6">
      <Card className="border-2 border-foreground">
        <CardContent className="py-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">{sessionTitle}</span>
            <span className="tabular-nums">{position.answered}/{position.total}</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </CardContent>
      </Card>

      {view === 'question' && question && (
        <Card className="border-2 border-foreground hard-shadow" data-tour="tutor-question">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="border-2 border-foreground">{question.conceptTitle || 'Concept'}</Badge>
              <Badge variant="outline" className="capitalize">{question.difficulty}</Badge>
            </div>
            <CardTitle className="text-lg leading-snug">{question.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {question.type === 'mcq' && question.options ? (
              <div className="space-y-2">
                {question.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedOption(opt)}
                    className={`w-full text-left px-4 py-3 border-2 transition-colors ${selectedOption === opt ? 'border-foreground bg-secondary text-secondary-foreground' : 'border-foreground/40 hover:border-foreground'}`}
                  >
                    <span className="font-semibold mr-2">{String.fromCharCode(65 + i)}.</span>{opt}
                  </button>
                ))}
              </div>
            ) : (
              <Textarea
                placeholder="Type your answer..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="min-h-24 border-2 border-foreground"
              />
            )}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={finishEarly} disabled={loading}>End session</Button>
              <Button
                onClick={submitAnswer}
                disabled={loading || !(question.type === 'mcq' ? selectedOption : answer.trim())}
                className="border-2 border-foreground"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ChevronRight className="w-4 h-4 mr-2" />}
                Submit answer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {view === 'feedback' && evaluation && (
        <Card className="border-2 border-foreground hard-shadow">
          <CardHeader>
            {(() => {
              const meta = VERDICT_META[evaluation.verdict];
              const Icon = meta.icon;
              return (
                <CardTitle className={`flex items-center gap-2 ${meta.cls}`}>
                  <Icon className="w-5 h-5" />
                  {meta.label}
                </CardTitle>
              );
            })()}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed">{evaluation.explanation}</p>
            {evaluation.misconception && (
              <div className="border-2 border-amber-500/60 bg-amber-500/10 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1">Misconception spotted</div>
                <p className="text-sm">{evaluation.misconception}</p>
              </div>
            )}
            {evaluation.correctAnswer && evaluation.verdict !== 'correct' && (
              <div className="border-2 border-foreground/30 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Expected answer</div>
                <p className="text-sm">{evaluation.correctAnswer}</p>
              </div>
            )}
            {evaluation.sourceExcerpt && (
              <blockquote className="border-l-4 border-primary pl-3 text-xs text-muted-foreground italic">
                {evaluation.sourceExcerpt}
              </blockquote>
            )}
            <div className="flex justify-end">
              <Button onClick={goNext} disabled={loading || !question} className="border-2 border-foreground">
                Next question
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mastery.length > 0 && (
        <div className="flex flex-wrap gap-2" data-tour="tutor-mastery">
          {mastery.filter((m) => m.attempts > 0).map((m) => {
            const meta = MASTERY_META[m.status];
            return (
              <Badge key={m.conceptId} variant="outline" className={`border-2 border-foreground/40 ${meta.cls}`}>
                <BookOpen className="w-3 h-3 mr-1" />
                {m.title}: {meta.label}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdaptiveTutor;
