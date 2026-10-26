import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".dev.vars")) {
  console.log("Existing .dev.vars preserved.");
  process.exit(0);
}
writeFileSync(
  ".dev.vars",
  `APP_SECRET=${randomBytes(48).toString("base64url")}\nSETUP_TOKEN=${randomBytes(48).toString("base64url")}\nAPP_ORIGIN=http://localhost:8787\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created private .dev.vars. Read its SETUP_TOKEN locally to complete owner setup.",
);
