import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle, Building2, ChevronDown } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { functions as fbFunctions } from "../../firebase";
import { httpsCallable } from "firebase/functions";
import { useToast } from "@/hooks/use-toast";
import { Pricing } from "@/components/Pricing";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";

const PricingPage = () => {
  
  const [, setIsDark] = useState<boolean>(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
  
  // Institution contact form state
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactForm, setContactForm] = useState({
    institutionName: '',
    contactName: '',
    contactEmail: '',
    estimatedUsers: '',
    preferredPlan: '',
    message: '',
    website: '', // honeypot
  });

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initialDark = saved !== "light";
    setIsDark(initialDark);
    document.documentElement.classList.toggle("dark", initialDark);
  }, []);

  useEffect(() => {
    const src = "https://js.stripe.com/v3/pricing-table.js";
    const existing = Array.from(document.getElementsByTagName('script')).some(s => s.src === src);
    if (!existing) {
      const s = document.createElement('script');
      s.async = true;
      s.src = src;
      document.body.appendChild(s);
    }
  }, []);

  
  // Open contact form when ?contact=institution is present
  useEffect(() => {
    if (searchParams.get('contact') === 'institution') {
      setContactOpen(true);
      setContactSubmitted(false);
    }
  }, [searchParams]);

  const handleContactClose = () => {
    setContactOpen(false);
    setContactSubmitted(false);
    // Remove query param
    searchParams.delete('contact');
    setSearchParams(searchParams, { replace: true });
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (contactSubmitting) return;
    
    if (!contactForm.institutionName.trim()) {
      toast({ title: 'Required', description: 'Please enter your institution name', variant: 'destructive' });
      return;
    }
    if (!contactForm.contactName.trim()) {
      toast({ title: 'Required', description: 'Please enter your name', variant: 'destructive' });
      return;
    }
    if (!contactForm.contactEmail.trim() || !contactForm.contactEmail.includes('@')) {
      toast({ title: 'Required', description: 'Please enter a valid email address', variant: 'destructive' });
      return;
    }
    
    setContactSubmitting(true);
    try {
      const submitInquiry = httpsCallable(fbFunctions, 'submitInstitutionInquiry');
      await submitInquiry({
        institutionName: contactForm.institutionName.trim(),
        contactName: contactForm.contactName.trim(),
        contactEmail: contactForm.contactEmail.trim(),
        estimatedUsers: parseInt(contactForm.estimatedUsers) || 0,
        preferredPlan: contactForm.preferredPlan,
        message: contactForm.message.trim(),
        website: contactForm.website, // honeypot - always empty for humans
      });
      setContactSubmitted(true);
      toast({ title: 'Inquiry Submitted!', description: 'We\'ll get back to you within 24 hours.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed to submit inquiry', variant: 'destructive' });
    } finally {
      setContactSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SEO
        title="Pricing | MetaStudy, Free AI Study Tools & Plans"
        description="MetaStudy pricing — start free with AI flashcards, quizzes & study chat. Upgrade for higher limits, lessons, and career tools."
        keywords={[
          "MetaStudy pricing", "AI study tools pricing", "AI flashcards pricing",
          "AI quiz generator pricing", "AI tutor subscription", "Quizlet alternative pricing",
          "affordable AI learning", "AI education pricing", "AI study partner plans",
          "AI study tools free", "free AI flashcards", "free AI quiz generator", "free resume grader AI",
          "MetaStudy free plan", "AI learning free plan", "student AI tools",
          "career launchpad pricing", "AI career tools cost", "AI resume builder pricing",
          "AI interview prep pricing", "early career AI tools", "professional development AI",
          "study feed pricing", "AI study community", "social learning platform cost",
          "metastudy-e1ba2.web.app pricing", "metastudy-e1ba2.web.app plans", "metastudy-e1ba2.web.app subscription",
          "AI study assistant pricing", "intelligent tutoring cost", "personalized learning pricing",
          "Meta Llama", "Llama AI", "powered by Llama"
        ]}
        jsonLd={[{
          "@context":"https://schema.org",
          "@type":"SoftwareApplication",
          "name":"metastudy-e1ba2.web.app",
          "applicationCategory":"EducationalApplication",
          "operatingSystem":"Web",
          "offers": {"@type":"AggregateOffer","priceCurrency":"USD"}
        }]}
        canonical={origin ? origin + "/pricing" : undefined}
        ogImage={origin ? origin + "/metastudy-og.png" : undefined}
      />
      <SiteHeader />

      {/* Breadcrumbs */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <PageBreadcrumbs items={[{ label: "Pricing" }]} />
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="border-2 border-foreground bg-secondary text-secondary-foreground p-4 hard-shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm sm:text-base font-bold">
            Buying for a school or team? Bulk plans save up to 20%.
          </p>
          <Button
            size="sm"
            variant="hero"
            onClick={() => setContactOpen(true)}
          >
            Get in touch
          </Button>
        </div>
      </div>

      <Pricing />
      <Footer />

      {/* Institution Contact Form Dialog */}
      <Dialog open={contactOpen} onOpenChange={(open) => !open && handleContactClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Institution Pricing Inquiry
            </DialogTitle>
            <DialogDescription>
              Get up to 20% off for bulk purchases. Fill out the form and we'll respond within 24 hours.
            </DialogDescription>
          </DialogHeader>
          
          {contactSubmitted ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-16 h-16 mx-auto text-green-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Thank You!</h3>
              <p className="text-muted-foreground mb-4">
                Your inquiry has been submitted. We'll get back to you at <strong>{contactForm.contactEmail}</strong> within 24 hours.
              </p>
              <Button onClick={handleContactClose}>Close</Button>
            </div>
          ) : (
            <form onSubmit={handleContactSubmit} className="space-y-4">
              {/* Honeypot field - hidden from humans, bots fill it */}
              <input
                type="text"
                name="website"
                autoComplete="off"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
                value={contactForm.website}
                onChange={(e) => setContactForm(f => ({ ...f, website: e.target.value }))}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="institutionName">Institution Name *</Label>
                  <Input
                    id="institutionName"
                    placeholder="e.g. Stanford University"
                    value={contactForm.institutionName}
                    onChange={(e) => setContactForm(f => ({ ...f, institutionName: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estimatedUsers">Estimated Users</Label>
                  <Input
                    id="estimatedUsers"
                    type="number"
                    placeholder="e.g. 500"
                    min="1"
                    value={contactForm.estimatedUsers}
                    onChange={(e) => setContactForm(f => ({ ...f, estimatedUsers: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactName">Your Name *</Label>
                  <Input
                    id="contactName"
                    placeholder="John Smith"
                    value={contactForm.contactName}
                    onChange={(e) => setContactForm(f => ({ ...f, contactName: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Email Address *</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    placeholder="john@university.edu"
                    value={contactForm.contactEmail}
                    onChange={(e) => setContactForm(f => ({ ...f, contactEmail: e.target.value }))}
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="preferredPlan">Preferred Plan</Label>
                <div className="relative">
                  <select
                    id="preferredPlan"
                    value={contactForm.preferredPlan}
                    onChange={(e) => setContactForm(f => ({ ...f, preferredPlan: e.target.value }))}
                    className="flex h-10 w-full appearance-none items-center rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="">Select a plan (optional)</option>
                    <option value="basic">Basic ($9.99/user/mo)</option>
                    <option value="advanced">Advanced ($16.99/user/mo)</option>
                    <option value="pro">Pro ($19.99/user/mo)</option>
                    <option value="mixed">Mixed (different plans for different users)</option>
                    <option value="unsure">Not sure yet</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="message">Additional Information</Label>
                <Textarea
                  id="message"
                  placeholder="Tell us about your institution, timeline, or any specific requirements..."
                  rows={3}
                  value={contactForm.message}
                  onChange={(e) => setContactForm(f => ({ ...f, message: e.target.value }))}
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={handleContactClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={contactSubmitting}>
                  {contactSubmitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                  ) : (
                    'Submit Inquiry'
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PricingPage;
