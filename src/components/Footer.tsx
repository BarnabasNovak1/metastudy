import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { ReportIssueDialog } from "@/components/ReportIssueDialog";
import { auth } from "../../firebase";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

export const Footer = () => {
  const [reportOpen, setReportOpen] = useState(false);
  const isLoggedIn = !!auth.currentUser;
  const year = new Date().getFullYear();
  return (
    <footer className="border-t-2 border-foreground mt-6 bg-muted/50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8">
          <div className="flex-1 w-full flex items-center gap-3">
            <img src={MetaStudyLogo} alt="" aria-hidden className="w-8 h-8 border-2 border-foreground" />
            <div>
              <div className="text-sm font-bold">MetaStudy</div>
              <div className="text-xs text-muted-foreground">© {year} metastudy-e1ba2.web.app. All rights reserved.</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground md:text-right font-medium">
            Study tools built on Meta's Llama models.
          </div>
        </div>
        <div className="mt-4 pt-4 border-t-2 border-foreground/15 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3 font-medium">
            <span>Drop notes in. Walk out prepared.</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 font-medium">
            <Link to="/privacy#terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/90">Terms</Link>
            <Link to="/privacy#privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/90">Privacy</Link>
            <Link to="/privacy#security" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/90">Security</Link>
            <Link to="/privacy#responsible-ai" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/90">Responsible AI</Link>
            <Link to="/privacy#disclaimer" target="_blank" rel="noopener noreferrer" className="hover:text-foreground/90">Disclaimer</Link>
            {isLoggedIn && (
              <button
                onClick={() => setReportOpen(true)}
                className="hover:text-foreground/90 flex items-center gap-1"
              >
                <AlertCircle className="w-3 h-3" />
                Report Issue
              </button>
            )}
          </div>
        </div>
      </div>
      <ReportIssueDialog open={reportOpen} onOpenChange={setReportOpen} />
    </footer>
  );
};
