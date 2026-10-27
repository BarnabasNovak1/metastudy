import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, ChevronRight } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageBreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
  showHome?: boolean;
  /** Inject BreadcrumbList schema markup into document head */
  injectSchema?: boolean;
}

/**
 * PageBreadcrumbs component with automatic JSON-LD schema markup injection.
 * Improves SEO with rich snippets in Google search results.
 * 
 * @example
 * <PageBreadcrumbs 
 *   items={[
 *     { label: "Features", href: "/Features" },
 *     { label: "AI Chat" }
 *   ]} 
 * />
 */
export function PageBreadcrumbs({ 
  items, 
  className, 
  showHome = true,
  injectSchema = true 
}: PageBreadcrumbsProps) {
  const location = useLocation();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // Build full breadcrumb list including home
  const fullItems: BreadcrumbItem[] = showHome
    ? [{ label: "Home", href: "/" }, ...items]
    : items;

  // Inject BreadcrumbList JSON-LD schema
  useEffect(() => {
    if (!injectSchema || !origin) return;

    // Remove any existing breadcrumb schema from this component
    const existing = document.querySelector('script[data-breadcrumb-schema="true"]');
    if (existing) existing.remove();

    // Build schema
    const schema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": fullItems.map((item, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "name": item.label,
        "item": item.href ? origin + item.href : origin + location.pathname,
      })),
    };

    // Inject into head
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-breadcrumb-schema", "true");
    script.text = JSON.stringify(schema);
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [fullItems, origin, location.pathname, injectSchema]);

  return (
    <Breadcrumb className={cn("mb-4", className)}>
      <BreadcrumbList className="text-xs sm:text-sm">
        {fullItems.map((item, index) => {
          const isLast = index === fullItems.length - 1;
          const isHome = index === 0 && showHome;

          return (
            <BreadcrumbItem key={index}>
              {!isLast ? (
                <>
                  <BreadcrumbLink asChild>
                    <Link 
                      to={item.href || "#"} 
                      className="flex items-center gap-1 hover:text-primary transition-colors"
                    >
                      {isHome && <Home className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                      <span className="max-w-[80px] sm:max-w-none truncate">{item.label}</span>
                    </Link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator>
                    <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </BreadcrumbSeparator>
                </>
              ) : (
                <BreadcrumbPage className="font-medium">
                  {item.label}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Generate breadcrumb items from current path
 * Useful for automatic breadcrumb generation
 */
export function generateBreadcrumbsFromPath(pathname: string): BreadcrumbItem[] {
  const pathMap: Record<string, string> = {
    "/": "Home",
    "/Features": "Features",
    "/pricing": "Pricing",
    "/faq": "FAQ",

    "/auth": "Sign In",
    "/study": "Study",
    "/account": "Account",
    "/blog": "Blog",
  };

  const segments = pathname.split("/").filter(Boolean);
  const items: BreadcrumbItem[] = [];
  
  let currentPath = "";
  for (const segment of segments) {
    currentPath += "/" + segment;
    const label = pathMap[currentPath] || segment.charAt(0).toUpperCase() + segment.slice(1);
    items.push({
      label,
      href: currentPath,
    });
  }

  // Mark last item as current page (no href)
  if (items.length > 0) {
    delete items[items.length - 1].href;
  }

  return items;
}

/**
 * Auto breadcrumbs based on current route
 */
export function AutoBreadcrumbs({ className }: { className?: string }) {
  const location = useLocation();
  const items = generateBreadcrumbsFromPath(location.pathname);
  
  // Don't show breadcrumbs on home page
  if (location.pathname === "/" || items.length === 0) {
    return null;
  }

  return <PageBreadcrumbs items={items} className={className} />;
}
