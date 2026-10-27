import { useEffect, useRef, useState, useId } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { API_BASE, getAuthHeaders } from "@/lib/api-utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface Props {
  question: string;
  title: string;
  value: string;
  disabled?: boolean;
  onChange: (answer: string) => void;
  onReviewChange: (pending: boolean) => void;
}

export function ReferenceAnswerEditor({ question, title, value, disabled, onChange, onReviewChange }: Props) {
  const id = useId();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const requestRef = useRef(0);
  const reviewCallback = useRef(onReviewChange);
  reviewCallback.current = onReviewChange;

  useEffect(() => {
    requestRef.current += 1;
    setDraft(null);
    setGenerating(false);
    reviewCallback.current(false);
    return () => { requestRef.current += 1; };
  }, [question]);

  const generate = async () => {
    if (generating || !question.trim()) return;
    const request = ++requestRef.current;
    setGenerating(true);
    onReviewChange(true);
    try {
      const response = await fetch(`${API_BASE}/quiz/generate-reference-answer`, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ question, title }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not generate a sample answer.");
      if (typeof data.referenceAnswer !== "string" || !data.referenceAnswer.trim()) {
        throw new Error("No sample answer was returned. Please try again.");
      }
      if (request === requestRef.current) setDraft(data.referenceAnswer);
    } catch (error) {
      if (request !== requestRef.current) return;
      onReviewChange(draft !== null);
      toast({ title: "Could not generate answer", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      if (request === requestRef.current) setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>Sample answer for AI grading</Label>
        <Button type="button" variant="outline" size="sm" disabled={disabled || generating || !question.trim()} onClick={generate}>
          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {generating ? "Generating..." : "Generate sample answer"}
        </Button>
      </div>
      <Textarea
        id={id}
        value={value}
        maxLength={12000}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        placeholder="Write a complete sample answer, including the key ideas a learner should explain."
        className="min-h-[110px]"
      />
      <p className="text-xs text-muted-foreground">
        AI compares responses with this saved answer, including in the feed. Equivalent wording is accepted and partially correct answers can earn partial credit.
      </p>
      {draft !== null && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Label htmlFor={`${id}-draft`}>AI draft, review before accepting</Label>
          <Textarea id={`${id}-draft`} value={draft} maxLength={12000} onChange={event => setDraft(event.target.value)} disabled={generating || disabled} className="min-h-[110px]" />
          <p className="text-xs text-muted-foreground">Check the facts and edit the draft. It will only be used for grading after you accept it and save the quiz.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={disabled || generating || !draft.trim()} onClick={() => {
              onChange(draft.trim());
              setDraft(null);
              onReviewChange(false);
            }}>
              <Check className="mr-2 h-4 w-4" /> Accept answer
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled || generating} onClick={() => {
              setDraft(null);
              onReviewChange(false);
            }}>Discard draft</Button>
          </div>
        </div>
      )}
    </div>
  );
}
