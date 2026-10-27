import { LegalPageLayout } from "@/components/LegalPageLayout";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, HeartHandshake } from "lucide-react";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
    <h2 className="text-xl md:text-2xl font-semibold">{title}</h2>
    <div className="text-sm md:text-base text-muted-foreground mt-3 leading-relaxed space-y-3">{children}</div>
  </div>
);

const ResponsibleAIPage = () => {
  return (
    <LegalPageLayout
      title="Responsible AI"
      subtitle="What our AI can do, what it can't guarantee, and the commitments we make."
      seoTitle="Responsible AI | MetaStudy"
      seoDescription="MetaStudy's Responsible AI policy: capabilities, limitations, and our commitments on student data, transparency, and user control."
      canonicalPath="/responsible-ai"
      breadcrumbLabel="Responsible AI"
      lastUpdated="August 2026"
    >
      <Section title="How MetaStudy uses AI">
        <p>
          MetaStudy uses Meta's Llama API to power its study tools. When you use an AI feature, your input is sent
          to our secure backend, validated, and forwarded to the AI provider to generate a response. Private API keys never
          leave our servers, and every request is authenticated and rate-limited.
        </p>
      </Section>

      <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <h2 className="text-xl md:text-2xl font-semibold">What AI can do</h2>
        </div>
        <ul className="list-disc pl-5 space-y-2 text-sm md:text-base text-muted-foreground mt-3">
          <li>Explain concepts in different ways and at different levels.</li>
          <li>Summarize readings, notes, and documents.</li>
          <li>Generate flashcards, quizzes, lessons, and study plans from your material.</li>
          <li>Help you practice with feedback and repetition.</li>
          <li>Support career preparation: resumes, interview practice, and professional writing.</li>
        </ul>
      </div>

      <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
        <div className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-500" />
          <h2 className="text-xl md:text-2xl font-semibold">What AI cannot guarantee</h2>
        </div>
        <ul className="list-disc pl-5 space-y-2 text-sm md:text-base text-muted-foreground mt-3">
          <li>Perfect factual accuracy. AI models can produce confident-sounding mistakes.</li>
          <li>Correct answers every time. Always verify important results.</li>
          <li>Appropriate answers without user judgment. You decide how to use AI output.</li>
        </ul>
        <p className="text-sm md:text-base text-muted-foreground mt-3">
          MetaStudy shows an AI disclosure in the app and encourages verification against trusted sources.
        </p>
      </div>

      <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
        <div className="flex items-center gap-2">
          <HeartHandshake className="w-5 h-5 text-primary" />
          <h2 className="text-xl md:text-2xl font-semibold">Our commitments</h2>
        </div>
        <ul className="list-disc pl-5 space-y-2 text-sm md:text-base text-muted-foreground mt-3">
          <li>We do not sell student or user data.</li>
          <li>We do not build advertising profiles from educational content.</li>
          <li>We clearly explain how AI processes your content (see <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>).</li>
          <li>We do not use your educational content to train our own AI models.</li>
          <li>You can delete your chats, materials, and account at any time.</li>
          <li>Educational content is private by default. Sharing is always an explicit choice.</li>
        </ul>
      </div>

      <Section title="Questions from educators">
        <p>
          If you are a teacher or administrator evaluating MetaStudy, our{" "}
          <Link to="/privacy#trust" className="underline hover:text-foreground">compliance section</Link> answers common vendor-review
          questions about data collection, storage, access, and deletion.
        </p>
      </Section>
    </LegalPageLayout>
  );
};

export default ResponsibleAIPage;
