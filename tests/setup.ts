import { beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Bindings } from "../apps/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  // Vitest 5's Worker runner shares database storage within a file. Explicitly
  // reset every application table, with foreign-key checks deferred for this
  // atomic fixture reset. Each test then proves behavior against a real D1 DB.
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
  ).all<{ name: string }>();
  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys=ON"),
    ...results.map(({ name }) => {
      if (!/^[a-z_]+$/.test(name)) throw new Error("Unexpected fixture table");
      return env.DB.prepare(`DELETE FROM ${name}`);
    }),
  ]);
});
