import { useEffect, useState } from "react";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Plus, Minus, DollarSign, Sparkles, BookOpen, Briefcase, Settings, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";

type FaqCategory = 'all' | 'getting-started' | 'features' | 'pricing' | 'career' | 'account' | 'technical';

const CATEGORIES: { id: FaqCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All Topics', icon: <HelpCircle className="w-4 h-4" /> },
  { id: 'getting-started', label: 'Getting Started', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'features', label: 'Features', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'pricing', label: 'Pricing & Plans', icon: <DollarSign className="w-4 h-4" /> },
  { id: 'career', label: 'Career Tools', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'account', label: 'Account & Billing', icon: <Settings className="w-4 h-4" /> },
  { id: 'technical', label: 'Technical', icon: <Settings className="w-4 h-4" /> },
];

const FaqPage = () => {

  const [, setIsDark] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<FaqCategory>('all');
  const navigate = useNavigate();

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);


  return (
    <div className="min-h-screen">
      <SEO
        title="FAQ | MetaStudy — AI Study Tools"
        description="What MetaStudy is, who it's for, and how it works — flashcards, quizzes, summaries, study chat, and career tools powered by Meta's Llama models."
        keywords={[
          "metastudy-e1ba2.web.app", "FAQ", "help", "support", "study tools", "career tools",
          "MetaStudy", "AI study tools", "Meta Llama", "flashcards",
          "quizzes", "summarizer", "resume builder", "interview prep",
          "lesson generator", "study chat"
        ]}
        jsonLd={[{
          "@context":"https://schema.org",
          "@type":"FAQPage",
          "mainEntity":[
            {"@type":"Question","name":"Who is MetaStudy for?","acceptedAnswer":{"@type":"Answer","text":"Students, professionals, and lifelong learners who want AI-powered study tools and career development in one place."}},
            {"@type":"Question","name":"What tools are included?","acceptedAnswer":{"@type":"Answer","text":"Study Chat, Summarizer, Flashcards, Quiz Generator, Lesson Generator, Resume Grader, LinkedIn Post Writer, Interview Prep, and Career Recommendations."}},
            {"@type":"Question","name":"What powers MetaStudy?","acceptedAnswer":{"@type":"Answer","text":"Meta's Llama models, accessed through the official Llama API."}}
          ]
        }]}
        canonical={window.location.origin + "/faq"}
        ogImage={window.location.origin + "/metastudy-og.png"}
      />
      <SiteHeader />

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <PageBreadcrumbs items={[{ label: "FAQ" }]} />
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden border-b-2 border-foreground">
        <div className="absolute inset-0 bg-grid-pattern opacity-60 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 pt-12 pb-12 relative">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-widest text-primary mb-3">Help center</p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Questions? Answered.
            </h1>
            <p className="text-muted-foreground mt-3 text-lg">Everything you need to know about MetaStudy — features, plans, privacy, and how it all works.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-secondary text-secondary-foreground border-2 border-foreground hard-shadow-sm">Powered by Meta Llama</span>
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-card border-2 border-foreground hard-shadow-sm">No prompt engineering</span>
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-primary text-primary-foreground border-2 border-foreground hard-shadow-sm">Study + career</span>
              <span className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-card border-2 border-foreground hard-shadow-sm">Free plan</span>
            </div>
          </div>
        </div>
      </section>

      {/* Category Filter */}
      <section className="py-6 border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap gap-2 justify-center">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 border-2 text-sm font-bold uppercase tracking-wider transition-all ${
                  activeCategory === cat.id
                    ? 'border-foreground bg-secondary text-secondary-foreground hard-shadow-sm'
                    : 'border-transparent bg-muted hover:border-foreground text-foreground/80 hover:text-foreground'
                }`}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Content */}
      <section id="faq" className="py-8">
        <div className="max-w-4xl mx-auto px-4 space-y-6">

          {/* Getting Started */}
          {(activeCategory === 'all' || activeCategory === 'getting-started') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-semibold">Getting Started</h2>
              </div>
              {[
                {
                  q: "What is MetaStudy?",
                  a: `MetaStudy turns your study materials into tools you can actually learn from. Drop in notes, slides, PDFs, or photos of handwriting — and get back flashcards, quizzes, summaries, and a study chat that knows your material.\n\nWhat's inside:\n• Study Chat with multiple personality modes\n• Smart Summarizer for dense materials\n• Flashcard & Quiz generators (or build by hand)\n• Lesson Generator for structured study plans\n• Essay drafting & AI grading\n• Career tools (resume, LinkedIn, mock interviews)\n• Study Feed — a community for shared challenges`
                },
                {
                  q: "Who is MetaStudy for?",
                  a: `Anyone who studies or builds skills:\n\n• Students — high school through grad school\n• Professionals — job seekers and career switchers\n• Lifelong learners — mastering new skills on their own\n• Educators — creating study materials fast\n\nIf you learn things and want to remember them, MetaStudy fits.`
                },
                {
                  q: "How is this different from a regular AI chatbot?",
                  a: `General chatbots make you do the prompting. MetaStudy gives you purpose-built tools:\n\n• No prompt engineering — pick a tool, get the result\n• Structured outputs: real flashcard decks, real quizzes\n• Career tools tied to what you've actually studied\n• Streaks, achievements, and progress tracking\n• A study feed where you can share and compete\n\nIt's a study platform with AI inside — not a chat window.`
                },
                {
                  q: "Do I need any technical skills?",
                  a: `None. Choose a tool, drop in your material, and MetaStudy handles the rest. No prompts to write, no settings to tune.`
                },
                {
                  q: "What AI does MetaStudy use?",
                  a: `MetaStudy runs on Meta's Llama models via the official Llama API (api.llama.com). Prompts are tuned for educational content, and the models improve over time — so the tools keep getting better without you doing anything.`
                }
              ].map((item, idx) => (
                <FaqItem key={`gs-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

          {/* Features */}
          {(activeCategory === 'all' || activeCategory === 'features') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-semibold">Study & Learning Features</h2>
              </div>
              {[
                {
                  q: "What study tools are included?",
                  a: `The full toolkit:\n\n• Study Chat: a tutor that adapts to how you learn\n• Summarizer: condense long content into key points\n• Flashcards: auto-generate decks or write your own\n• Quiz Generator: multiple choice, true/false, fill-in-blank\n• Lesson Generator: complete lesson plans with sections\n• Essay Writer & Grader: drafts plus detailed feedback\n• Study Feed: share sets, join challenges, climb leaderboards`
                },
                {
                  q: "How does Study Chat work?",
                  a: `Study Chat keeps your materials in context and explains things however helps them stick. Pick a personality mode — friendly tutor, strict professor, Socratic guide, and more — or write your own system prompt. It remembers the conversation and can work with uploaded files.`
                },
                {
                  q: "Can it read my handwritten notes?",
                  a: `Yes. Snap a photo of a notebook, whiteboard, or worksheet and MetaStudy converts it to text with vision AI. From there you can summarize it, quiz yourself on it, or turn it into flashcards.`
                },
                {
                  q: "What is the Lesson Generator?",
                  a: `Give it a topic or upload a file (PDF, image, document) and it builds a complete lesson:\n\n• Sections with learning objectives\n• Explanations and worked examples\n• Auto-generated flashcards per lesson\n• A quiz to test understanding\n• Study duration estimates`
                },
                {
                  q: "What is the Study Feed?",
                  a: `A community layer for study materials:\n\n• Publish your flashcards, quizzes, and summaries as challenges\n• Join challenges other students created\n• Leaderboards, reactions, and comments\n• Private study groups with invite codes\n• Save anything to your own library`
                },
                {
                  q: "Can I make materials without the AI?",
                  a: `Yes — every generator has a manual mode. Write flashcards and quiz questions by hand, including short-answer questions that get graded by AI against a sample answer you provide.`
                }
              ].map((item, idx) => (
                <FaqItem key={`f-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

          {/* Pricing */}
          {(activeCategory === 'all' || activeCategory === 'pricing') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-semibold">Pricing & Plans</h2>
              </div>
              {[
                {
                  q: "What plans are available?",
                  a: `Four plans:\n\nFree — $0/month\n• 5 uses/month, 3,000 words per use\n• Study Chat, Summarizer, Flashcards\n• No credit card required\n\nBasic — $9.99/month\n• 50 uses/month, 5,000 words per use\n• + Quiz Generator\n\nAdvanced — $16.99/month (most popular)\n• 200 uses/month, 7,000 words per use\n• + Lesson Generator, Career tools, Study Feed\n\nPro — $19.99/month\n• 500 uses/month, 15,000 words per use\n• Everything unlocked`
                },
                {
                  q: "What counts as a 'use'?",
                  a: `One AI generation equals one use:\n\n• A chat message = 1 use\n• A summary = 1 use\n• A flashcard deck = 1 use\n• A quiz = 1 use\n• An essay grade = 1 use\n\nViewing saved content, browsing the feed, and account actions don't count.`
                },
                {
                  q: "What if I run out of uses?",
                  a: `A few options:\n\n• Buy add-on packs: $1 for +10 uses\n• Add-ons keep your plan's word limit\n• Upgrade to a higher plan anytime\n• Usage resets monthly on your billing date\n• Track everything in your Account dashboard`
                },
                {
                  q: "Can I upgrade or downgrade?",
                  a: `Anytime:\n\n• Upgrades apply immediately\n• Downgrades take effect at the next billing cycle\n• No contracts, no lock-in\n• Manage it all in Account → Manage Billing`
                },
                {
                  q: "Is there a free trial?",
                  a: `The Free plan is the trial — 5 uses a month with no credit card, forever. When you want more, upgrade whenever.`
                }
              ].map((item, idx) => (
                <FaqItem key={`p-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

          {/* Career */}
          {(activeCategory === 'all' || activeCategory === 'career') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="w-5 h-5 text-sky-400" />
                <h2 className="text-xl font-semibold">Career Tools</h2>
              </div>
              {[
                {
                  q: "What career tools are included?",
                  a: `The career toolkit includes:\n\n• Resume Builder: live editor with clean templates\n• Rate My Resume: AI scoring with improvement tips\n• LinkedIn Post Generator: multiple variations per topic\n• Mock Interview: realistic practice with AI feedback\n• Career Recommendations: role ideas based on your history\n\nAvailable on Advanced and Pro plans.`
                },
                {
                  q: "How does Resume Builder work?",
                  a: `• Live WYSIWYG editor\n• Download as PDF\n• AI suggestions while you write\n• "Rate My Resume" scoring (0-100) with specific feedback\n• Save multiple versions for different roles`
                },
                {
                  q: "What does the LinkedIn Generator do?",
                  a: `Pick a topic and a tone — professional, casual, or thought-leadership — and get three post variations you can copy straight to LinkedIn. Built for staying visible without spending an hour per post.`
                },
                {
                  q: "How does Interview Prep work?",
                  a: `Choose an interview type (technical, behavioral, and more), enter the role and company, and practice against realistic questions. You get AI feedback on your answers so you can iterate fast.`
                }
              ].map((item, idx) => (
                <FaqItem key={`c-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

          {/* Account & Billing */}
          {(activeCategory === 'all' || activeCategory === 'account') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-emerald-400" />
                <h2 className="text-xl font-semibold">Account & Billing</h2>
              </div>
              {[
                {
                  q: "How do I manage my subscription?",
                  a: `Go to Account → Management:\n\n• View your plan and usage\n• "Manage Billing" opens the Stripe portal\n• Update payment method, change plans, or cancel\n• See renewal date and usage stats`
                },
                {
                  q: "How do I cancel?",
                  a: `Account → Management → Manage Billing, then cancel in the Stripe portal. You keep access until the end of the billing period — no fees, no gotchas.`
                },
                {
                  q: "What payment methods are accepted?",
                  a: `Payments run through Stripe:\n\n• Credit and debit cards (Visa, Mastercard, Amex)\n• Digital wallets (Apple Pay, Google Pay)\n• Secure, PCI-compliant processing`
                },
                {
                  q: "Can I get a refund?",
                  a: `Full refund within 24 hours of purchase if the product isn't for you. After that, contact support for special circumstances — partial months aren't refunded.`
                },
                {
                  q: "How do I delete my account?",
                  a: `Account → Management → Delete Account. Confirm, and your data is permanently removed. You can always create a new account later.`
                }
              ].map((item, idx) => (
                <FaqItem key={`a-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

          {/* Technical */}
          {(activeCategory === 'all' || activeCategory === 'technical') && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-semibold">Technical & Privacy</h2>
              </div>
              {[
                {
                  q: "What AI powers MetaStudy?",
                  a: `Meta's Llama models, served through the official Llama API:\n\n• Llama handles chat, generation, grading, and vision (reading handwriting and screenshots)\n• Prompts are tuned specifically for educational content\n• Models are upgraded as Meta releases improvements`
                },
                {
                  q: "Is my data private?",
                  a: `Yes:\n\n• Your content is private to your account\n• We don't sell your data\n• Secure authentication via Firebase\n• You can delete everything, anytime\n• See the Privacy Policy for the full details`
                },
                {
                  q: "Does it work on mobile?",
                  a: `Yes — MetaStudy is fully responsive and works on phones, tablets, and desktops. Everything syncs across devices, no separate download required.`
                },
                {
                  q: "What if something isn't working?",
                  a: `Quick fixes first:\n\n• Refresh the page\n• Clear your browser cache\n• Check your connection\n• Try another browser\n\nStill stuck? Use Report Issue in the footer and we'll take a look.`
                }
              ].map((item, idx) => (
                <FaqItem key={`t-${idx}`} question={item.q} answer={item.a} />
              ))}
            </div>
          )}

        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="border-2 border-foreground bg-card hard-shadow p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
            <div className="text-center md:text-left relative">
              <h3 className="text-2xl font-bold">Ready to make your notes work for you?</h3>
              <p className="text-muted-foreground mt-1">Start free — upgrade when you need more.</p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center relative">
              <Button onClick={() => navigate('/pricing')}>See Pricing Plans</Button>
              <Button variant="outline" onClick={() => navigate('/auth')}>Start Free Now</Button>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default FaqPage;

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl overflow-hidden bg-card border transition-all ${open ? 'border-primary/40 shadow-md' : 'border-border'} `}>
      <button
        className="w-full flex items-center justify-between px-4 py-4 hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-lg md:text-xl font-semibold text-foreground text-left pr-4">
          {question}
        </span>
        {open ? <Minus className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
      </button>
      <div
        className={`text-muted-foreground text-base md:text-lg transition-[max-height,opacity] duration-300 overflow-hidden ${open ? 'max-h-[400px] opacity-100 px-4 pb-4 bg-muted/20 pointer-events-auto' : 'max-h-0 opacity-0 px-4 pb-0 bg-transparent pointer-events-none'}`}
      >
        <div className="pt-1 leading-relaxed whitespace-pre-line">{answer}</div>
      </div>
    </div>
  );
}
