import { LegalPageLayout } from "@/components/LegalPageLayout";
import { Link } from "react-router-dom";
import { ShieldCheck, Lock, KeyRound, Server, Eye, Trash2 } from "lucide-react";

const Card = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
    <div className="flex items-center gap-2">
      <Icon className="w-5 h-5 text-primary" />
      <h2 className="text-lg md:text-xl font-semibold">{title}</h2>
    </div>
    <div className="text-sm md:text-base text-muted-foreground mt-3 leading-relaxed space-y-2">{children}</div>
  </div>
);

const SecurityPage = () => {
  return (
    <LegalPageLayout
      title="Security"
      subtitle="Security is built into MetaStudy's architecture, not bolted on."
      seoTitle="Security | MetaStudy"
      seoDescription="How MetaStudy protects user accounts, educational content, and personal information: encryption, access controls, server-side authorization, and more."
      canonicalPath="/security"
      breadcrumbLabel="Security"
      lastUpdated="August 2026"
    >
      <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
          We use technical and organizational safeguards designed to protect user accounts, educational content, and
          personal information. Below is an accurate description of our current practices. We do not claim third-party
          certifications we have not completed.
        </p>
      </div>

      <Card icon={Lock} title="Encryption">
        <p>All traffic between your device and our servers is encrypted in transit (HTTPS/TLS).</p>
        <p>Data stored in our infrastructure (Google Cloud / Firebase) is encrypted at rest by the platform.</p>
      </Card>

      <Card icon={KeyRound} title="Authentication and access control">
        <p>Accounts are protected by Firebase Authentication (email/password and Google Sign-In) with secure session handling.</p>
        <p>Role-based access control is enforced with server-issued custom claims. Roles are set only by backend functions, never by clients.</p>
        <p>Sensitive account fields (plan, quotas, username) can only be modified by server-side functions.</p>
      </Card>

      <Card icon={ShieldCheck} title="Private-by-default data">
        <p>Your study content is readable only by you unless you explicitly share it to the community feed.</p>
        <p>Authorization is enforced by database security rules on the server. Manipulating the app interface cannot grant access to another user's data.</p>
        <p>Uploaded files are stored in per-user storage paths that only the authenticated owner can access.</p>
      </Card>

      <Card icon={Server} title="API and AI security">
        <p>AI provider API keys live only on our backend. The browser and mobile apps never contain private AI keys.</p>
        <p>Every AI request passes through authentication, authorization, input validation, and rate limiting before reaching the AI provider.</p>
        <p>Usage quotas and file-size limits protect against abuse.</p>
      </Card>

      <Card icon={Eye} title="Monitoring and incident response">
        <p>Backend errors are monitored (Sentry) so we can detect and fix reliability and security issues quickly.</p>
        <p>Payment processing is delegated entirely to Stripe; we never store card numbers.</p>
        <p>Security reports can be submitted through the Report Issue tool in the app footer.</p>
      </Card>

      <Card icon={Trash2} title="Data deletion">
        <p>You can delete individual content in the app at any time.</p>
        <p>Full account deletion is self-serve and removes your profile, content, files, posts, and payment linkage, and cancels active subscriptions.</p>
      </Card>

      <div className="rounded-2xl border bg-card/60 backdrop-blur p-4 md:p-6">
        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
          For institutional evaluations, see our <Link to="/privacy#trust" className="underline hover:text-foreground">Compliance section</Link>.
        </p>
      </div>
    </LegalPageLayout>
  );
};

export default SecurityPage;
