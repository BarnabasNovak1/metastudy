import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import { ShieldCheck, Lock, KeyRound, Server, Eye, Trash2, CheckCircle2, XCircle, HeartHandshake, FileText, Scale, School } from "lucide-react";

const SECTIONS = [
  { id: "terms", label: "Terms" },
  { id: "privacy", label: "Privacy" },
  { id: "security", label: "Security" },
  { id: "responsible-ai", label: "Responsible AI" },
  { id: "trust", label: "Compliance" },
  { id: "disclaimer", label: "Disclaimer" },
];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
    <h3 className="text-lg md:text-xl font-semibold">{title}</h3>
    <div className="text-sm md:text-base text-muted-foreground mt-3 leading-relaxed space-y-3">{children}</div>
  </div>
);

const IconSection = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
    <div className="flex items-center gap-2">
      <Icon className="w-5 h-5 text-primary" />
      <h3 className="text-lg md:text-xl font-semibold">{title}</h3>
    </div>
    <div className="text-sm md:text-base text-muted-foreground mt-3 leading-relaxed space-y-2">{children}</div>
  </div>
);

const AnchorHeading = ({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) => (
  <div id={id} className="scroll-mt-28 pt-4">
    <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h2>
    {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
  </div>
);

const scrollToSection = (id: string) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

const PrivacyPage = () => {
  const location = useLocation();

  // Jump to section when arriving with a hash (e.g. from footer links) or when the hash changes
  useEffect(() => {
    const hash = (location.hash || "").replace("#", "");
    if (!hash) return;
    // Delay so layout is ready on first paint
    const t = window.setTimeout(() => scrollToSection(hash), 100);
    return () => window.clearTimeout(t);
  }, [location.hash]);

  return (
    <div className="min-h-screen">
      <SEO
        title="Privacy & Legal | MetaStudy"
        description="MetaStudy privacy and legal hub: Terms of Service, Privacy Policy, Security, Responsible AI, compliance info, and Disclaimer, all in one place."
        canonical={window.location.origin + "/privacy"}
        ogImage={window.location.origin + "/metastudy-og.png"}
      />

      <SiteHeader />

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <PageBreadcrumbs items={[{ label: "Privacy" }]} />
      </div>

      {/* Header */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="max-w-7xl mx-auto px-4 pt-10 pb-4">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Privacy & Legal</h1>
          <p className="text-muted-foreground mt-3 text-lg">Everything about how MetaStudy handles your data, in one place.</p>
          <p className="text-xs text-muted-foreground mt-3">Last updated: August 2026</p>
        </div>
      </section>

      {/* Sticky section jump nav */}
      <div className="sticky top-[73px] md:top-[105px] z-10 bg-background/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className="px-3 py-1 text-sm rounded-full border hover:bg-accent/50 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className="py-6">
        <div className="max-w-7xl mx-auto px-4 space-y-6">

          {/* ============== TERMS ============== */}
          <AnchorHeading id="terms" title="Terms of Service" subtitle="The rules for using MetaStudy, in plain language." />
          <Section title="Overview">
            <p>
              These are the key terms for using MetaStudy in plain language. By creating an account or using the service,
              you agree to them.
            </p>
          </Section>
          <Section title="Accounts and age requirements">
            <p>You must provide accurate information and keep your credentials secure. You are responsible for activity on your account.</p>
            <p>MetaStudy is intended for users aged 13 and older. Users under 18 should use MetaStudy with the consent of a parent, guardian, or their educational institution.</p>
          </Section>
          <Section title="Academic integrity and acceptable use">
            <p>
              MetaStudy is a study aid. It exists to help you learn, practice, and understand material. You are responsible
              for following your school's academic integrity policies.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>No illegal content or activity, harassment, or abusive behavior.</li>
              <li>No attempts to bypass security controls, rate limits, or usage quotas.</li>
              <li>No scraping, reselling, or automated abuse of the service.</li>
              <li>No uploading content you do not have the right to use.</li>
            </ul>
          </Section>
          <Section title="Payments, IP, and termination">
            <p>Paid plans are billed through Stripe. You can cancel anytime; access continues until the end of the paid period.</p>
            <p>You retain rights to the content you create and upload. MetaStudy's software, branding, and design remain our property.</p>
            <p>You can delete your account at any time from Account settings. We may suspend or terminate accounts that violate these terms.</p>
          </Section>

          {/* ============== PRIVACY ============== */}
          <AnchorHeading id="privacy" title="Privacy Policy" subtitle="What MetaStudy collects, why, and the choices you have." />
          <Section title="Overview">
            <p>
              MetaStudy ("we", "us") is an AI study companion operated by MetaStudy LLC. This page is the Privacy Policy.
            </p>
            <p className="font-medium text-foreground">
              We do not sell your personal information, and we do not use your educational content to build advertising profiles.
            </p>
          </Section>
          <Section title="What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-foreground">Account information</span>, email address, name, username, optional profile photo, and optional school/institution affiliation.</li>
              <li><span className="font-medium text-foreground">Educational content you create</span>, chats, summaries, flashcards, quizzes, lessons, study plans, and uploaded files.</li>
              <li><span className="font-medium text-foreground">Usage and quota data</span>, feature usage counts tied to your subscription plan.</li>
              <li><span className="font-medium text-foreground">Payment data</span>, handled by Stripe. We never see or store your full card number.</li>
              <li><span className="font-medium text-foreground">Social features data</span>, content you explicitly share to the community feed, friends, groups, and challenges.</li>
            </ul>
          </Section>
          <Section title="How AI processing works">
            <p>
              When you use an AI feature, your input is sent from your device to our secure backend, which forwards it to
              Meta's Llama API to generate a response. AI provider API keys are kept server-side and never exposed in your browser.
              We do not use your educational content to train our own AI models.
            </p>
            <p>
              Photos and scans you upload (for example, pictures of handwritten notes or scanned PDF pages) are processed by
              the Llama API in memory solely to extract their text. The images themselves are never written to our database or
              file storage and are discarded as soon as the text is returned.
            </p>
          </Section>
          <Section title="Private by default, retention, and your rights">
            <p>
              Your study content is private by default. Others only see what you explicitly share to the community feed.
              Access controls are enforced server-side by database security rules.
            </p>
            <p>
              Your content stays until you delete it. You can delete individual chats and materials, set chat auto-deletion,
              download your data, and delete your entire account from Account settings.
            </p>
            <p>
              Depending on where you live (including EU/EEA under GDPR and various U.S. states), you may have rights to access,
              correct, delete, or export your personal information. Use the in-app controls or the Report Issue tool for any privacy request.
            </p>
          </Section>
          <Section title="Third-party processors">
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-foreground">Google Firebase / Google Cloud</span>, authentication, database, file storage, hosting.</li>
              <li><span className="font-medium text-foreground">Meta Llama API (api.llama.com)</span>, AI response generation.</li>
              <li><span className="font-medium text-foreground">Stripe</span>, payment processing.</li>
              <li><span className="font-medium text-foreground">Resend</span>, transactional email.</li>
              <li><span className="font-medium text-foreground">Sentry</span>, backend error monitoring.</li>
            </ul>
          </Section>
          <Section title="Cookies and analytics">
            <p>
              With your consent (via the cookie banner), we may load privacy-respecting analytics to understand aggregate
              product usage. These tools never load if you decline, and declining does not affect any features. Your
              educational content is never used for advertising or shared with ad networks.
            </p>
          </Section>
          <Section title="Children's privacy">
            <p>
              MetaStudy is intended for users aged 13 and older. We do not knowingly collect personal information from
              children under 13. If you believe a child under 13 has created an account, contact us and we will delete it.
            </p>
          </Section>

          {/* ============== SECURITY ============== */}
          <AnchorHeading id="security" title="Security" subtitle="Security is built into MetaStudy's architecture, not bolted on." />
          <IconSection icon={Lock} title="Encryption">
            <p>All traffic between your device and our servers is encrypted in transit (HTTPS/TLS).</p>
            <p>Data stored in our infrastructure (Google Cloud / Firebase) is encrypted at rest by the platform.</p>
          </IconSection>
          <IconSection icon={KeyRound} title="Authentication and access control">
            <p>Accounts are protected by Firebase Authentication with secure session handling.</p>
            <p>Role-based access control is enforced with server-issued custom claims. Roles are set only by backend functions, never by clients.</p>
            <p>Sensitive account fields (plan, quotas, username) can only be modified by server-side functions.</p>
          </IconSection>
          <IconSection icon={ShieldCheck} title="Private-by-default data">
            <p>Your study content is readable only by you unless you explicitly share it to the community feed.</p>
            <p>Authorization is enforced by database security rules on the server. Manipulating the app interface cannot grant access to another user's data.</p>
            <p>Uploaded files are stored in per-user storage paths that only the authenticated owner can access.</p>
          </IconSection>
          <IconSection icon={Server} title="API and AI security">
            <p>AI provider API keys live only on our backend. The browser and mobile apps never contain private AI keys.</p>
            <p>Every AI request passes through authentication, authorization, input validation, and rate limiting.</p>
          </IconSection>
          <IconSection icon={Eye} title="Monitoring and incident response">
            <p>Backend errors are monitored (Sentry) so we can detect and fix reliability and security issues quickly.</p>
            <p>Security reports can be submitted through the Report Issue tool in the app footer.</p>
          </IconSection>
          <IconSection icon={Trash2} title="Data deletion">
            <p>You can delete individual content in the app at any time.</p>
            <p>Full account deletion is self-serve and removes your profile, content, files, posts, and payment linkage, and cancels active subscriptions.</p>
          </IconSection>

          {/* ============== RESPONSIBLE AI ============== */}
          <AnchorHeading id="responsible-ai" title="Responsible AI" subtitle="What our AI can do, what it can't guarantee, and the commitments we make." />
          <IconSection icon={CheckCircle2} title="What AI can do">
            <ul className="list-disc pl-5 space-y-2">
              <li>Explain concepts in different ways and at different levels.</li>
              <li>Summarize readings, notes, and documents.</li>
              <li>Generate flashcards, quizzes, lessons, and study plans from your material.</li>
              <li>Support career preparation: resumes, interview practice, and professional writing.</li>
            </ul>
          </IconSection>
          <IconSection icon={XCircle} title="What AI cannot guarantee">
            <ul className="list-disc pl-5 space-y-2">
              <li>Perfect factual accuracy. AI models can produce confident-sounding mistakes.</li>
              <li>Correct answers every time. Always verify important results.</li>
              <li>Appropriate answers without user judgment. You decide how to use AI output.</li>
            </ul>
          </IconSection>
          <IconSection icon={HeartHandshake} title="Our commitments">
            <ul className="list-disc pl-5 space-y-2">
              <li>We do not sell student or user data.</li>
              <li>We do not build advertising profiles from educational content.</li>
              <li>We do not use your educational content to train our own AI models.</li>
              <li>You can delete your chats, materials, and account at any time.</li>
              <li>Educational content is private by default. Sharing is always an explicit choice.</li>
            </ul>
          </IconSection>

          {/* ============== TRUST CENTER ============== */}
          <AnchorHeading id="trust" title="Compliance & Schools" subtitle="Everything schools, universities, and privacy officers need to evaluate MetaStudy." />
          <IconSection icon={Scale} title="Compliance approach">
            <p className="font-medium text-foreground">
              MetaStudy is designed to support FERPA-aligned use by educational institutions, subject to each institution's
              own legal, policy, and contractual requirements.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-foreground">FERPA readiness</span>, student information is used only to provide the educational service, is not sold or used for advertising, and is deleted or returned per agreement.</li>
              <li><span className="font-medium text-foreground">COPPA approach</span>, accounts are for users 13+ and signup requires a 13+ attestation. We do not currently support users under 13; if we learn an account belongs to a child under 13, we delete it.</li>
              <li><span className="font-medium text-foreground">GDPR rights</span>, access, correction, deletion, and portability requests are supported for EU/EEA users.</li>
              <li><span className="font-medium text-foreground">U.S. state privacy rights</span>, we support access, correction, deletion, download, and appeal requests regardless of state.</li>
            </ul>
          </IconSection>
          <IconSection icon={School} title="For schools and districts">
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-foreground">Institution accounts</span>, email-domain-based institution recognition and institution plans are supported today.</li>
              <li><span className="font-medium text-foreground">Data Processing Agreement</span>, available on request for institutional deployments.</li>
              <li><span className="font-medium text-foreground">Security questionnaires</span>, we respond to standard vendor security questionnaires.</li>
              <li><span className="font-medium text-foreground">Subprocessors</span>, Google Firebase/GCP, Meta Llama API, Stripe, Resend, Sentry.</li>
              <li><span className="font-medium text-foreground">Contact</span>, school privacy officers can reach us through the Report Issue tool in the footer.</li>
            </ul>
          </IconSection>

          {/* ============== DISCLAIMER ============== */}
          <AnchorHeading id="disclaimer" title="Disclaimer" subtitle="Important limitations you should know about." />
          <IconSection icon={FileText} title="Disclaimer">
            <p>
              AI-generated responses can be inaccurate, incomplete, or inappropriate for your context. MetaStudy does not
              guarantee factual accuracy or correct answers, and is not a substitute for professional academic, legal, medical,
              or financial advice. Always verify important information against trusted sources.
            </p>

          </IconSection>

        </div>
      </section>

      <Footer />
    </div>
  );
};

export default PrivacyPage;
