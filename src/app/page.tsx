import { getVerifiedUser } from '@/auth';
import { ApprovalSection } from '@/components/marketing/approval-section';
import { FinalCtaSection } from '@/components/marketing/final-cta-section';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { ImpactSection } from '@/components/marketing/impact-section';
import { IntegrationsSection } from '@/components/marketing/integrations-section';
import { LineageSection } from '@/components/marketing/lineage-section';
import { Navbar } from '@/components/marketing/navbar';
import { ProblemSection } from '@/components/marketing/problem-section';
import { VersionHistorySection } from '@/components/marketing/version-history-section';
import { WorkflowSection } from '@/components/marketing/workflow-section';
import { signOutAction } from './actions';

export default async function Home() {
  const user = await getVerifiedUser();

  return (
    <>
      <Navbar userEmail={user?.email ?? null} onSignOut={signOutAction} />
      <main className="flex-1">
        <Hero />
        <ProblemSection />
        <WorkflowSection />
        <LineageSection />
        <ImpactSection />
        <VersionHistorySection />
        <ApprovalSection />
        <IntegrationsSection />
        <FinalCtaSection />
      </main>
      <Footer userEmail={user?.email ?? null} />
    </>
  );
}
