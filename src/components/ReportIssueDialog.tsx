import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions as fbFunctions } from "../../firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertCircle, MessageSquare, Bug, Lightbulb, ShieldCheck } from "lucide-react";

interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REPORT_TYPES = [
  { value: "bug", label: "Bug Report", icon: Bug, description: "Something isn't working correctly" },
  { value: "feedback", label: "Feedback", icon: MessageSquare, description: "Share your thoughts" },
  { value: "feature", label: "Feature Request", icon: Lightbulb, description: "Suggest an improvement" },
  { value: "error", label: "Error/Crash", icon: AlertCircle, description: "Report a crash or error" },
  { value: "report_user", label: "Report User", icon: AlertCircle, description: "Report abusive or unsafe user behavior" },
  { value: "privacy_request", label: "Privacy Request", icon: ShieldCheck, description: "Data access, correction, deletion, or appeal request (GDPR / US state privacy laws)" },
];

export const ReportIssueDialog = ({ open, onOpenChange }: ReportIssueDialogProps) => {
  const { toast } = useToast();
  const [type, setType] = useState<string>("bug");
  const [message, setMessage] = useState<string>("");
  const [reportedUser, setReportedUser] = useState<string>("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please describe the issue you're experiencing.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const sendReport = httpsCallable(fbFunctions, "sendReportEmail");
      await sendReport({
        type,
        message: message.trim(),
        ...(type === 'report_user' && reportedUser.trim() ? { reportedUser: reportedUser.trim() } : {}),
        metadata: {
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          screen: `${window.innerWidth}x${window.innerHeight}`,
          ...(type === 'report_user' && reportedUser.trim() ? { reportedUser: reportedUser.trim() } : {}),
        },
      });

      toast({
        title: "Report sent!",
        description: "Thank you for your feedback. We'll look into it.",
      });

      setMessage("");
      setReportedUser("");
      setType("bug");
      onOpenChange(false);
    } catch (e: any) {
      console.error("Failed to send report:", e);
      toast({
        title: "Failed to send",
        description: e?.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const selectedType = REPORT_TYPES.find(t => t.value === type);
  const Icon = selectedType?.icon || Bug;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            Report an Issue
          </DialogTitle>
          <DialogDescription>
            Let us know about any problems or suggestions. We read every report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Type of Report</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start" sideOffset={6} className="z-[1200]">
                {REPORT_TYPES.map(rt => (
                  <SelectItem key={rt.value} value={rt.value}>
                    <div className="flex items-center gap-2">
                      <rt.icon className="w-4 h-4" />
                      <span>{rt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedType && (
              <p className="text-xs text-muted-foreground">{selectedType.description}</p>
            )}
          </div>

          {type === 'report_user' && (
            <div className="space-y-2">
              <Label htmlFor="reported-user">Reported username or UID (optional)</Label>
              <Textarea
                id="reported-user"
                placeholder="@username or user ID"
                value={reportedUser}
                onChange={(e) => setReportedUser(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="report-message">Describe the issue</Label>
            <Textarea
              id="report-message"
              placeholder="Please describe what happened, what you expected, and any steps to reproduce the issue..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Include as much detail as possible. We'll respond via email if needed.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={sending || !message.trim()}>
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Report"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportIssueDialog;
