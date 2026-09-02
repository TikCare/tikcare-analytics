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
  /** element_clicked on [data-track-id] elements. Default true. */
  clicks?: boolean;
  /**
   * Also capture clicks on unmarked button / a[href] / [role=button] /
   * input[type=submit|button] / summary. element_id falls back to
   * id → data-testid → name → an `auto:` DOM path (UNSTABLE across UI
   * refactors — long-term-tracked buttons should still get data-track-id).
   * Never reads element text or aria-label (PHI). Default false.
   */
  allClickables?: boolean;
  /**
   * element_viewed exposure capture: fires once per mounted element after
   * ≥50% visibility for ~1s. `true` (default) observes only
   * [data-track-view] elements — inert until one exists. `'all'` also
   * observes every clickable (same selector as allClickables); unmarked
   * elements fall back to id/data-testid/name/`auto:` DOM-path ids, and a
   * data-track-view attribute always wins as the id. `false` disables.
   */
  views?: boolean | 'all';
}

export interface InitConfig {
  /**
   * The `ingest` edge function URL. Optional in the type because init()
   * genuinely accepts it being unset (e.g. a not-yet-configured env var) and
   * safely no-ops the whole module rather than throwing -- see the
   * "commented out env var = inert" pattern in consuming apps' .env.example.
   * Required in practice for analytics to actually send anything.
   */
  url?: string;
  /** Per-app ingest key. Same optionality note as `url` -- missing either one no-ops init(). */
  ingestKey?: string;
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
