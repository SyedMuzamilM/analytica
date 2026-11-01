import { lazy, Suspense } from "react";
import { LandingPage, DocumentationPage } from "./PublicPages";

const Dashboard = lazy(() =>
  import("./App").then((module) => ({ default: module.App })),
);

export function Product() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const legacyDashboard =
    path === "/" && /(?:view|site|workspace)=/.test(window.location.search);
  if (path === "/" && !legacyDashboard) return <LandingPage />;
  if (path === "/docs" || path === "/privacy")
    return <DocumentationPage privacy={path === "/privacy"} />;
  if (
    ["/app", "/login", "/signup", "/demo"].includes(path) ||
    legacyDashboard
  ) {
    return (
      <Suspense
        fallback={
          <div className="app-loading" role="status">
            Opening Analytica…
          </div>
        }
      >
        <Dashboard />
      </Suspense>
    );
  }
  return (
    <main className="not-found">
      <h1>This page doesn't exist.</h1>
      <p>Head back to Analytica to find your projects.</p>
      <a className="button primary" href="/">
        Go to the home page
      </a>
    </main>
  );
}
