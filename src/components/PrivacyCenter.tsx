import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions as fbFunctions } from "../../firebase";
import { useUserData } from "@/contexts/UserDataContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Download, Trash2, Clock, ShieldCheck, Loader2 } from "lucide-react";

interface PrivacyCenterProps {
  onOpenDeleteAccount: () => void;
}

export const PrivacyCenter = ({ onOpenDeleteAccount }: PrivacyCenterProps) => {
  const userData = useUserData();
  const uid = userData.uid;
  const { toast } = useToast();

  const [exporting, setExporting] = useState(false);
  const [retention, setRetention] = useState<string>("0");
  const [savingRetention, setSavingRetention] = useState(false);

  useEffect(() => {
    const days = Number((userData.profile as any)?.chat_retention_days || 0);
    setRetention(String([30, 90].includes(days) ? days : 0));
  }, [userData.profile]);

  const handleExport = async () => {
    if (!uid || exporting) return;
    setExporting(true);
    try {
      const fn = httpsCallable(fbFunctions, "exportMyData");
      const res: any = await fn({});
      const json = JSON.stringify(res?.data ?? {}, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `metastudy-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: "Your data was downloaded as a JSON file." });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || "Could not export your data. Try again later.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleRetentionChange = async (val: string) => {
    if (!uid) return;
    const prev = retention;
    setRetention(val);
    setSavingRetention(true);
    try {
      await setDoc(doc(db as any, "users", uid), { chat_retention_days: Number(val) }, { merge: true });
      toast({
        title: "Retention updated",
        description: val === "0"
          ? "Chats will be kept until you delete them."
          : `Chats older than ${val} days will be automatically deleted.`,
      });
    } catch (e: any) {
      setRetention(prev);
      toast({ title: "Could not save", description: e?.message || "Try again later.", variant: "destructive" });
    } finally {
      setSavingRetention(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Privacy Center</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Your content is private by default. Nobody can see your chats, quizzes, flashcards, or summaries unless you
          explicitly share them to the feed. Manage your data below.
        </p>
      </Card>

      {/* Export */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Download className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Download my data</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Get a full copy of your account data (profile, chats, study materials, achievements, and posts) as a JSON file.
        </p>
        <Button className="mt-4" variant="outline" size="sm" onClick={handleExport} disabled={exporting || !uid}>
          {exporting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Preparing export…</>) : "Download my data"}
        </Button>
      </Card>

      {/* Retention */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Chat auto-deletion</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          Automatically delete old chat sessions. Applies to AI chat history only; study materials are never auto-deleted.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Select value={retention} onValueChange={handleRetentionChange} disabled={savingRetention || !uid}>
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Keep until I delete them</SelectItem>
              <SelectItem value="30">Auto-delete after 30 days</SelectItem>
              <SelectItem value="90">Auto-delete after 90 days</SelectItem>
            </SelectContent>
          </Select>
          {savingRetention && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="p-6 border-destructive/30">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-destructive" />
          <h3 className="font-semibold">Danger zone</h3>
        </div>
        <div className="mt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Delete my account</div>
              <div className="text-xs text-muted-foreground">
                Permanently deletes your account, all content, uploaded files, posts, and cancels any subscription.
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={onOpenDeleteAccount} disabled={!uid}>
              Delete account
            </Button>
          </div>
        </div>
      </Card>

    </div>
  );
};
