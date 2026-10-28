import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { db } from "../../firebase";
import { collection, getDocs, limit, query, where, orderBy } from "firebase/firestore";
import { sendBuddyMessage, type BuddySuggestion } from "@/lib/buddy";

interface BuddyMessage {
  role: "user" | "assistant";
  content: string;
  suggestion?: BuddySuggestion;
}

export function BuddyBot({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<BuddyMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Load the persistent buddy conversation on first open
  useEffect(() => {
    if (!open || loaded || !userId) return;
    (async () => {
      try {
        const sessions = await getDocs(
          query(collection(db, "users", userId, "chat_sessions"), where("kind", "==", "buddy"), limit(1))
        );
        if (!sessions.empty) {
          const msgs = await getDocs(
            query(
              collection(db, "users", userId, "chat_sessions", sessions.docs[0].id, "messages"),
              orderBy("created_at", "asc"),
              limit(60)
            )
          );
          setMessages(
            msgs.docs.map((d) => {
              const m = d.data() as any;
              return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || ""), suggestion: m.suggestion };
            })
          );
        }
      } catch {}
      setLoaded(true);
    })();
  }, [open, loaded, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const history = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);
    try {
      const resp = await sendBuddyMessage({ message: text, history, requestId: crypto.randomUUID() });
      setMessages((prev) => [...prev, { role: "assistant", content: resp.reply, suggestion: resp.suggestion }]);
    } catch (e: any) {
      toast({ title: "Buddy error", description: e?.message || "Could not reach Buddy", variant: "destructive" });
      setMessages((prev) => [...prev, { role: "assistant", content: "Hmm, I blanked out for a second there. Try that again?" }]);
    } finally {
      setSending(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(92vw,380px)] h-[min(70vh,520px)] bg-card border-2 border-foreground hard-shadow flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-foreground bg-accent text-accent-foreground">
            <Bot className={`w-4 h-4 ${sending ? 'animate-buddy-shake' : ''}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">Buddy</p>
              <p className="text-[10px] text-muted-foreground leading-tight">0.5 credits per message</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close Buddy" className="p-1 hover:bg-accent rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          <ScrollArea className="flex-1 px-3 py-2">
            <div className="space-y-3">
              {messages.length === 0 && loaded && (
                <div className="text-sm text-muted-foreground pt-6 text-center px-4">
                  Hey, I'm Buddy — your study companion. Ask me anything, vent about exams, or let me point you at the right tool.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 text-sm border-2 border-foreground ${m.role === "user" ? "bg-accent text-accent-foreground" : "bg-background"}`}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.suggestion && (
                      <button
                        type="button"
                        onClick={() => { setOpen(false); navigate(m.suggestion!.path); }}
                        className="mt-2 inline-block text-xs font-semibold underline underline-offset-2 hover:opacity-80"
                      >
                        {m.suggestion.label} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="px-3 py-2 text-sm border-2 border-foreground bg-background flex items-center gap-1.5">
                    <Bot className="w-4 h-4 animate-buddy-shake" />
                    <span className="flex gap-0.5" aria-label="Buddy is thinking">
                      <span className="w-1 h-1 rounded-full bg-foreground animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-foreground animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-foreground animate-pulse" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2 p-2 border-t-2 border-foreground">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message Buddy..."
              maxLength={1500}
              className="h-9 text-sm border-foreground"
            />
            <Button type="button" size="icon" onClick={send} disabled={sending || !input.trim()} className="h-9 w-9 border-2 border-foreground hard-shadow-sm" aria-label="Send">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="default"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        className="relative h-10 w-10 sm:h-11 sm:w-11 bg-accent text-accent-foreground border-2 border-foreground hard-shadow-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
        aria-label={open ? "Close Buddy" : "Chat with Buddy"}
        title="Buddy, your study companion"
      >
        {!open && !sending && (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-buddy-ping absolute inline-flex h-full w-full rounded-full bg-green-500" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500 border border-foreground" />
          </span>
        )}
        <Bot className={`w-5 h-5 ${sending ? 'animate-buddy-shake' : 'animate-buddy-bob'}`} />
      </Button>
    </div>
  );
}
