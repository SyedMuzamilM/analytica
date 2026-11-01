import type { Workspace } from "../../packages/contracts";

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_SECRET: string;
  SETUP_TOKEN?: string;
  APP_ORIGIN?: string;
  MODE?: string;
  PUBLIC_SIGNUP?: string;
  PROJECT_ASSETS?: R2Bucket;
  RESTORE_LOCK?: string;
  EDGE_RATE_LIMIT?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}
export interface Principal {
  userId: string;
  name: string;
  sessionId: string;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: { principal: Principal; workspace: Workspace };
};
