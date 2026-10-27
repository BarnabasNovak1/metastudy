import React, { useEffect, useState } from 'react';
import { Loader2, Lightbulb } from 'lucide-react';
import { getRandomFunFact } from '@/lib/funFacts';
import { Progress } from '@/components/ui/progress';

interface LoadingOverlayProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  notice?: string; // optional middle notice (e.g., "Don't refresh; you can navigate away")
  showFunFact?: boolean;
  progress?: number; // optional progress value (0-100) to show a progress bar below the fun fact
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ open, title, subtitle, notice, showFunFact = true, progress }) => {
  const [fact, setFact] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!showFunFact) return;
    try {
      setFact(getRandomFunFact());
    } catch {
      setFact(null);
    }
  }, [open, showFunFact]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-200/70 dark:bg-neutral-900/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl border bg-card text-card-foreground shadow-lg p-5 sm:p-6 dark:border-neutral-700 mx-auto">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="w-8 h-8 sm:w-6 sm:h-6 animate-spin" />
          {title ? (
            <div className="text-base sm:text-lg md:text-xl font-medium">{title}</div>
          ) : (
            <div className="text-base sm:text-lg md:text-xl font-medium">Working…</div>
          )}
          {subtitle && (
            <div className="text-sm md:text-base text-muted-foreground max-w-prose px-2">{subtitle}</div>
          )}
          {notice && (
            <div className="text-xs md:text-sm text-amber-600 dark:text-amber-400 max-w-prose px-2">{notice}</div>
          )}
          {showFunFact && fact && (
            <div className="mt-2 text-xs md:text-sm text-muted-foreground max-w-prose flex items-start gap-2 px-2">
              <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 mt-0.5 flex-shrink-0 text-yellow-500" />
              <span>Fun fact: {fact}</span>
            </div>
          )}
          {typeof progress === 'number' && (
            <div className="w-full mt-4 px-2">
              <Progress value={progress} className="h-2 bg-gray-200 dark:bg-gray-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default LoadingOverlay;
