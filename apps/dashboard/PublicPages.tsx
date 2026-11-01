import { useEffect, useState } from "react";
import { LinkButton, Button } from "@cloudflare/kumo/components/button";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Fingerprint,
  Globe,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "./AuthScreen";

const sample = [
  24, 38, 30, 45, 35, 58, 51, 67, 49, 77, 63, 90, 72, 81, 66, 99, 82, 105, 95,
  117, 102, 130, 114, 142, 127, 158, 135, 170,
];

function PublicHeader() {
  return (
    <header className="public-header">
      <a href="/" aria-label="Analytica home">
        <Brand />
      </a>
      <nav aria-label="Product navigation">
        <a href="/#product">Product</a>
        <a href="/docs">Documentation</a>
        <a href="/#privacy">Privacy</a>
      </nav>
      <div>
        <LinkButton href="/login" variant="ghost">
          Log in
        </LinkButton>
        <LinkButton href="/signup" variant="primary">
          Create account <ArrowRight size={15} />
        </LinkButton>
      </div>
    </header>
  );
}
function PublicFooter() {
  return (
    <footer className="public-footer">
      <div>
        <a href="/">
          <Brand small />
        </a>
        <p>Understand your products. Keep control of your data.</p>
      </div>
      <nav aria-label="Footer">
        <a href="/docs">Documentation</a>
        <a href="/privacy">Privacy & data</a>
        <a
          href="https://github.com/SyedMuzamilM/analytica"
          target="_blank"
          rel="noreferrer"
        >
          Source code <ArrowUpRight size={13} />
        </a>
      </nav>
      <span>© {new Date().getFullYear()} Analytica</span>
    </footer>
  );
}

export function LandingPage() {
  const [mode, setMode] = useState<"aggregate" | "attribution">("aggregate");
  useEffect(() => {
    document.title = "Analytica · Know what brings people back";
  }, []);
  return (
    <div className="public-site">
      <PublicHeader />
      <main>
        <section className="marketing-hero" id="product">
          <div className="hero-copy">
            <span className="product-eyebrow">
              <span />
              Analytics for the products you build
            </span>
            <h1>
              Know your traffic.
              <br />
              <span>Find your next move.</span>
            </h1>
            <p>
              One place for your websites, product events and revenue. See
              what's working, follow the journey, and make the next decision
              with confidence.
            </p>
            <div className="hero-actions">
              <LinkButton href="/signup" variant="primary" size="lg">
                Create your account <ArrowRight size={17} />
              </LinkButton>
              <LinkButton href="/demo" variant="secondary" size="lg">
                Explore live demo
              </LinkButton>
            </div>
            <div className="hero-footnote">
              <Fingerprint size={16} />
              Sign up with a passkey. No credit card.
            </div>
          </div>
          <div
            className="product-preview"
            data-ui="true"
            aria-label="Sample Analytica report"
          >
            <div className="preview-window-bar">
              <Brand small />
              <span>Sample project · Last 7 days</span>
            </div>
            <div className="preview-project">
              <span className="project-symbol">
                <Globe size={20} />
              </span>
              <div>
                <strong>Your next great product</strong>
                <span>Website overview</span>
              </div>
              <span className="preview-live">Sample data</span>
            </div>
            <div className="preview-metrics">
              <div>
                <span>Pageviews</span>
                <strong>12,480</strong>
                <small>↑ 18.6%</small>
              </div>
              <div>
                <span>Sessions</span>
                <strong>8,216</strong>
                <small>↑ 12.4%</small>
              </div>
              <div>
                <span>Conversions</span>
                <strong>386</strong>
                <small>↑ 9.2%</small>
              </div>
            </div>
            <div
              className="preview-chart"
              role="img"
              aria-label="Illustrative traffic chart, not customer data"
            >
              <div className="preview-grid" />
              {sample.map((height, i) => (
                <span key={i} style={{ height: `${height}px` }} />
              ))}
            </div>
            <div className="preview-axis">
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
              <span>Sun</span>
            </div>
            <div className="preview-bottom">
              <span>
                <span className="orange-dot" />
                Pageviews
              </span>
              <a href="/demo">
                Open the interactive demo <ArrowRight size={13} />
              </a>
            </div>
          </div>
        </section>
        <div className="product-strip">
          <span>
            <Layers size={19} />A home for every project
          </span>
          <span>
            <ShieldCheck size={19} />
            Explicit privacy controls
          </span>
          <span>
            <Code2 size={19} />A small script to get started
          </span>
        </div>
        <section className="feature-story">
          <div>
            <span className="section-index">
              01 / A portfolio, not a pile of tabs
            </span>
            <h2>
              Every product.
              <br />
              Its own clear picture.
            </h2>
            <p>
              Keep your marketing site, desktop app and next experiment in
              separate projects. Switch between reports without mixing traffic
              or credentials.
            </p>
            <a href="/signup">
              Start with your first project <ArrowRight size={16} />
            </a>
          </div>
          <div className="project-example" data-ui="true">
            <div>
              <span className="example-project-icon orange">
                <Globe size={21} />
              </span>
              <span>
                <strong>Marketing website</strong>
                <small>Traffic, sources and conversions</small>
              </span>
              <ArrowUpRight size={18} />
            </div>
            <div>
              <span className="example-project-icon blue">
                <Layers size={21} />
              </span>
              <span>
                <strong>Desktop application</strong>
                <small>App opens and screen events</small>
              </span>
              <ArrowUpRight size={18} />
            </div>
            <div>
              <span className="example-project-icon green">
                <Code2 size={21} />
              </span>
              <span>
                <strong>Your next experiment</strong>
                <small>A fresh project, ready when you are</small>
              </span>
              <ArrowUpRight size={18} />
            </div>
            <span className="example-caption">
              Each project has its own tracking ID and settings.
            </span>
          </div>
        </section>
        <section className="privacy-story" id="privacy">
          <div>
            <span className="section-index">02 / Choose what you measure</span>
            <h2>
              Useful analytics.
              <br />
              Deliberate privacy.
            </h2>
            <p>
              Start with aggregate traffic. Enable consent-controlled
              attribution when you need visitor journeys. Export data, delete a
              project, or delete your account from your settings.
            </p>
            <a href="/privacy">
              Read about data and privacy <ArrowRight size={16} />
            </a>
          </div>
          <div className="privacy-demo">
            <div
              className="privacy-tabs"
              role="tablist"
              aria-label="Tracking privacy mode"
            >
              <Button
                role="tab"
                aria-selected={mode === "aggregate"}
                variant={mode === "aggregate" ? "primary" : "ghost"}
                onClick={() => setMode("aggregate")}
              >
                Aggregate
              </Button>
              <Button
                role="tab"
                aria-selected={mode === "attribution"}
                variant={mode === "attribution" ? "primary" : "ghost"}
                onClick={() => setMode("attribution")}
              >
                Attribution
              </Button>
            </div>
            <div role="tabpanel">
              <ShieldCheck size={30} />
              <h3>
                {mode === "aggregate"
                  ? "Traffic without persistent visitor IDs"
                  : "Journeys after explicit consent"}
              </h3>
              <p>
                {mode === "aggregate"
                  ? "Measure pageviews, sources and goals. IDs live in document memory and reset on a full navigation."
                  : "Follow sessions and visitor journeys only after your application grants consent. Opt-out clears the tracking identity."}
              </p>
              <pre>
                <code>
                  {mode === "aggregate"
                    ? '<script defer src="https://analytica.mzml.dev/tracker.js"\n  data-site="YOUR_PROJECT_ID"\n  data-mode="aggregate"></script>'
                    : "window.analytica('consent', true);\nwindow.analytica('goal', 'signup');"}
                </code>
              </pre>
            </div>
          </div>
        </section>
        <section className="setup-story">
          <div className="setup-intro">
            <span className="section-index">
              03 / From account to first event
            </span>
            <h2>
              Make your first
              <br />
              signal count.
            </h2>
            <p>
              Explore the demo, create a test project, and verify your first
              event before connecting a real product.
            </p>
          </div>
          <ol className="setup-steps">
            <li>
              <span>1</span>
              <div>
                <h3>Create an account</h3>
                <p>Use your device's passkey and save your recovery codes.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>Add a project</h3>
                <p>Choose your domain, reporting timezone and privacy mode.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>Connect and verify</h3>
                <p>
                  Copy your script or configure your app's collector. Check the
                  first event in your overview.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="marketing-faq">
          <h2>A few things to know.</h2>
          <div>
            <details>
              <summary>Can I track more than one product?</summary>
              <p>
                Yes. Each workspace supports separate projects with their own
                domain, privacy mode, installation snippet and server keys.
              </p>
            </details>
            <details>
              <summary>Can I try it before sending real traffic?</summary>
              <p>
                The demo uses labeled sample data. You can also create a test
                project in your own account and delete it after testing.
              </p>
            </details>
            <details>
              <summary>What happens when I delete my account?</summary>
              <p>
                Your credentials and access are removed immediately. Projects in
                workspaces where you are the sole owner stop collecting, and
                their stored data is removed in background cleanup. Shared-owner
                workspaces remain with their other owners.
              </p>
            </details>
            <details>
              <summary>Are there usage limits?</summary>
              <p>
                Yes. Current default limits are 1,000 accepted event envelopes
                per project per UTC day and 2,000 per installation. Engagement
                updates also count. These limits keep this initial deployment
                bounded.
              </p>
            </details>
          </div>
        </section>
        <section className="marketing-cta">
          <div>
            <h2>
              Build something.
              <br />
              Understand how it's used.
            </h2>
            <p>Your next project deserves more than guesswork.</p>
          </div>
          <LinkButton href="/signup" variant="primary" size="lg">
            Get started <ArrowRight size={17} />
          </LinkButton>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

export function DocumentationPage({ privacy = false }: { privacy?: boolean }) {
  useEffect(() => {
    document.title = `${privacy ? "Privacy & data" : "Documentation"} · Analytica`;
  }, [privacy]);
  return (
    <div className="public-site">
      <PublicHeader />
      <main className="documentation">
        <aside>
          <span>ANALYTICA GUIDES</span>
          <a href="/docs">Getting started</a>
          <a href="/docs#websites">Website tracking</a>
          <a href="/docs#applications">Desktop & mobile apps</a>
          <a href="/docs#testing">Test your integration</a>
          <a href="/privacy">Privacy & deletion</a>
          <a href="/app">
            Open dashboard <ArrowUpRight size={13} />
          </a>
        </aside>
        <article>
          {privacy ? (
            <>
              <span className="section-index">Privacy & data</span>
              <h1>
                You choose what
                <br />
                your projects collect.
              </h1>
              <h2>Two explicit privacy modes</h2>
              <p>
                Aggregate mode uses document-scoped IDs in memory. A full
                navigation starts a new ID. It does not count verified people or
                returning visitors. Attribution mode stores visitor IDs only
                after your site grants consent. Neither mode is a blanket
                exemption from consent requirements.
              </p>
              <h2>Keep sensitive information out</h2>
              <p>
                Do not send names, email addresses, payment details, ledger
                entries, tokens or private URLs as events. Use fixed screen
                names and fixed goal names. Use full path redaction for pages
                with sensitive routes.
              </p>
              <h2>Delete a project or your account</h2>
              <p>
                Delete a project in Project settings to stop collection and
                schedule its analytics for removal. Delete your account in
                Workspace & account after a fresh passkey sign-in and typed
                confirmation. Credentials, recovery codes and sessions are
                removed immediately. Workspaces where you are the sole owner
                enter background deletion; workspaces with another owner remain
                with that owner.
              </p>
              <p>
                Cleanup runs every 15 minutes in bounded batches. Large projects
                can take multiple runs. Opaque deletion journal entries are
                retained to prevent erased sites from being restored
                accidentally. Database recovery snapshots can retain earlier
                data until the provider's retention window ends.
              </p>
              <h2>Project images</h2>
              <p>
                Uploaded logos are stored privately and served only to
                authorized workspace members. They are removed when the project
                or its owning workspace is deleted.
              </p>
            </>
          ) : (
            <>
              <span className="section-index">Getting started</span>
              <h1>
                Your first project,
                <br />
                from setup to signal.
              </h1>
              <p className="doc-lead">
                Use a separate project for each product and environment. Start
                with a test project before enabling production collection.
              </p>
              <h2>1. Create your account</h2>
              <p>
                <a href="/signup">Create an account</a> with your device's
                passkey. Save all recovery codes somewhere private. You can add
                a second passkey in account settings.
              </p>
              <h2>2. Add a project</h2>
              <p>
                Open Projects and choose Add project. Set a recognizable name,
                the exact product hostname, timezone and privacy mode. Separate
                production and test environments into different projects.
              </p>
              <h2 id="websites">3. Connect a website</h2>
              <p>
                Copy the installation snippet from Project settings into your
                site's head. The public project ID belongs in browser code.
                Server keys and payment webhook secrets stay on your backend.
              </p>
              <pre>
                <code>
                  {
                    '<script defer src="https://analytica.mzml.dev/tracker.js"\n  data-site="YOUR_PROJECT_ID" data-mode="aggregate"></script>\n\n<script>\n  // After the tracker is ready:\n  window.analytica?.(\'goal\', \'signup\');\n</script>'
                  }
                </code>
              </pre>
              <h2 id="applications">Desktop and mobile applications</h2>
              <p>
                Applications send the versioned event envelope to{" "}
                <code>POST /v1/collect</code>. Configure the public project ID
                and a fixed hostname matching the project. Use fixed screen
                names, fresh event IDs for new actions, and the same event ID
                when retrying. Ask for opt-in before enabling application
                analytics.
              </p>
              <p>
                Use separate projects for the product website, desktop
                application and mobile application. Never send ledger contents,
                customer records, credentials or backup data to the analytics
                collector.
              </p>
              <h2 id="testing">4. Verify before going live</h2>
              <ol>
                <li>Create a project with “Test” in its name.</li>
                <li>Install its snippet or configure the app collector.</li>
                <li>Open the tracked page and perform one goal.</li>
                <li>
                  Check Overview and Events. Refresh to see the accepted event.
                </li>
                <li>
                  Switch projects and confirm the other project's report is
                  unchanged.
                </li>
                <li>
                  Delete the test project, or delete your test account in
                  account settings.
                </li>
              </ol>
              <h2>Limits and recovery</h2>
              <p>
                The current defaults accept 1,000 event envelopes per project
                per UTC day and 2,000 per installation. Engagement receipts
                count too. Keep your recovery codes and a backup passkey, and
                sign in again before changing account security.
              </p>
              <LinkButton href="/app" variant="primary">
                Open your projects <ArrowRight size={16} />
              </LinkButton>
            </>
          )}
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}
