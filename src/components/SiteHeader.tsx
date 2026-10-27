import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLocation, useNavigate } from "react-router-dom";
import { Moon, Sun, Menu } from "lucide-react";
const MetaStudyLogo = "/metastudy-logo-full.png";

const NAV_ITEMS = [
  { label: "Home", path: "/" },
  { label: "Features", path: "/Features" },
  { label: "Pricing", path: "/pricing" },
  { label: "FAQ", path: "/faq" },
];

/**
 * Shared public-site header used on Home, Features, Pricing, Trust, FAQ and
 * legal pages so navigation stays consistent everywhere.
 * The mobile hamburger menu is a controlled Sheet that closes on navigation.
 */
export const SiteHeader = () => {
  const [isDark, setIsDark] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const version = import.meta.env.VITE_APP_VERSION || "";

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.toLowerCase().startsWith(path.toLowerCase());

  return (
    <div className="sticky top-0 z-20 w-full bg-background border-b-2 border-foreground">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6 min-w-0">
          <button onClick={() => go('/')} className="inline-flex items-center shrink-0">
            <img src={MetaStudyLogo} alt="MetaStudy" className="h-9 md:h-10 w-auto" loading="lazy" />
          </button>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                className={`px-3 py-1.5 font-semibold uppercase tracking-wider text-xs transition-colors hover:bg-accent ${isActive(item.path) ? 'bg-secondary text-secondary-foreground border-2 border-foreground hard-shadow-sm' : 'border-2 border-transparent'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          {version && <div className="hidden lg:block text-sm text-muted-foreground">v{version}</div>}
        </div>
        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="sm" className="font-semibold" onClick={() => go('/auth')}>
            Sign in
          </Button>
          <Button variant="outline" size="sm" className="border-2 border-foreground" onClick={toggleTheme} aria-label="Toggle theme">
            {isDark ? (<Sun className="w-4 h-4" />) : (<Moon className="w-4 h-4" />)}
          </Button>
        </div>
        {/* Mobile hamburger menu */}
        <div className="md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetHeader>
                <SheetTitle className="text-left">Menu</SheetTitle>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Button
                    key={item.path}
                    variant={isActive(item.path) ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() => go(item.path)}
                  >
                    {item.label}
                  </Button>
                ))}
                <div className="h-px bg-border my-2" />
                <Button variant="ghost" className="justify-start" onClick={() => go('/auth')}>Sign in</Button>
                <Button variant="outline" className="justify-start" onClick={toggleTheme}>
                  {isDark ? 'Light mode' : 'Dark mode'}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
};
