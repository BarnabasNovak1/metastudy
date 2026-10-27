import { useState, useCallback } from 'react';

interface UsageAnimationProps {
  show: boolean;
}

export function UsageAnimation({ show }: UsageAnimationProps) {
  if (!show) return null;
  
  return (
    <span
      className="absolute -top-2 left-1/2 -translate-x-1/2 pointer-events-none z-[70] text-sm font-bold text-primary whitespace-nowrap animate-usage-float"
    >
      +1
    </span>
  );
}

// Hook for easy usage
export function useUsageAnimation() {
  const [showAnimation, setShowAnimation] = useState(false);

  const triggerAnimation = useCallback(() => {
    setShowAnimation(true);
    setTimeout(() => setShowAnimation(false), 1500);
  }, []);

  return { showAnimation, triggerAnimation };
}
