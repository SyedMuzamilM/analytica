import type { Bindings } from "./env";

export async function cleanupDeletedWorkspaces(env: Pick<Bindings, "DB">) {
  const jobs = await env.DB.prepare(
    "SELECT workspace_id FROM workspace_deletions ORDER BY requested_at LIMIT 2",
  ).all<{ workspace_id: string }>();
  for (const { workspace_id: id } of jobs.results) {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM sites WHERE workspace_id=? AND status='deleting' AND deletion_completed_at IS NOT NULL AND logo_version=0",
      ).bind(id),
      env.DB.prepare(
        "DELETE FROM workspaces WHERE id=? AND NOT EXISTS(SELECT 1 FROM sites WHERE workspace_id=?)",
      ).bind(id, id),
    ]);
  }
}
