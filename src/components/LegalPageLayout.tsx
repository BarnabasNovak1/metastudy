import { ReactNode } from "react";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";

interface LegalPageLayoutProps {
  title: string;
  seoTitle: string;
  seoDescription: string;
  canonicalPath: string;
  breadcrumbLabel: string;
  subtitle?: string;
  lastUpdated?: string;
  children: ReactNode;
}

export const LegalPageLayout = ({
  title,
  seoTitle,
  seoDescription,
  canonicalPath,
  breadcrumbLabel,
  subtitle,
  lastUpdated,
  children,
}: LegalPageLayoutProps) => {
  return (
    <div className="min-h-screen">
      <SEO
        title={seoTitle}
        description={seoDescription}
        canonical={window.location.origin + canonicalPath}
        ogImage={window.location.origin + "/metastudy-og.png"}
      />

      {/* Top nav (shared across all public pages) */}
      <SiteHeader />

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <PageBreadcrumbs items={[{ label: breadcrumbLabel }]} />
      </div>

      {/* Header */}
      <section className="relative overflow-hidden border-b-2 border-foreground">
        <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-60" />
        <div className="max-w-7xl mx-auto px-4 pt-10 pb-8 relative">
          <p className="text-sm font-bold uppercase tracking-widest text-primary mb-2">{breadcrumbLabel}</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-3 text-lg">{subtitle}</p>}
          {lastUpdated && <p className="text-xs text-muted-foreground mt-3">Last updated: {lastUpdated}</p>}
        </div>
      </section>

      {/* Content */}
      <section className="py-6">
        <div className="max-w-7xl mx-auto px-4 space-y-6">
          {children}
        </div>
      </section>

      <Footer />
    </div>
  );
};
