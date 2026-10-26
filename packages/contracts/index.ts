export type PrivacyMode = 'aggregate' | 'attribution';
export type Role = 'owner' | 'admin' | 'viewer';
export interface Workspace { id: string; name: string; role: Role }
export interface User { id: string; name: string }
export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  user?: User;
  workspaces?: Workspace[];
  mode?: string;
  secretsReady?: boolean;
}
export interface Site {
  id: string;
  workspaceId: string;
  name: string;
  domain: string;
  timezone: string;
  privacyMode: PrivacyMode;
  status: 'active' | 'paused' | 'deleting';
  createdAt: number;
  dailyLimit: number;
}
export interface MetricSet {
  pageviews: number;
  sessions: number;
  visitors: number | null;
  goals: number;
  bounceRate: number;
  avgDuration: number;
}
export interface BreakdownRow { name: string; count: number; visitors?: number; revenue?: number }
export interface SeriesPoint { date: string; pageviews: number; sessions: number; goals: number }
export interface AnalyticsReport {
  range: { from: number; to: number; timezone: string; label: string };
  current: MetricSet;
  previous: MetricSet;
  online: number;
  series: SeriesPoint[];
  sources: BreakdownRow[];
  pages: BreakdownRow[];
  countries: BreakdownRow[];
  devices: BreakdownRow[];
  events: BreakdownRow[];
  lastEventAt: number | null;
  privacyMode: PrivacyMode;
  coverage?: string;
}
export interface CollectEvent {
  version: 1;
  id: string;
  siteId: string;
  type: 'pageview' | 'goal' | 'outbound' | 'engagement';
  timestamp: number;
  sequence: number;
  visitorId: string;
  sessionId: string;
  mode: PrivacyMode;
  hostname: string;
  path: string;
  referrer?: string;
  campaign?: { source?: string; medium?: string; name?: string };
  name?: string;
  duration?: number;
}
