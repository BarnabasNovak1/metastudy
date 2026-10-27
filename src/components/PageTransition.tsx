import { useEffect, useState, ReactNode } from "react";
import { cn } from "@/lib/utils";


/**
 * PageTransition component provides smooth fade/slide animations between routes.
 * Wrap your route content with this component for smooth page transitions.
 * 
 * Uses CSS animations for performance (no external dependencies like framer-motion).
 */

/**
 * Simple fade transition without exit animation (faster navigation feel)
 */
export function FadeIn({ children, className, delay = 0 }: { 
  children: ReactNode; 
  className?: string;
  delay?: number;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={cn(
        "transition-all duration-200 sm:duration-300 ease-out",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 sm:translate-y-2",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Staggered fade-in for list items
 */
export function StaggeredFadeIn({ 
  children, 
  className,
  staggerDelay = 50 
}: { 
  children: ReactNode[]; 
  className?: string;
  staggerDelay?: number;
}) {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <FadeIn key={index} delay={index * staggerDelay}>
          {child}
        </FadeIn>
      ))}
    </div>
  );
}

// CSS to add to your global styles (index.css):
/*
@keyframes pageEnter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pageExit {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-8px);
  }
}

.page-transition {
  will-change: opacity, transform;
}

.page-enter {
  animation: pageEnter 0.2s ease-out forwards;
}

.page-exit {
  animation: pageExit 0.15s ease-in forwards;
}
*/
