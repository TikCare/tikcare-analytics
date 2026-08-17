// Hand-written ambient declaration -- src/*.js stays plain JS on purpose
// (see README's zero-build-step rationale), but every consumer so far is
// TypeScript, so one shared .d.ts here beats each app writing its own
// ambient `declare module 'tikcare-analytics'` stub that would drift.

export interface Identity {
  userId?: string;
  teamId?: string;
  role?: string;
}

export interface AutoCaptureConfig {
  clicks?: boolean;
}

export interface InitConfig {
  /** The `ingest` edge function URL. Missing this (or ingestKey) makes the whole module no-op. */
  url: string;
  /** Per-app ingest key. Semi-public -- identifies the app, does not authorize arbitrary access. */
  ingestKey: string;
  /** Informational only -- the server resolves the real app_id from ingestKey. */
  appId?: string;
  environment?: string;
  appVersion?: string;
  /** Called per-event. userId/teamId must be UUIDs or they're dropped. */
  getIdentity?: () => Identity | null | undefined;
  /** Must return a route TEMPLATE for parameterized routes, not the raw pathname. */
  getPagePath?: () => string | null | undefined;
  /** Kill switch, checked before every event. Fails closed (false) if throwing/absent. */
  enabled?: () => boolean;
  /** mock_id policy: gates identity, not whether the event sends. Fails closed. */
  getIdentityConsent?: () => boolean;
  autoCapture?: AutoCaptureConfig;
}

export declare const EVENTS: Record<string, string>;

export declare function init(config: InitConfig): void;
export declare function track(eventName: string, properties?: Record<string, unknown>): void;
export declare function trackPageView(properties?: Record<string, unknown>): void;
export declare function flush(): Promise<void>;
