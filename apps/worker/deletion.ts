/** All domain cleanup must consume the same ordered pending site jobs. */
export async function pendingSiteDeletions(db: D1Database, limit = 2) {
  const result = await db
    .prepare(
      `SELECT s.workspace_id,s.id FROM sites s JOIN privacy_jobs j
       ON j.workspace_id=s.workspace_id AND j.site_id=s.id AND j.kind='site'
       WHERE s.status='deleting' AND s.deletion_completed_at IS NULL AND j.completed_at IS NULL
       ORDER BY j.created_at,j.id LIMIT ?`,
    )
    .bind(limit)
    .all<{ workspace_id: string; id: string }>();
  return result.results;
}
