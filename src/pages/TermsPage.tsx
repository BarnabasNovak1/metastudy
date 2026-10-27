import { LegalPageLayout } from "@/components/LegalPageLayout";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
    <h2 className="text-xl md:text-2xl font-semibold">{title}</h2>
    <div className="text-sm md:text-base text-muted-foreground mt-3 leading-relaxed space-y-3">{children}</div>
  </div>
);

const TermsPage = () => {
  return (
    <LegalPageLayout
      title="Terms of Service"
      subtitle="The rules for using MetaStudy, in plain language."
      seoTitle="Terms of Service | MetaStudy"
      seoDescription="MetaStudy Terms of Service: account use, age requirements, academic integrity, acceptable use, AI limitations, payments, and termination."
      canonicalPath="/terms"
      breadcrumbLabel="Terms"
      lastUpdated="October 2026"
    >
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

      <Section title="Academic integrity">
        <p>
          MetaStudy is a study aid. It exists to help you learn, practice, and understand material. You are responsible
          for following your school's academic integrity policies. Do not use MetaStudy to complete graded work where AI
          assistance is prohibited, or to misrepresent AI-generated work as your own.
        </p>
      </Section>

      <Section title="Acceptable use">
        <ul className="list-disc pl-5 space-y-2">
          <li>No illegal content or activity.</li>
          <li>No harassment, hate speech, or abusive behavior toward other users.</li>
          <li>No attempts to bypass security controls, rate limits, or usage quotas.</li>
          <li>No scraping, reselling, or automated abuse of the service.</li>
          <li>No uploading content you do not have the right to use.</li>
        </ul>
      </Section>

      <Section title="AI limitations">
        <p>
          AI-generated responses can be inaccurate, incomplete, or inappropriate for your context. MetaStudy does not
          guarantee factual accuracy or correct answers. Always verify important information against trusted sources.
        </p>
      </Section>

      <Section title="Payments and subscriptions">
        <p>
          Paid plans are billed through Stripe. Quotas reset on your billing cycle. You can cancel anytime; access
          continues until the end of the paid period. Add-on purchases are non-refundable once consumed.
        </p>
      </Section>

      <Section title="Intellectual property">
        <p>
          You retain rights to the content you create and upload. You grant MetaStudy the limited rights needed to
          operate the service (storing, processing, and displaying your content back to you and to users you share with).
          MetaStudy's software, branding, and design remain our property.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You can delete your account at any time from Account settings. We may suspend or terminate accounts that
          violate these terms, with moderation actions logged and reviewable.
        </p>
      </Section>
    </LegalPageLayout>
  );
};

export default TermsPage;
