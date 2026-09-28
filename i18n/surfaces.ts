// i18n/surfaces.ts — the rollout map (docs/I18N.md §10, §12).
//
// A SURFACE is a set of catalog keys (by prefix) plus the screen files that
// render them. Its state gates the validator:
//   pending   — nothing enforced yet (the file still holds raw English).
//   migrated  — the file's strings go through t()/tn(); coverage may be partial
//               (missing Spanish shows English — safe).
//   complete  — every key under `keyPrefixes` MUST have Spanish; validate-i18n
//               fails otherwise. Phase gates flip surfaces here.
//
// Only migrate a file after the copy/voice pass and the file's owning run have
// released it. PURE data.

export type SurfaceState = 'pending' | 'migrated' | 'complete';

export interface Surface {
  id: string;
  phase: 0 | 1 | 2 | 3 | 4;
  state: SurfaceState;
  /** Catalog keys this surface owns (prefix match on the full key). */
  keyPrefixes: string[];
  /** Repo-relative screen/component files that render it. */
  files: string[];
}

export const SURFACES: Surface[] = [
  // Phase 0 — the seed catalog. Complete: every seed key has reviewed-draft
  // Spanish. Not yet wired to any screen (the handoffs do that).
  {
    id: 'seed.nav',
    phase: 0,
    state: 'complete',
    keyPrefixes: ['nav.'],
    files: [],
  },
  {
    id: 'seed.settings-language',
    phase: 0,
    state: 'complete',
    keyPrefixes: ['settings.language.'],
    files: ['components/LanguagePicker.tsx', 'app/(tabs)/settings/language.tsx'],
  },
  {
    id: 'seed.vocabulary',
    phase: 0,
    state: 'complete',
    keyPrefixes: ['common.', 'ai.label.', 'field.', 'safety.', 'outbound.lineup.'],
    files: [],
  },

  // Phase 1 — the foreman's day. Pending until copy/voice releases each file.
  { id: 'field.daily-report', phase: 1, state: 'pending', keyPrefixes: ['field.dfr.'], files: ['app/daily-report.tsx'] },
  { id: 'field.punch', phase: 1, state: 'pending', keyPrefixes: ['field.punch.'], files: ['app/punch-list.tsx', 'app/punch-walk.tsx', 'app/punch-pin.tsx', 'app/ai-punch.tsx'] },
  { id: 'field.time-clock', phase: 1, state: 'pending', keyPrefixes: ['field.time.'], files: ['app/time-tracking.tsx'] },
  {
    id: 'field.safety',
    phase: 1,
    state: 'pending',
    keyPrefixes: ['safety.'],
    files: [
      'app/safety.tsx', 'app/safety-jha.tsx', 'app/safety-toolbox.tsx', 'app/safety-incidents.tsx',
      'app/safety-hazards.tsx', 'app/safety-inspections.tsx', 'app/safety-certifications.tsx',
      'app/safety-forms.tsx', 'app/safety-osha.tsx',
    ],
  },
  { id: 'field.deliveries', phase: 1, state: 'pending', keyPrefixes: ['field.delivery.'], files: ['app/deliveries.tsx'] },
  { id: 'field.photos', phase: 1, state: 'pending', keyPrefixes: ['field.photo.'], files: ['app/photo-triage.tsx', 'app/photo-annotator.tsx', 'app/shared-photos.tsx'] },
  { id: 'field.lineup', phase: 1, state: 'pending', keyPrefixes: ['field.lineup.', 'outbound.lineup.'], files: ['app/tomorrow-lineup.tsx'] },
  { id: 'field.ticket', phase: 1, state: 'pending', keyPrefixes: ['field.ticket.'], files: ['app/field-ticket.tsx'] },
  { id: 'field.crew', phase: 1, state: 'pending', keyPrefixes: ['field.crew.'], files: ['app/crew.tsx', 'app/claim-crew.tsx'] },
];
