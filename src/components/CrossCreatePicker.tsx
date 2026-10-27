import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  limit,
} from "firebase/firestore";
import { useUserData } from "@/contexts/UserDataContext";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlanGate } from "@/hooks/use-plan-gate";
import { BookOpen, Layers, Target, MessageSquare, Calendar, Wand2 } from "lucide-react";

interface Item { id: string; title: string; type: string; extra?: any }

export interface CrossCreatePickerProps {
  userId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTab?: 'essay'|'summary'|'flashcards'|'quizzes'|'chat'|'plans'|'lessons'|'career';
  allowedTabs?: Array<'essay'|'summary'|'flashcards'|'quizzes'|'chat'|'plans'|'lessons'|'career'>;
}

const truncate = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "…" : s);

const buildFromFlashcards = async (userId: string, setId: string) => {
  const fRef = collection(db, "users", userId, "flashcard_sets", setId, "flashcards");
  const snap = await getDocs(fRef);
  const cards = snap.docs.map(d => d.data() as any);
  return cards.map(c => `Q: ${String(c.question||'').trim()}\nA: ${String(c.answer||'').trim()}`).join("\n\n");
};

const buildFromQuiz = async (userId: string, quizId: string) => {
  const dref = doc(db, "users", userId, "quizzes", quizId);
  const ds = await getDoc(dref);
  const data = ds.exists() ? (ds.data() as any) : {};
  const qs = Array.isArray(data.questions) ? data.questions : [];
  return qs.map((q: any) => {
    const qt = String(q?.question || "").trim();
    const ans = q?.options ? (q.options[q.correct_answer] || '') : (q?.correct_answer || '');
    return qt ? `Q: ${qt}\nA: ${String(ans||'').trim()}` : '';
  }).filter(Boolean).join("\n\n");
};

const buildFromChat = async (userId: string, sessionId: string) => {
  const msgsRef = collection(db, "users", userId, "chat_sessions", sessionId, "messages");
  // OPTIMIZED: Limit chat messages to last 100 for context building
  const snap = await getDocs(query(msgsRef, orderBy("created_at", "asc"), limit(100)));
  const lines = snap.docs.map(d => (d.data() as any).content || '').filter(Boolean);
  return lines.join("\n\n");
};

const buildFromPlan = (item: any) => {
  try {
    const p = item?.plan || {};
    const meta = p.metadata || {};
    const focus = Array.isArray(p.focusAreas) ? p.focusAreas.map((a:any)=>`${a.subject}: ${(a.keyTopics||[]).join(', ')}`).join('\n') : '';
    const schedule = Array.isArray(p.weeklySchedule) ? p.weeklySchedule.map((d:any)=>`${d.day}: ${d.focus} | ${(d.tasks||[]).join('; ')}`).join('\n') : '';
    return [String(item.title||''), String(item.goals||''), `Hours/Day: ${meta.hoursPerDay||''}`, `Timeframe: ${meta.timeframe||''}`, focus, schedule].filter(Boolean).join('\n\n');
  } catch { return String(item?.goals||''); }
};

const buildFromLesson = (item: any) => {
  try {
    const l = item?.lesson || {};
    const meta = l.metadata || {};
    const parts = [l.title, l.topic, meta.learningObjectives, (l.detailedContent?.keyConcepts||[])?.join('\n'), (l.activities?.individual||[])?.join('\n')].filter(Boolean);
    return parts.join('\n\n');
  } catch { return String(item?.topic||''); }
};

export const CrossCreatePicker = ({ userId, open, onOpenChange, initialTab, allowedTabs }: CrossCreatePickerProps) => {
  const gate = usePlanGate();
  const DEFAULT_TABS = ['chat','summary','flashcards','quizzes','plans'] as const;
  const DEFAULT_TABS_ARRAY = [...DEFAULT_TABS] as string[];
  const ALLOWED: string[] = useMemo(() => {
    const src: string[] = (Array.isArray(allowedTabs) && allowedTabs.length > 0)
      ? (allowedTabs as unknown as string[])
      : DEFAULT_TABS_ARRAY;
    return src.filter((t) => DEFAULT_TABS_ARRAY.includes(t));
  }, [allowedTabs]);
  const pickInitial = () => {
    const pref = initialTab || 'summary';
    return (ALLOWED as any[]).includes(pref) ? pref : (ALLOWED[0] as any);
  };
  const [tab, setTab] = useState<any>(pickInitial());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [selected, setSelected] = useState<Item[]>([]);
  const [dest, setDest] = useState<'summary'|'flashcards'|'quiz'>('summary');
  const disabledQuiz = gate.loading ? false : !gate.quizAccess;
  
  // Derive usesBlocked from centralized useUserData (no duplicate listener)
  const { profile } = useUserData();
  const uses = typeof profile.uses_this_month === 'number' ? profile.uses_this_month : 0;
  const plan = (profile.plan || 'free') as string;
  const rawQuota = typeof profile.monthly_quota === 'number' ? profile.monthly_quota : 0;
  const quota = rawQuota > 0 ? rawQuota : (plan === 'free' ? 5 : plan === 'basic' ? 50 : plan === 'advanced' ? 200 : plan === 'pro' ? 500 : 5);
  const extra = typeof profile.extra_uses_balance === 'number' ? profile.extra_uses_balance : 0;
  const usesBlocked = quota > 0 ? (uses >= quota && extra <= 0) : false;

  useEffect(() => {
    if (!open) { setSelected([]); setSearch(""); setTab(pickInitial()); setDest('summary'); }
    else {
      // if current tab not allowed anymore, move to first allowed
      if (!(ALLOWED as any[]).includes(tab)) setTab(pickInitial());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab, JSON.stringify(ALLOWED)]);

  const loadTab = async (t: string) => {
    if (!userId) return;
    if (!(ALLOWED as any[]).includes(t)) return;
    if (items[t]) return; // cache
    setLoading(true);
    try {
      // OPTIMIZED: All queries now have limit(50) to reduce reads
      if (t === 'essay') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'essays'), limit(50)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Untitled', type: 'essay' }));
        setItems(prev => ({ ...prev, essay: arr }));
      } else if (t === 'summary') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'summaries'), limit(50)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Summary', type: 'summary' }));
        setItems(prev => ({ ...prev, summary: arr }));
      } else if (t === 'flashcards') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'flashcard_sets'), limit(50)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Set', type: 'flashcards' }));
        setItems(prev => ({ ...prev, flashcards: arr }));
      } else if (t === 'quizzes') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'quizzes'), limit(50)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Quiz', type: 'quiz' }));
        setItems(prev => ({ ...prev, quizzes: arr }));
      } else if (t === 'chat') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'chat_sessions'), limit(50)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Chat', type: 'chat' }));
        setItems(prev => ({ ...prev, chat: arr }));
      } else if (t === 'plans') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'study_plans'), limit(30)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Plan', type: 'plan' }));
        setItems(prev => ({ ...prev, plans: arr }));
      } else if (t === 'lessons') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'lessons'), limit(30)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).title || 'Lesson', type: 'lesson' }));
        setItems(prev => ({ ...prev, lessons: arr }));
      } else if (t === 'career') {
        const snap = await getDocs(query(collection(db, 'users', userId, 'career_plans'), limit(20)));
        const arr = snap.docs.map(d => ({ id: d.id, title: (d.data() as any).label || 'Career Plan', type: 'career' }));
        setItems(prev => ({ ...prev, career: arr }));
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) loadTab(tab); }, [open, tab]);
  // Ensure sensible default destination based on initial tab when opening
  useEffect(() => {
    if (!open) return;
    if (initialTab === 'quizzes') setDest('quiz');
    else if (initialTab === 'flashcards') setDest('flashcards');
    else setDest('summary');
  }, [open, initialTab]);

  const filtered = useMemo(() => {
    const list = items[tab] || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(i => i.title.toLowerCase().includes(q));
  }, [items, tab, search]);

  const togglePick = (it: Item) => {
    const exists = selected.find(s => s.id === it.id && s.type === it.type);
    if (exists) setSelected(prev => prev.filter(s => !(s.id === it.id && s.type === it.type)));
    else setSelected(prev => (prev.length >= 2 ? prev : [...prev, it]));
  };

  const previewText = useMemo(() => selected.map(s => s.title).join(" \u2022 "), [selected]);

  const generate = async () => {
    if (selected.length === 0) return;
    // OPTIMIZED: Build combined text from selections in parallel
    const textPromises = selected.map(async (s) => {
      if (s.type === 'essay') {
        const ds = await getDoc(doc(db, 'users', userId, 'essays', s.id));
        return ((ds.data() as any)?.text || '');
      } else if (s.type === 'summary') {
        const ds = await getDoc(doc(db, 'users', userId, 'summaries', s.id));
        const d = (ds.data() as any) || {};
        return (d.summary_text || d.original_text || '');
      } else if (s.type === 'flashcards') {
        return await buildFromFlashcards(userId, s.id);
      } else if (s.type === 'quiz') {
        return await buildFromQuiz(userId, s.id);
      } else if (s.type === 'chat') {
        return await buildFromChat(userId, s.id);
      } else if (s.type === 'plan') {
        const ds = await getDoc(doc(db, 'users', userId, 'study_plans', s.id));
        return buildFromPlan(ds.data());
      } else if (s.type === 'lesson') {
        const ds = await getDoc(doc(db, 'users', userId, 'lessons', s.id));
        return buildFromLesson(ds.data());
      } else if (s.type === 'career') {
        const ds = await getDoc(doc(db, 'users', userId, 'career_plans', s.id));
        const d = (ds.data() as any) || {};
        const recs = Array.isArray(d.recommendations) ? d.recommendations : [];
        const text = recs.map((r:any)=>`${r.title||r.label||''}\n${r.summary||r.reasoning||''}`).filter(Boolean).join('\n\n');
        return (text || d.label || '');
      }
      return '';
    });
    const texts = await Promise.all(textPromises);
    const combined = texts.filter(Boolean).join("\n\n");
    const title = selected[0]?.title || 'Selection';
    (window as any).studyCreateFrom?.({ type: dest, source: 'picker', scope: 'all', payload: { text: combined.trim(), meta: { title } } });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[92vw] sm:w-full overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary/10 text-primary flex items-center justify-center">
                <Wand2 className="w-4 h-4" />
              </div>
              <span>Create from…</span>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <Tabs value={tab} onValueChange={(v: any) => setTab(v)} className="w-full">
              <TabsList className="mb-3 flex gap-2 max-w-full overflow-x-auto whitespace-nowrap px-2 -mx-2">
                {(ALLOWED as any[]).map((t) => (
                  <TabsTrigger
                    key={t}
                    value={t}
                    className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 rounded-full text-xs sm:text-sm data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
                    title={t === 'plans' ? 'Lesson Generator' : (t.charAt(0).toUpperCase() + t.slice(1))}
                    aria-label={t}
                  >
                    {t === 'summary' ? <BookOpen className="w-4 h-4" />
                      : t === 'flashcards' ? <Layers className="w-4 h-4" />
                      : t === 'quizzes' ? <Target className="w-4 h-4" />
                      : t === 'chat' ? <MessageSquare className="w-4 h-4" />
                      : /* plans */ <Calendar className="w-4 h-4" />}
                    <span className="hidden md:inline">{t === 'plans' ? 'Lesson' : (t === 'chat' ? 'AI Chat' : (t.charAt(0).toUpperCase() + t.slice(1)))}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="mb-2">
                <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="text-xs text-muted-foreground mt-1">Pick up to two items</div>
              </div>
              <ScrollArea className="h-72 border rounded">
                <div className="p-2 space-y-1">
                  {(loading ? [] : filtered).map(it => (
                    <button key={`${it.type}:${it.id}`} onClick={() => togglePick(it)} className={`w-full text-left px-3 py-2 rounded hover:bg-accent ${selected.find(s => s.id===it.id && s.type===it.type) ? 'bg-accent' : ''}`}>
                      <div className="font-medium truncate">{it.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">{it.type}</div>
                    </button>
                  ))}
                  {(!loading && filtered.length === 0) && (
                    <div className="text-sm text-muted-foreground p-4 text-center">No items</div>
                  )}
                </div>
              </ScrollArea>
            </Tabs>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-sm">Destination</Label>
              <RadioGroup value={dest} onValueChange={(v:any)=>setDest(v)} className="mt-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="summary" id="dest-summary" />
                  <Label htmlFor="dest-summary">Create Summary</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="flashcards" id="dest-fc" />
                  <Label htmlFor="dest-fc">Create Flashcards</Label>
                </div>
                <div className="flex items-center space-x-2 opacity-100">
                  <RadioGroupItem value="quiz" id="dest-quiz" disabled={disabledQuiz} />
                  <Label htmlFor="dest-quiz" className={disabledQuiz ? 'text-muted-foreground' : ''}>Create Quiz {disabledQuiz && '(Upgrade required)'}</Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label className="text-sm">Preview</Label>
              <div className="text-xs mt-1 p-2 border rounded min-h-[80px] whitespace-pre-wrap">
                {selected.length === 0 ? 'Select up to two items to preview' : truncate(previewText, 300)}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <div className="flex items-center gap-2">
            {usesBlocked && (
              <span className="text-xs text-destructive">Out of uses</span>
            )}
            <Button onClick={generate} disabled={selected.length === 0 || (dest==='quiz' && disabledQuiz) || usesBlocked}>Generate</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
