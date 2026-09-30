import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/icons/logo-mark';

export const metadata: Metadata = {
  title: 'Privacy Policy - Throughline',
  description:
    'What data Throughline stores, which services it talks to, how long it keeps data, and how to ask for access, correction or deletion.',
};

const LAST_UPDATED = '30 September 2026';

const linkClass =
  'text-primary rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none';

/** Read at render time so the value can be set per deployment. */
function contactEmail(): string | null {
  const value = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL?.trim();
  return value ? value : null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-on-surface text-xl font-semibold">{title}</h2>
      <div className="text-on-surface-variant mt-3 space-y-3 text-base leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

export default function PrivacyPage() {
  const email = contactEmail();
  const contact = email ? (
    <a href={`mailto:${email}`} className={linkClass}>
      {email}
    </a>
  ) : null;

  return (
    <div className="bg-surface text-on-surface flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-6 sm:px-6">
        <Link
          href="/"
          className="focus-visible:ring-primary flex items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <LogoMark className="h-7" />
        </Link>
        <Link
          href="/"
          className="text-primary focus-visible:ring-primary rounded-md text-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          Back to home
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <h1 className="text-on-surface text-3xl font-bold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm">Last updated: {LAST_UPDATED}</p>
        <p className="text-on-surface-variant mt-4 text-base leading-relaxed">
          This is a plain-language summary of how Throughline handles your data. The operator of
          this instance should have it reviewed by legal counsel before relying on it.
        </p>

        <Section title="Who we are">
          <p>
            Throughline turns a product brief into requirements, architecture, a backlog and UI
            prompts, and traces every output back to the decisions it came from.
          </p>
          {contact ? <p>Questions about privacy can be sent to {contact}.</p> : null}
        </Section>

        <Section title="Data we store">
          <List>
            <li>
              Account data: your email address and authentication identifiers, handled through
              Supabase Auth.
            </li>
            <li>
              Project content you enter or approve: briefs, generated requirements, architecture,
              backlog items and UI prompts, decisions, and approval history.
            </li>
            <li>
              Records of outputs created in external services: repository name and URL, Jira issue
              keys and links, and Google Stitch project references.
            </li>
            <li>
              Usage metadata for AI generation runs: model, token counts, cost and status. It is not
              used as advertising data.
            </li>
          </List>
        </Section>

        <Section title="Connected services">
          <p>
            Throughline can work with GitHub, Jira (Atlassian) and Google Stitch. When you connect
            an account or key, the credentials are used only to act on your behalf when you ask, for
            example to create a repository, export issues or generate a prototype.
          </p>
          <List>
            <li>
              Credentials are kept on the server only. They are never sent to your browser or
              written to logs.
            </li>
            <li>You can disconnect or stop using a connected service at any time.</li>
            <li>
              Removing a repository link in Throughline does not delete anything on GitHub. Items
              already created in an external service stay there until you remove them there.
            </li>
          </List>
        </Section>

        <Section title="Service providers">
          <List>
            <li>Supabase provides our database, authentication and file storage.</li>
            <li>Vercel hosts the application.</li>
            <li>OpenAI receives the project text you submit so it can generate artifacts.</li>
            <li>
              GitHub, Atlassian and Google Stitch receive only what you ask Throughline to create
              there.
            </li>
          </List>
          <p>We do not sell your data, we show no advertising, and we use no analytics trackers.</p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            We keep your data while your account and projects exist. Deleting a project removes its
            content and records. To delete your whole account,{' '}
            {contact ? (
              <>contact us at {contact}</>
            ) : (
              'contact the operator of the instance you use'
            )}
            .
          </p>
        </Section>

        <Section title="Security">
          <List>
            <li>Data is encrypted in transit with HTTPS.</li>
            <li>Access to a project is limited to its owner.</li>
            <li>Connected-service credentials stay on the server.</li>
          </List>
        </Section>

        <Section title="Cookies">
          <p>
            We use only essential authentication and session cookies, plus short-lived state cookies
            while you connect an account if that flow needs them. We use no advertising cookies.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask to access, correct or delete the personal data we hold about you. To do so,{' '}
            {contact ? <>email {contact}</> : 'contact the operator of the instance you use'}.
          </p>
        </Section>

        <Section title="Children">
          <p>Throughline is not intended for anyone under 16.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change this policy we will update the &ldquo;Last updated&rdquo; date at the top
            of this page.
          </p>
        </Section>
      </main>

      <footer className="text-on-surface-variant mx-auto w-full max-w-3xl px-4 py-8 text-xs sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="hover:text-on-surface focus-visible:ring-primary rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Home
          </Link>
          <span className="font-mono-code">&copy; {new Date().getFullYear()} Throughline</span>
        </div>
      </footer>
    </div>
  );
}
