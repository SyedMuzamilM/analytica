import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Fingerprint,
  Globe,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "./Brand";
import { demoReport, demoSites } from "./demo";
import { SelectField } from "./SelectField";

const number = new Intl.NumberFormat("en-US");

function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="public-header">
      <a href="/" aria-label="Analytica home">
        <Brand />
      </a>
      <button
        className="public-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="public-navigation"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        {menuOpen ? "Close" : "Menu"}
      </button>
      <nav
        id="public-navigation"
        className={menuOpen ? "is-open" : ""}
        aria-label="Product navigation"
      >
        <a href="/#product" onClick={() => setMenuOpen(false)}>
          Product
        </a>
        <a href="/docs">Documentation</a>
        <a href="/privacy">Privacy</a>
        <a href="/demo">Live demo</a>
      </nav>
      <div className="public-header-actions">
        <a href="/login" className="public-login">
          Log in
        </a>
        <a href="/signup" className="public-button">
          Create account
        </a>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="footer-top">
        <p>
          Made for the things
          <br />
          you're building.
        </p>
        <nav aria-label="Footer">
          <a href="/docs">Documentation</a>
          <a href="/privacy">Privacy & data</a>
          <a
            href="https://github.com/SyedMuzamilM/analytica"
            target="_blank"
            rel="noreferrer"
          >
            Source code <ArrowUpRight size={15} />
          </a>
          <a href="https://mzml.dev" target="_blank" rel="noreferrer">
            Built by MZML <ArrowUpRight size={15} />
          </a>
        </nav>
      </div>
      <a href="/" className="footer-wordmark" aria-label="Analytica home">
        analytica<span className="brand-period">.</span>
      </a>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Analytica</span>
        <span>Your products. Your data.</span>
      </div>
    </footer>
  );
}

function ReportPreview() {
  const [projectId, setProjectId] = useState("demo-orbit");
  const [period, setPeriod] = useState("7d");
  const site = demoSites.find((item) => item.id === projectId) ?? demoSites[0];
  const report = useMemo(
    () => demoReport(new URLSearchParams({ period }), site),
    [period, site],
  );
  const ceiling =
    Math.max(...report.series.map((point) => point.pageviews), 1) * 1.15;
  const points = report.series.map(
    (point, index) =>
      `${(index / Math.max(1, report.series.length - 1)) * 800},${180 - (point.pageviews / ceiling) * 170}`,
  );
  const date = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return (
    <div
      className="product-preview"
      data-ui
      aria-label="Sample Analytica report"
    >
      <div className="preview-heading">
        <div className="preview-project">
          <span className="project-symbol">
            <Globe size={20} />
          </span>
          <div>
            <strong>{site.name}</strong>
            <span>{site.domain}</span>
          </div>
        </div>
        <div className="preview-controls">
          <span className="preview-sample">Sample data</span>
          <SelectField
            label="Sample project"
            value={projectId}
            onValueChange={setProjectId}
            options={demoSites.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
          <SelectField
            label="Sample report period"
            value={period}
            onValueChange={setPeriod}
            options={[
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
        </div>
      </div>
      <div className="preview-body">
        <div className="preview-traffic">
          <div className="preview-metrics" role="status" aria-atomic="true">
            {(
              [
                { key: "pageviews", label: "Pageviews" },
                { key: "sessions", label: "Sessions" },
                { key: "goals", label: "Goals" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key}>
                <span>{label}</span>
                <strong>{number.format(report.current[key])}</strong>
                <small>{report.range.label.toLowerCase()}</small>
              </div>
            ))}
          </div>
          <svg
            className="preview-chart"
            viewBox="0 0 800 200"
            role="img"
            aria-label={`${number.format(report.current.pageviews)} sample pageviews over ${report.series.length} days`}
            preserveAspectRatio="none"
          >
            {[40, 100, 160].map((y) => (
              <line
                key={y}
                x1="0"
                x2="800"
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeDasharray="3 6"
              />
            ))}
            <polygon
              points={`0,200 ${points.join(" ")} 800,200`}
              fill="var(--accent-soft)"
            />
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="preview-axis">
            <span>{date(report.series[0].date)}</span>
            <span>
              {date(report.series[Math.floor(report.series.length / 2)].date)}
            </span>
            <span>{date(report.series[report.series.length - 1].date)}</span>
          </div>
        </div>
        <div className="preview-sources">
          <div>
            <strong>Top sources</strong>
            <span>Pageviews</span>
          </div>
          {report.sources.slice(0, 5).map((source) => (
            <div className="preview-source-row" key={source.name}>
              <span
                className="preview-source-fill"
                style={{
                  width: `${(source.count / Math.max(1, report.sources[0].count)) * 100}%`,
                }}
              />
              <span>{source.name}</span>
              <strong>{number.format(source.count)}</strong>
            </div>
          ))}
          <a href={`/demo?site=${site.id}&period=${period}`}>
            Explore this report <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
      <div className="preview-bottom">
        <span>Try a different project or date range.</span>
        <span>Demo data, never customer data.</span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [mode, setMode] = useState<"aggregate" | "attribution">("aggregate");
  useEffect(() => {
    document.title = "Analytica · Know your traffic";
  }, []);
  function switchMode(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "aggregate"
        : event.key === "End"
          ? "attribution"
          : mode === "aggregate"
            ? "attribution"
            : "aggregate";
    setMode(next);
    document.getElementById(`privacy-${next}`)?.focus();
  }
  return (
    <div className="public-site">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main-content">
        <section className="marketing-hero" id="product">
          <div className="hero-intro">
            <h1>
              Know your traffic.
              <br />
              See what works.
            </h1>
            <div className="hero-copy">
              <p>
                Analytics for every product you build. Understand your traffic,
                goals and revenue, with control over what you collect.
              </p>
              <div className="hero-actions">
                <a href="/signup" className="public-button light">
                  Create your account
                </a>
                <a href="/demo" className="hero-demo-link">
                  Explore live demo <ArrowUpRight size={17} />
                </a>
              </div>
              <span className="hero-footnote">
                <Fingerprint size={16} />
                Passkey sign-in. No credit card.
              </span>
            </div>
          </div>
          <ReportPreview />
        </section>
        <section className="feature-story">
          <div className="story-copy">
            <h2>Room for every idea.</h2>
            <p>
              A marketing site. A desktop app. The side project you keep coming
              back to. Give each product its own reports, tracking ID and
              settings, in one workspace.
            </p>
            <a className="text-link" href="/signup">
              Add your first project <ArrowUpRight size={18} />
            </a>
          </div>
          <div className="project-example" data-ui>
            <div className="example-heading">
              <span>Your workspace</span>
              <Layers size={20} />
            </div>
            {demoSites.map((site, index) => (
              <a
                className="example-project"
                href={`/demo?site=${site.id}`}
                key={site.id}
              >
                <span
                  className={`example-project-icon ${index === 0 ? "crimson" : "charcoal"}`}
                >
                  {site.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{site.name}</strong>
                  <small>{site.domain}</small>
                </span>
                <span className="example-project-status">
                  <span />
                  Active
                </span>
                <ArrowUpRight size={18} />
              </a>
            ))}
            <a href="/signup" className="example-add">
              Your next project <span>+</span>
            </a>
            <p>Two sample projects. Open either to explore.</p>
          </div>
        </section>
        <section className="privacy-story" id="privacy">
          <div className="story-copy">
            <h2>Collect with intention.</h2>
            <p>
              Start with aggregate traffic. Turn on consent-controlled
              attribution when you need visitor journeys. The choice belongs to
              each project.
            </p>
            <a className="text-link" href="/privacy">
              How your data is handled <ArrowUpRight size={18} />
            </a>
            <div className="privacy-facts">
              <span>
                <Check size={17} />
                Export your reports
              </span>
              <span>
                <Check size={17} />
                Delete projects and account data
              </span>
            </div>
          </div>
          <div className="privacy-demo" data-ui>
            <div
              className="privacy-tabs"
              role="tablist"
              aria-label="Tracking privacy mode"
            >
              {(["aggregate", "attribution"] as const).map((value) => (
                <button
                  key={value}
                  id={`privacy-${value}`}
                  role="tab"
                  aria-selected={mode === value}
                  aria-controls="privacy-panel"
                  tabIndex={mode === value ? 0 : -1}
                  onKeyDown={switchMode}
                  onClick={() => setMode(value)}
                >
                  {value === "aggregate" ? "Aggregate" : "Attribution"}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="privacy-panel"
              aria-labelledby={`privacy-${mode}`}
              tabIndex={0}
            >
              <ShieldCheck size={28} />
              <h3>
                {mode === "aggregate"
                  ? "Traffic without persistent visitor IDs"
                  : "Journeys after explicit consent"}
              </h3>
              <p>
                {mode === "aggregate"
                  ? "Measure pageviews, sources and goals. IDs live in memory and reset on a full navigation."
                  : "Follow sessions and visitor journeys after your app grants consent. Withdrawing consent clears the tracking identity."}
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
          <div className="story-copy">
            <h2>Your first signal.</h2>
            <p>
              Go from a new account to a working report. Start with a test
              project and check your first event before connecting your real
              product.
            </p>
            <a className="text-link" href="/docs">
              Follow the setup guide <ArrowUpRight size={18} />
            </a>
          </div>
          <ol className="setup-steps">
            <li>
              <div>
                <h3>Create an account</h3>
                <p>
                  Sign up with your device's passkey and save your recovery
                  codes.
                </p>
              </div>
            </li>
            <li>
              <div>
                <h3>Add your project</h3>
                <p>Set your domain, reporting timezone and privacy mode.</p>
              </div>
            </li>
            <li>
              <div>
                <h3>Connect and verify</h3>
                <p>
                  Install the script or configure your app's collector. Find
                  your first event in the overview.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="marketing-faq">
          <h2>Good to know.</h2>
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
                updates also count.
              </p>
            </details>
          </div>
        </section>
        <section className="marketing-cta">
          <div>
            <h2>See your work at work.</h2>
            <p>Connect your first project and find out how it's used.</p>
          </div>
          <a href="/signup" className="public-button">
            Create your account
          </a>
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
          <span>Analytica guides</span>
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
              <h1>Your data, your choice.</h1>
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
              <h1>Your first project.</h1>
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
              <a href="/app" className="public-button">
                Open your projects <ArrowUpRight size={16} />
              </a>
            </>
          )}
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}
