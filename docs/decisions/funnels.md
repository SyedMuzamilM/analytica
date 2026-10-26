# Funnels and browser journeys

Implemented 26 October 2026 as original Worker/D1 routes. `funnelRoutes` mounts under `/api` and `cleanupFunnels` runs with other bounded deletion maintenance.

## Scope and permissions

Funnels require an attribution-mode site. Owners and admins can create/delete definitions; viewers can read aggregate funnel counts. Browser journey inspection requires owner/admin access because it exposes pseudonymous browser/session identifiers. Aggregate-mode sites return `attribution_required`; the implementation does not infer persistent identity from document IDs.

Every definition, session and event query is scoped by the server-authorized workspace and site. Deleting sites are hidden immediately. Definition creation enforces its 20/site ceiling and site state in a SQL admission trigger so concurrent requests cannot exceed the limit. A maintenance call deletes at most 100 definitions belonging to deleting sites.

## Definition and metric contract

A definition has a name and 2 to 8 exact steps. A step is `{type:'pageview', value:'/pricing'}` or `{type:'goal', value:'signup'}`. Page patterns and query-string matching are deliberately unsupported. Exact comparisons support long paths without depending on D1's 50-byte LIKE/GLOB pattern limit.

Each session gets one attempt. It starts at that session's first matching first-step event inside the selected report period. Each subsequent matching event advances at most one step. Repeated steps therefore require different events. An attempt must complete within 30 minutes of its first step; a later first-step event does not reset its timer. Steps in different sessions never combine, even for the same browser ID. Every counted step must occur inside the selected interval. Current incomplete periods are labeled accordingly.

Matching events are ordered by session, event timestamp, bounded client sequence, and event ID. Client ordering is telemetry, not verified human behavior. Session boundaries and acceptable client time are enforced by collection. Per-step counts are sessions reaching that step; conversion from the previous step is that count divided by the previous count. The first step has no previous conversion and returns `null`. Empty preceding steps yield a ratio of zero.

The report prefilters matching event types/names/paths in SQL and retrieves at most 20,001 retained records. More than 20,000 returns HTTP 422 with no partial count. The user must choose a shorter period. No arbitrary cap is silently presented as complete. Date boundaries come from the IANA-aware range resolver shared with other reports. Retained event receipts are restricted to 90 days.

## Journeys

The list returns up to 100 recent attribution sessions, default 50. A browser detail returns up to 100 sessions and 500 non-engagement events in the retained 90-day window. Responses explicitly signal truncation. IDs identify random consented browsers, not authenticated people. No name, email or purchase identity is inferred. Money is not included in these endpoints.

All responses inherit private/no-store API headers from the parent Worker. Site deletion and identity suppression prevent new reads while bounded cleanup catches up.

## Verification

Actual Worker/D1 tests cover ordered and reversed paths, repeated steps, timestamp sequence ties, completion-window expiry while the session remains active, sessions spanning midnight, role/tenant/mode restrictions, deleting-site cleanup, concurrent definition-cap enforcement and the explicit 20,000-event refusal. Native production CPU and report capacity still need measurement. The hard row ceiling limits in-Worker processing but does not establish a query-scan budget or universal Free-tier feasibility.
