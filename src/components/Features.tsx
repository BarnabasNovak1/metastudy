import { useEffect, useState } from "react";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { FadeIn } from "@/components/PageTransition";
import { AnimatedHeroDemo } from "@/components/AnimatedHeroDemo";
import {
  MessageSquare, FileText, Layers, ListChecks, BookOpen, FileCheck,
  Users, ScanText, PenLine, Save, Flame
} from "lucide-react";

const featureList = [
  {
    icon: MessageSquare,
    title: "Study Chat",
    description: "Ask questions about your own documents. Pick a personality — coach, professor, friend — or write your own prompt.",
  },
  {
    icon: FileText,
    title: "Summarizer",
    description: "Paste dense readings and get the points that matter. No fluff, no filler.",
  },
  {
    icon: Layers,
    title: "Flashcards",
    description: "Generate a deck from your notes in seconds, or build it card by card. Spaced repetition is built in.",
  },
  {
    icon: ListChecks,
    title: "Quizzes",
    description: "Material in, quiz out — with AI-graded short answers, not just multiple choice. Write your own questions anytime.",
  },
  {
    icon: BookOpen,
    title: "Lesson Generator",
    description: "Step-by-step lessons and study plans generated on whatever you're working through right now.",
  },
  {
    icon: ScanText,
    title: "Handwriting Scan",
    description: "Photograph a notebook or whiteboard and turn handwriting into text you can summarize, quiz, or chat with.",
  },
  {
    icon: PenLine,
    title: "Essay Writer & Grader",
    description: "Draft an essay on any topic, then get it graded with detailed, rubric-style feedback.",
  },
  {
    icon: FileCheck,
    title: "Career Tools",
    description: "Resume reviews, LinkedIn drafts, mock interviews, and role ideas — informed by what you've actually studied.",
  },
  {
    icon: Users,
    title: "Feed & Groups",
    description: "Post your sets as challenges, try other students' decks, climb leaderboards, or keep it private with invite codes.",
  },
  {
    icon: Save,
    title: "My Saves",
    description: "Everything you make stays organized and right where you left it.",
  },
  {
    icon: Flame,
    title: "Streaks & XP",
    description: "Progress you can see — streaks, XP, and achievements for real study sessions.",
  },
];

export const Features = () => {

  const [, setIsDark] = useState<boolean>(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);


  return (
    <>
      {(() => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const title = "MetaStudy Features | AI Flashcards, Quizzes, Summaries & Study Chat";
        const description = "Everything in MetaStudy: flashcard maker (AI or by hand), quiz builder with AI-graded short answers, lesson generator, study chat, a community feed for shared challenges, career tools, essay drafting, and handwriting OCR — powered by Meta's Llama models.";
        const keywords = [
          "AI study tools", "AI flashcards", "AI quiz generator",
          "AI lesson generator", "AI study chat", "MetaStudy features",
          "study together", "study groups online", "study challenges",
          "study feed", "social learning platform", "study community",
          "AI career tools", "AI resume builder", "AI interview prep",
          "AI summarizer", "AI note taker", "AI essay grader", "handwriting OCR",
          "personalized learning", "adaptive study tools",
          "AI homework helper", "AI research helper",
          "metastudy-e1ba2.web.app features", "AI study platform", "educational AI tools"
        ];
        const jsonLd = [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {"@type":"ListItem","position":1,"name":"Home","item": origin + "/"},
              {"@type":"ListItem","position":2,"name":"Features","item": origin + "/Features"}
            ]
          },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "metastudy-e1ba2.web.app",
            "applicationCategory": "EducationalApplication",
            "operatingSystem": "Web",
            "description": description,
            "url": origin + "/Features",
            "image": origin + "/metastudy-og.png",
            "offers": {"@type":"Offer","price":0,"priceCurrency":"USD","url": origin + "/pricing"},
            "provider": { "@type": "Organization", "name": "metastudy-e1ba2.web.app", "url": origin }
          }
        ];
        return (
          <SEO
            title={title}
            description={description}
            keywords={keywords}
            canonical={origin + "/Features"}
            ogImage={origin + "/metastudy-og.png"}
            jsonLd={jsonLd}
          />
        );
      })()}
      {/* Top Header (shared) */}
      <SiteHeader />

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <PageBreadcrumbs items={[{ label: "Features" }]} />
      </div>

      {/* ================= FEATURES SECTION ================= */}
      <section className="py-14 sm:py-20 bg-background">
        <div className="container mx-auto px-6 lg:px-12 space-y-16">
          {/* Headline */}
          <FadeIn>
          <div className="space-y-6 max-w-4xl">
              <p className="text-sm font-bold uppercase tracking-widest text-primary">The full toolbox</p>
              <h2 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight">
                Everything in one app.
                <br />
                <span className="text-muted-foreground">Nothing in your way.</span>
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Every tool works on your own material — generate with AI or build by hand. No ads, no data selling, no hidden fees.
              </p>
          </div>
          </FadeIn>

          {/* Platform Preview */}
          <div className="max-w-5xl mx-auto w-full">
            <div className="border-2 border-foreground bg-card hard-shadow">
              <div className="flex items-center gap-2 border-b-2 border-foreground bg-muted px-3 py-2">
                <span className="w-3 h-3 rounded-full bg-destructive border border-foreground" />
                <span className="w-3 h-3 rounded-full bg-secondary border border-foreground" />
                <span className="w-3 h-3 rounded-full bg-primary border border-foreground" />
                <span className="ml-2 text-xs font-semibold text-muted-foreground">live preview</span>
              </div>
              <div className="p-3 sm:p-4">
                <AnimatedHeroDemo />
              </div>
            </div>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            {featureList.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="relative border-2 border-foreground bg-card p-6 hard-shadow-sm hover:hard-shadow hover:-translate-y-0.5 transition-all"
                >
                  <span className="absolute top-4 right-4 text-xs font-bold text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="w-10 h-10 border-2 border-foreground bg-secondary text-secondary-foreground flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{f.title}</h3>
                  <p className="text-muted-foreground text-sm">{f.description}</p>
                </div>
              );
            })}
          </div>

        </div>
      </section>
      <Footer />
    </>
  );
};
