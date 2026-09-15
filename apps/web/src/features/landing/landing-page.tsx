import { LandingFooter } from './components/landing-footer';
import { LandingHeader } from './components/landing-header';
import { AnalysisSection } from './sections/analysis-section';
import { HeroSection } from './sections/hero-section';
import { PipelineSection } from './sections/pipeline-section';
import { PricingSection } from './sections/pricing-section';
import { ResumeSection } from './sections/resume-section';
import { SourcesSection } from './sections/sources-section';
import { StatsSection } from './sections/stats-section';

export function LandingPage() {
  return (
    <div className="bg-background min-h-screen">
      <LandingHeader />
      <main>
        <HeroSection />
        <SourcesSection />
        <AnalysisSection />
        <ResumeSection />
        <PipelineSection />
        <StatsSection />
        <PricingSection />
      </main>
      <LandingFooter />
    </div>
  );
}
