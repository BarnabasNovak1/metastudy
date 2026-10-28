import { Hero } from "@/components/Hero";
import { useEffect, useState } from "react";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { syncCheckoutSession } from "@/lib/billing";
import { SEO } from "@/components/SEO";
import { auth } from "../../firebase";

const Index = () => {
  
  const [, setIsDark] = useState<boolean>(false);
  
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  // Post-checkout sync
  useEffect(() => {
    const url = new URL(window.location.href);
    const checkoutSessionId = url.searchParams.get('session_id');
    const isCheckoutSuccess = url.searchParams.get('checkout') === 'success';
    const isAddonSuccess = url.searchParams.get('addon') === 'success';
    if (!checkoutSessionId || (!isCheckoutSuccess && !isAddonSuccess)) return;

    (async () => {
      try {
        await syncCheckoutSession(checkoutSessionId);
        // Signed billing events own fulfillment. Refresh claims, then let the
        // profile listener display the server-confirmed entitlement.
        await auth.currentUser?.getIdToken(true);
      } catch (e) {
        // ignore
      } finally {
        url.searchParams.delete('session_id');
        url.searchParams.delete('checkout');
        url.searchParams.delete('addon');
        window.history.replaceState({}, '', url.toString());
      }
    })();
  }, []);

  
  return (
    <div className="min-h-screen">
      <SEO
        title="MetaStudy — Turn Notes Into Knowledge | AI Flashcards, Quizzes & Study Chat"
        description="MetaStudy turns your notes, slides, and PDFs into flashcards, quizzes, summaries, and a personal study chat — powered by Meta's Llama models. Free to try."
        keywords={[
          "AI study app", "AI flashcard generator", "AI quiz maker",
          "AI homework helper", "study together app", "study groups online", "study challenges",
          "flashcard maker", "quiz maker for students", "AI tutor", "AI note summarizer",
          "MetaStudy", "metastudy", "free AI flashcards", "AI study tools",
          "homework help AI", "flashcard generator from notes", "AI quiz generator", "learn with AI",
          "Llama AI study", "Meta AI study tools"
        ]}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "MetaStudy",
            "alternateName": ["MetaStudy", "metastudy"],
            "url": window.location.origin,
            "logo": window.location.origin + "/metastudy-logo-full.png",
            "description": "MetaStudy turns notes, slides, and PDFs into flashcards, quizzes, summaries, and a personal AI study chat.",
            "foundingDate": "2026",
            "industry": "Educational Technology",
            "keywords": "MetaStudy, AI study tools, AI flashcard generator, AI quiz maker, homework help, metastudy",
            "contactPoint": {
              "@type": "ContactPoint",
              "contactType": "customer service",
              "availableLanguage": "English"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "MetaStudy",
            "url": window.location.origin,
            "description": "MetaStudy turns your notes into flashcards, quizzes, summaries, and a personal AI study chat — powered by Meta's Llama models.",
            "potentialAction": {
              "@type": "SearchAction",
              "target": window.location.origin + "/study?q={search_term_string}",
              "query-input": "required name=search_term_string"
            },
            "audience": {
              "@type": "Audience",
              "audienceType": "Students, Learners, Early Career Professionals"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "MetaStudy",
            "applicationCategory": "EducationalApplication",
            "operatingSystem": "Web Browser",
            "description": "MetaStudy turns your notes into flashcards, quizzes, summaries, and a personal AI study chat. Powered by Meta's Llama models.",
            "url": window.location.origin,
            "screenshot": window.location.origin + "/metastudy-og.png",
            "featureList": [
              "AI Flashcard Generator from your own notes",
              "AI Quiz Maker with AI-graded short answers",
              "Study Buddy companion plus a lesson Planner & Creator",
              "AI Study Chat with personality modes",
              "AI Summarizer for dense materials",
              "Handwriting OCR from photos",
              "Resume Builder and AI resume grading",
              "LinkedIn Post Generator",
              "Mock Interview practice",
              "Career Recommendations",
              "Study Feed community challenges",
              "Private study groups with invite codes",
              "Manual creation for every tool",
              "Progress tracking, streaks, and achievements"
            ],
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD",
              "availability": "https://schema.org/InStock",
              "url": window.location.origin + "/pricing"
            },
            "author": {
              "@type": "Organization",
              "name": "metastudy-e1ba2.web.app"
            }
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
              {
                "@type": "Question",
                "name": "What is the best AI study helper for students?",
                "acceptedAnswer": { "@type": "Answer", "text": "MetaStudy is an AI study platform that turns your own notes, files, and photos of handwriting into flashcards, quizzes, summaries, and study plans — plus a study chat, community challenges, and career tools, all in one app." }
              },
              {
                "@type": "Question",
                "name": "What AI powers MetaStudy?",
                "acceptedAnswer": { "@type": "Answer", "text": "MetaStudy runs on Meta's Llama models via the official Llama API. All tools are purpose-built for studying, so no prompt engineering is needed — you get flashcards, quizzes with AI-graded short answers, summaries, and lesson plans directly from your notes." }
              },
              {
                "@type": "Question",
                "name": "Is MetaStudy safe for students?",
                "acceptedAnswer": { "@type": "Answer", "text": "MetaStudy is designed as a study aid for students 13 and up. It has no ads, sells no data, keeps content private by default, and uses AI responsibly with clear disclosure." }
              },
              {
                "@type": "Question",
                "name": "Can I study together with friends on MetaStudy?",
                "acceptedAnswer": { "@type": "Answer", "text": "Yes. The Study Feed lets you share your own flashcards, quizzes, summaries, and lessons as challenges and join challenges made by other students, with leaderboards. You can also create private study groups with invite codes." }
              },
              {
                "@type": "Question",
                "name": "Can I make flashcards and quizzes manually without AI?",
                "acceptedAnswer": { "@type": "Answer", "text": "Yes. Every tool works both ways: generate materials with AI from your notes, or build flashcards and quizzes by hand. For short-answer questions you can write the sample answer yourself, and the AI grades responses against it." }
              }
            ]
          }
        ]}
        canonical={window.location.origin + "/"}
        ogImage={window.location.origin + "/metastudy-og.png"}
      />
      <SiteHeader />
      <div id="top"><Hero /></div>
      <section className="border-t-2 border-foreground bg-muted/60">
        <div className="max-w-5xl mx-auto px-4 py-16">
          <div className="mb-10">
            <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">Quick answers</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Common questions</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm">
              <h3 className="font-bold mb-2">What is MetaStudy?</h3>
              <p className="text-sm text-muted-foreground">MetaStudy turns your own notes, files, and photos of handwriting into flashcards, quizzes, summaries, and study plans — plus a study chat, community challenges, and career tools, all in one app.</p>
            </div>
            <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm">
              <h3 className="font-bold mb-2">What AI does MetaStudy use?</h3>
              <p className="text-sm text-muted-foreground">Meta's Llama models via the official Llama API. Because every tool is purpose-built for studying, there's no prompt engineering — you drop in material and get flashcards, quizzes with AI-graded short answers, summaries, and lesson plans out.</p>
            </div>
            <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm">
              <h3 className="font-bold mb-2">Is MetaStudy safe for students?</h3>
              <p className="text-sm text-muted-foreground">MetaStudy is designed as a study aid for students 13 and up. It has no ads, sells no data, keeps content private by default, and uses AI responsibly with clear disclosure.</p>
            </div>
            <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm">
              <h3 className="font-bold mb-2">Can I study with friends?</h3>
              <p className="text-sm text-muted-foreground">Yes. The Study Feed lets you share flashcards, quizzes, summaries, and lessons as challenges and join ones other students made, with leaderboards. Private study groups use invite codes.</p>
            </div>
            <div className="border-2 border-foreground bg-card p-5 hard-shadow-sm md:col-span-2">
              <h3 className="font-bold mb-2">Can I make materials manually, without AI?</h3>
              <p className="text-sm text-muted-foreground">Yes. Every tool works both ways: generate with AI from your notes, or build flashcards and quizzes by hand. For short-answer questions you write the sample answer and the AI grades responses against it.</p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
      
    </div>
  );
};

export default Index;
