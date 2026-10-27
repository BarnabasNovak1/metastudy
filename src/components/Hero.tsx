import { Button } from "@/components/ui/button";
import {
  ArrowRight, BookOpen, GraduationCap, MessageSquare, BookText, Briefcase,
  FileText, Users, MessagesSquare, Upload, Wand2, Repeat2, PenLine, ScanText, Flame
} from "lucide-react";
import { AnimatedHeroDemo } from "./AnimatedHeroDemo";

const tickerItems = [
  "Flashcards", "Quizzes", "Summaries", "Study Chat", "Lessons",
  "Resume Builder", "Mock Interviews", "Essay Grader",
  "Handwriting Scan", "Study Feed", "Study Groups", "Streaks",
];

const steps = [
  {
    num: "01",
    title: "Drop your material",
    text: "Notes, slides, PDFs, photos of handwriting — throw in whatever you have.",
    icon: Upload,
  },
  {
    num: "02",
    title: "Pick a tool",
    text: "Flashcards, a quiz, a summary, a full lesson plan — or just ask the study chat to explain it.",
    icon: Wand2,
  },
  {
    num: "03",
    title: "Drill it till it sticks",
    text: "Test yourself, retry what you missed, share sets with friends, and keep your streak alive.",
    icon: Repeat2,
  },
];

const toolbox = [
  {
    icon: BookOpen,
    title: "Flashcards",
    text: "Decks generated from your own notes, with spaced repetition built in — or build them by hand.",
    span: "sm:col-span-2",
  },
  {
    icon: GraduationCap,
    title: "Quizzes",
    text: "AI-graded short answers, not just multiple choice.",
    span: "",
  },
  {
    icon: MessageSquare,
    title: "Study Chat",
    text: "A tutor that re-explains things differently until they click. Pick a personality or write your own.",
    span: "",
  },
  {
    icon: FileText,
    title: "Summaries",
    text: "Forty-page reading to a one-page brief before your coffee cools.",
    span: "",
  },
  {
    icon: BookText,
    title: "Lesson Plans",
    text: "Step-by-step lessons generated on any topic you're working through.",
    span: "",
  },
  {
    icon: ScanText,
    title: "Handwriting Scan",
    text: "Photograph your notebook or whiteboard — handwriting becomes searchable, usable text.",
    span: "sm:col-span-2",
  },
  {
    icon: Briefcase,
    title: "Career Tools",
    text: "Resume reviews, LinkedIn drafts, mock interviews, and role ideas built on what you've studied.",
    span: "sm:col-span-2",
  },
  {
    icon: Users,
    title: "Study Feed & Groups",
    text: "Post your sets as challenges, climb leaderboards, or spin up a private group with an invite code.",
    span: "",
  },
];

export const Hero = () => {
  return (
    <>
      {/* ============ HERO — split editorial layout ============ */}
      <section className="relative overflow-hidden border-b-2 border-foreground/80 bg-[image:var(--gradient-hero)]">
        <div className="absolute inset-0 bg-grid-pattern opacity-60 pointer-events-none" />

        <div className="container relative z-10 mx-auto px-4 pt-10 pb-14 sm:pt-16 sm:pb-20">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center max-w-6xl mx-auto">

            {/* Left: copy */}
            <div className="space-y-6 text-left">
              <div className="inline-flex items-center gap-2 border-2 border-foreground/80 bg-secondary text-secondary-foreground px-3 py-1.5 hard-shadow-sm">
                <Flame className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest">
                  Powered by Meta Llama
                </span>
              </div>

              <h1 className="text-4xl sm:text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight">
                Exam week doesn't stand a chance.
              </h1>

              <p className="text-lg sm:text-xl text-muted-foreground max-w-xl">
                Feed MetaStudy your notes, slides, and PDFs. Get back
                flashcards, quizzes, summaries, and a study chat that actually
                knows your material — in minutes, not all-nighters.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="hero"
                  size="lg"
                  className="group"
                  onClick={() => (window.location.href = "/auth?mode=signup")}
                >
                  Start studying free
                  <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-2 border-foreground/80 font-semibold"
                  onClick={() => (window.location.href = "/Features")}
                >
                  See what's inside
                </Button>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-3 text-sm font-medium">
                <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-secondary border border-foreground inline-block" /> Free to start</span>
                <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-primary border border-foreground inline-block" /> No credit card</span>
                <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 bg-foreground inline-block" /> No ads, ever</span>
              </div>
            </div>

            {/* Right: framed live demo */}
            <div className="relative">
              <div className="border-2 border-foreground bg-card hard-shadow">
                <div className="flex items-center gap-2 border-b-2 border-foreground bg-muted px-3 py-2">
                  <span className="w-3 h-3 rounded-full bg-destructive border border-foreground" />
                  <span className="w-3 h-3 rounded-full bg-secondary border border-foreground" />
                  <span className="w-3 h-3 rounded-full bg-primary border border-foreground" />
                  <span className="ml-2 text-xs font-semibold text-muted-foreground truncate">metastudy — live preview</span>
                </div>
                <div className="p-3 sm:p-4">
                  <AnimatedHeroDemo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TICKER ============ */}
      <div className="border-b-2 border-foreground bg-secondary text-secondary-foreground overflow-hidden" aria-hidden>
        <div className="flex whitespace-nowrap animate-ticker w-max py-2.5">
          {[...tickerItems, ...tickerItems].map((item, i) => (
            <span key={i} className="flex items-center text-sm font-bold uppercase tracking-widest">
              <span className="px-5">{item}</span>
              <span className="text-secondary-foreground/50">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* ============ HOW IT WORKS ============ */}
      <section className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 sm:mb-16 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">The workflow</p>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
                Three steps. Zero busywork.
              </h2>
            </div>
            <p className="text-muted-foreground max-w-sm text-left sm:text-right">
              No prompt engineering, no templates to wrestle. Your material in,
              study tools out.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.num}
                  className="relative border-2 border-foreground bg-card p-6 hard-shadow hover:-translate-y-1 transition-transform"
                >
                  <span className="absolute -top-5 -left-2 bg-secondary text-secondary-foreground border-2 border-foreground px-3 py-1 text-lg font-bold hard-shadow-sm">
                    {step.num}
                  </span>
                  <Icon className="w-8 h-8 mt-4 mb-4 text-primary" />
                  <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                  <p className="text-muted-foreground">{step.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============ TOOLBOX — bento grid ============ */}
      <section className="border-y-2 border-foreground bg-muted/60 py-16 sm:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="mb-12 sm:mb-16">
              <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">The toolbox</p>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight max-w-3xl">
                Every study tool you were juggling in five tabs
              </h2>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {toolbox.map((tool) => {
                const Icon = tool.icon;
                return (
                  <div
                    key={tool.title}
                    className={`border-2 border-foreground bg-card p-5 hard-shadow-sm hover:hard-shadow hover:-translate-y-0.5 transition-all ${tool.span}`}
                  >
                    <div className="w-10 h-10 border-2 border-foreground bg-secondary flex items-center justify-center mb-4">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold mb-1.5">{tool.title}</h3>
                    <p className="text-sm text-muted-foreground">{tool.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ============ WHY DIFFERENT ============ */}
      <section className="container mx-auto px-4 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">Why MetaStudy</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
              Your notes are the prompt.
            </h2>
            <p className="text-lg text-muted-foreground mb-6">
              Generic chatbots make you write clever prompts and paste context
              over and over. MetaStudy already has your material — every tool
              works on it directly.
            </p>
            <ul className="space-y-3">
              <li className="flex items-start gap-3 font-medium">
                <PenLine className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                Manual mode everywhere — build cards and quizzes by hand when you want control.
              </li>
              <li className="flex items-start gap-3 font-medium">
                <MessagesSquare className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                Ask any document a question and get an answer grounded in your files.
              </li>
              <li className="flex items-start gap-3 font-medium">
                <ScanText className="w-5 h-5 mt-0.5 text-primary shrink-0" />
                Snap a photo of handwritten notes — they become material every tool can use.
              </li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-5">
            {[
              { stat: "15+", label: "study & career tools in one place" },
              { stat: "0", label: "prompts to write or ads to dodge" },
              { stat: "1 click", label: "from notes to quiz or deck" },
              { stat: "13+", label: "ages welcome — private by default" },
            ].map((item) => (
              <div key={item.label} className="border-2 border-foreground bg-card p-5 hard-shadow-sm text-center">
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-1">{item.stat}</div>
                <div className="text-xs sm:text-sm text-muted-foreground font-medium">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="border-t-2 border-foreground bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-16 sm:py-20 text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Tonight's homework is tomorrow's head start.
          </h2>
          <p className="text-lg text-primary-foreground/80 max-w-xl mx-auto mb-8">
            Make an account, drop in one document, and see what it gives you back.
          </p>
          <Button
            variant="hero"
            size="lg"
            className="group"
            onClick={() => (window.location.href = "/auth?mode=signup")}
          >
            Create free account
            <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </section>
    </>
  );
};
