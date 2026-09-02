// Event-name constants — apps never hand-type event strings.
// Convention: object_action, lowercase snake, past tense.

export const EVENTS = {
  // universal
  PAGE_VIEWED: 'page_viewed',
  ELEMENT_CLICKED: 'element_clicked',
  ELEMENT_VIEWED: 'element_viewed',             // exposure: [data-track-view] ≥50% visible for ~1s
  SIGNUP_COMPLETED: 'signup_completed',
  LOGIN_SUCCEEDED: 'login_succeeded',
  // medical-scribe (附录A §9.4)
  RECORDING_STARTED: 'recording_started',
  RECORDING_COMPLETED: 'recording_completed',   // duration_ms
  NOTE_GENERATED: 'note_generated',             // template_id, success — NEVER content
  NOTE_COPIED: 'note_copied',
  TEMPLATE_SELECTED: 'template_selected',       // template_id
  // payment funnel (shared across apps, §9.3)
  PAYWALL_VIEWED: 'paywall_viewed',             // plan
  CHECKOUT_STARTED: 'checkout_started',         // plan, price_cents
  CHECKOUT_COMPLETED: 'checkout_completed',     // plan, price_cents
};
