import type { Bindings } from "./env";

export async function cleanupProjectAssets(
  env: Pick<Bindings, "DB" | "PROJECT_ASSETS">,
) {
  if (!env.PROJECT_ASSETS) return;
  const sites = await env.DB.prepare(
    "SELECT id,workspace_id FROM sites WHERE status='deleting' AND logo_version>0 LIMIT 20",
  ).all<{ id: string; workspace_id: string }>();
  for (const site of sites.results) {
    await env.PROJECT_ASSETS.delete(
      `projects/${site.workspace_id}/${site.id}/logo`,
    );
    await env.DB.prepare(
      "UPDATE sites SET logo_version=0 WHERE workspace_id=? AND id=?",
    )
      .bind(site.workspace_id, site.id)
      .run();
  }
}
