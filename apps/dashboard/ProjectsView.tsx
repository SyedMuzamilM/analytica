import { useState } from "react";
import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import {
  ArrowRight,
  Code2,
  ExternalLink,
  Globe,
  LayoutGrid,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Site, Workspace } from "../../packages/contracts";

export function ProjectIcon({ site }: { site: Site }) {
  return (
    <span className="project-symbol">
      {site.logoVersion ? (
        <img
          src={`/api/workspaces/${site.workspaceId}/sites/${site.id}/logo?v=${site.logoVersion}`}
          alt=""
        />
      ) : (
        <Globe size={21} />
      )}
    </span>
  );
}
export function ProjectsView({
  sites,
  workspace,
  loading,
  demo,
  onOpen,
  onAdd,
}: {
  sites: Site[];
  workspace?: Workspace;
  loading: boolean;
  demo: boolean;
  onOpen: (site: Site) => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const visible = sites.filter((site) =>
    `${site.name} ${site.domain}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="projects-view">
      <div className="project-summary">
        <div>
          <span className="project-summary-icon">
            <LayoutGrid size={22} />
          </span>
          <span>
            <strong>{sites.length}</strong>
            <small>Total projects</small>
          </span>
        </div>
        <div>
          <span className="project-summary-icon">
            <Globe size={22} />
          </span>
          <span>
            <strong>{sites.filter((s) => s.status === "active").length}</strong>
            <small>Active projects</small>
          </span>
        </div>
        <div>
          <span className="project-summary-icon">
            <ShieldCheck size={22} />
          </span>
          <span>
            <strong>
              {sites.filter((s) => s.privacyMode === "aggregate").length}
            </strong>
            <small>Aggregate privacy mode</small>
          </span>
        </div>
      </div>
      <section className="projects-panel">
        <div className="projects-toolbar">
          <div>
            <h2>Your projects</h2>
            <p>
              Manage your websites and applications in{" "}
              {workspace?.name || "your workspace"}.
            </p>
          </div>
          <div>
            <Input
              aria-label="Search projects"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {workspace?.role !== "viewer" && (
              <Button variant="primary" onClick={onAdd}>
                <Plus size={16} />
                Add project
              </Button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="projects-empty" role="status">
            Loading your projects…
          </div>
        ) : visible.length ? (
          <div className="project-table" role="table" aria-label="Projects">
            <div className="project-table-head" role="row">
              <span role="columnheader">Project</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Privacy mode</span>
              <span role="columnheader">Daily event limit</span>
              <span />
            </div>
            {visible.map((site) => (
              <button
                className="project-table-row"
                role="row"
                key={site.id}
                onClick={() => onOpen(site)}
                aria-label={`Open ${site.name}`}
              >
                <span className="project-identity" role="cell">
                  <ProjectIcon site={site} />
                  <span>
                    <strong>{site.name}</strong>
                    <small>{site.domain}</small>
                  </span>
                </span>
                <span role="cell">
                  <span className={`project-state ${site.status}`}>
                    <i />
                    {site.status === "active" ? "Active" : "Paused"}
                  </span>
                </span>
                <span role="cell">
                  {site.privacyMode === "aggregate"
                    ? "Aggregate"
                    : "Consent-based attribution"}
                </span>
                <span role="cell">{site.dailyLimit.toLocaleString()}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="projects-empty">
            <span className="project-empty-icon">
              <LayoutGrid size={32} />
            </span>
            <h3>
              {search
                ? "No matching projects"
                : "Your first project starts here"}
            </h3>
            <p>
              {search
                ? "Try another project name or domain."
                : "Add your website or app. Each project gets its own reports, settings and installation snippet."}
            </p>
            {!search && workspace?.role !== "viewer" && (
              <Button variant="primary" onClick={onAdd}>
                <Plus size={16} />
                Add your first website
              </Button>
            )}
          </div>
        )}
      </section>
      <section className="project-quickstart">
        <Code2 size={23} />
        <div>
          <h3>New here? Start with a test project.</h3>
          <p>
            Send a pageview and a goal, check the report, then delete the
            project when you're done.
          </p>
        </div>
        <LinkButton href="/docs#testing" variant="secondary">
          Read the guide <ExternalLink size={14} />
        </LinkButton>
      </section>
      {demo && (
        <p className="project-demo-note">
          These are sample projects. Create an account to connect your own
          products.
        </p>
      )}
    </div>
  );
}
