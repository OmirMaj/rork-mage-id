// app/prequal-form.tsx — Subcontractor-side magic-link prequal form.
//
// Reached via the emailed link: mageid://prequal-form?token=XXXX
// No auth. No tier gate. The trust boundary is that the GC sent the
// token to a verified email. Anyone holding the token can fill out the
// packet for that specific sub — which is the entire point (the sub's
// bookkeeper, their COI carrier, etc. can all be given the same link).
//
// UX philosophy: construction subs fill these out on a phone between
// job sites. The form is a single scroll with big tap targets, sensible
// keyboard types, and no "save" / "next" paging. Autosave happens on
// every field change. "Submit for review" is a separate deliberate
// action at the bottom that flips status → 'submitted'.

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Switch, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ShieldCheck, CheckCircle2, ChevronLeft, Save, Send,
  DollarSign, HardHat, FileText, Plus, Trash2, BadgeCheck, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { reviewPrequalPacket, parsePrequalDate, normalizePrequalDateInput } from '@/utils/prequalEngine';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import ErrorState from '@/components/ErrorState';
import { describeError, rawErrorMessage } from '@/utils/errorCopy';
import type {
  PrequalPacket, PrequalFinancials, PrequalSafetyRecord,
  PrequalInsurance, PrequalLicense,
} from '@/types';

// ─────────────────────────────────────────────────────────────

// Route-level recovery (audit 2026-09-07, "Worth doing" #8). This is the ONE
// screen where restarting the bundle is unrecoverable: the sub arrived on a
// magic link with no account, so a restart lands him on the signed-out root
// with no way back to his own packet.
export { RouteErrorFallback as ErrorBoundary } from '@/components/ErrorBoundary';

// Maps a prequal_packets row (snake_case) to PrequalPacket (camelCase).
// Mirrors the inline mapper at contexts/ProjectContext.tsx:495 — kept in
// sync by hand because the contexts one runs against the authed-GC array
// while this one runs against the SECURITY DEFINER RPC result for the
// unauth sub flow (Finding 10.1).
function rowToPacket(r: Record<string, unknown>): PrequalPacket {
  return {
    id: r.id as string,
    subcontractorId: r.subcontractor_id as string,
    projectId: (r.project_id as string | null) ?? undefined,
    status: r.status as PrequalPacket['status'],
    criteria: (r.criteria as PrequalPacket['criteria']) ?? {} as PrequalPacket['criteria'],
    financials: (r.financials as PrequalPacket['financials']) ?? {} as PrequalPacket['financials'],
    safety: (r.safety as PrequalPacket['safety']) ?? {} as PrequalPacket['safety'],
    insurance: (r.insurance as PrequalPacket['insurance']) ?? {} as PrequalPacket['insurance'],
    licenses: (r.licenses as PrequalPacket['licenses']) ?? [],
    w9OnFile: !!r.w9_on_file,
    w9DocPath: (r.w9_doc_path as string | null) ?? undefined,
    inviteToken: (r.invite_token as string | null) ?? undefined,
    inviteSentAt: (r.invite_sent_at as string | null) ?? undefined,
    inviteEmail: (r.invite_email as string | null) ?? undefined,
    submittedAt: (r.submitted_at as string | null) ?? undefined,
    reviewedAt: (r.reviewed_at as string | null) ?? undefined,
    reviewedBy: (r.reviewed_by as string | null) ?? undefined,
    autoReviewFindings: (r.auto_review_findings as PrequalPacket['autoReviewFindings']) ?? undefined,
    reviewerNotes: (r.reviewer_notes as string | null) ?? undefined,
    expiresAt: (r.expires_at as string | null) ?? undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** Q5: who is asking. lookup_prequal_packet_by_token (20260924150500) returns
 *  the GC's company (read server-side from the packet owner's profile) and the
 *  sub's name from the GC's roster. '' or absent on an older server. */
function namesFromRow(r: Record<string, unknown>): { gcName: string; subName: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return { gcName: str(r.gc_company_name), subName: str(r.sub_company_name) };
}

/** How a save through submit_prequal_packet ended.
 *   'saved'   — the server took it.
 *   'refused' — the server answered false: the packet is approved, or the link
 *               has expired or been replaced by a renewal. Retrying cannot help.
 *   'failed'  — the call itself failed (offline, server error); the answers are
 *               still on screen and the next change retries. */
type PrequalSaveOutcome = 'saved' | 'refused' | 'failed';

/** reviewed_at is a timestamptz — an instant, so a local date is right. */
function formatReviewedOn(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PrequalFormScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const insets = useSafeAreaInsets();
  const { subcontractors } = useProjects();

  // Finding 10.1 — Call the SECURITY DEFINER RPC instead of relying on the
  // authed GC's local prequalPackets array. The RPC honors expires_at TTL
  // server-side + works for anon callers (no auth context needed). This
  // makes the token-bearer "no auth" design described in the file's own
  // header comment actually work.
  const [packet, setPacket] = useState<PrequalPacket | null>(null);
  const [names, setNames] = useState<{ gcName: string; subName: string }>({ gcName: '', subName: '' });
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  // Holds the CLASSIFIED copy, not `error.message` — the sub used to be shown
  // the raw PostgREST string as the whole explanation.
  const [loadError, setLoadError] = useState<{ title: string; body: string } | null>(null);
  // Bumped by the retry button so the lookup effect re-runs.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!token) { setLoadState('missing'); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('lookup_prequal_packet_by_token', {
        p_token: token,
      });
      if (cancelled) return;
      if (error) {
        console.warn('[prequal-form] packet lookup failed:', rawErrorMessage(error));
        setLoadError(describeError(error, { action: 'open your prequal packet' }));
        setLoadState('error');
        return;
      }
      if (!data) {
        setLoadState('missing');
        return;
      }
      setPacket(rowToPacket(data as Record<string, unknown>));
      setNames(namesFromRow(data as Record<string, unknown>));
      setLoadState('ok');
    })();
    return () => { cancelled = true; };
  }, [token, reloadNonce]);

  // Sub is best-effort — for authed GCs the subcontractors array is
  // populated; for anon subs (the normal case) it's empty, and the name the
  // lookup RPC read from the GC's roster is used, then "your company".
  const sub = packet ? subcontractors.find(s => s.id === packet.subcontractorId) ?? null : null;

  // RPC-backed save: submits the packet via the submit_prequal_packet
  // SECURITY DEFINER RPC. Server-side guards: token must match, packet
  // must not be approved, packet must not be expired. Status transitions
  // draft|invited|needs_changes → submitted only when p_status is
  // 'submitted'; otherwise status is preserved (autosave path).
  const saveViaRpc = useCallback(async (next: PrequalPacket, mode: 'autosave' | 'submit'): Promise<PrequalSaveOutcome> => {
    // A thrown call (fetch rejecting outright) is the same "failed" as an
    // error answer — never an unhandled rejection with no word to the sub.
    const { data, error } = await supabase.rpc('submit_prequal_packet', {
      p_token: token,
      // #114: the server no longer WRITES criteria from this path
      // (20260923130000) — the GC's thresholds are not the sub's to set. The
      // value the lookup returned is still sent, never null: until that
      // migration lands, an older server still writes this column, and a null
      // or {} here would blank the GC's criteria. Dropping the parameter is a
      // later cleanup, once every server is past the migration.
      p_criteria: next.criteria,
      p_financials: next.financials,
      p_safety: next.safety,
      p_insurance: next.insurance,
      p_licenses: next.licenses,
      p_w9_on_file: next.w9OnFile,
      p_w9_doc_path: next.w9DocPath ?? null,
      p_status: next.status,
    }).then(r => r, (thrown: unknown) => ({ data: null, error: thrown as Error }));
    if (error) {
      // The raw PostgREST text goes to the log, where an engineer reads it.
      // The sub — filling this out on a phone between job sites — gets a
      // sentence and a next step instead (audit 2026-09-07, "Worth doing" #7).
      // keptLocally: the form's useState still holds every field, and the
      // 800ms autosave will retry on his next keystroke.
      console.warn('[prequal-form] save RPC failed:', rawErrorMessage(error));
      const copy = describeError(error, { action: mode === 'submit' ? 'submit your prequal packet' : 'save your prequal packet', keptLocally: true });
      showAlert(copy.title, copy.body);
      return 'failed';
    }
    if (data !== true) {
      // Q5: said once, then the form locks (PrequalFormInner) — it used to pop
      // on every autosave pause, forever.
      showAlert(
        mode === 'submit' ? 'Not submitted' : 'Couldn\'t save',
        'This link no longer accepts changes — the packet may have been approved, or the invite link expired or was replaced. Your answers are still on this screen. Ask the GC to send a fresh link.',
      );
      return 'refused';
    }
    return 'saved';
  }, [token]);

  if (loadState === 'loading') {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorTitle}>Loading…</Text>
        <Text style={styles.errorBody}>Loading prequalification packet…</Text>
      </View>
    );
  }
  // ErrorState is the shared primitive now (components/ErrorState.tsx) — it is
  // a lift of the one that used to live at the bottom of this file, so every
  // other screen gets the same load-failure branch (audit 2026-09-07,
  // "Worth doing" #8). It renders centered inside its parent, so the screen
  // still owns the root background, the safe-area inset and the header hide.
  if (loadState === 'missing' || !packet) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorState
          title={!token ? 'Missing link' : 'Link expired or invalid'}
          body={!token
            ? 'This page was opened without a valid token. Open the invite link from your email again.'
            : 'We couldn\'t find a prequalification packet for this link, or it has expired. Ask your GC to resend the invite.'}
          onBack={() => router.back()}
          testID="prequal-missing"
        />
      </View>
    );
  }
  if (loadState === 'error') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorState
          title={loadError?.title ?? "That didn't go through"}
          body={loadError?.body ?? 'MAGE couldn\'t open your prequal packet. Try again in a moment.'}
          onRetry={() => { setLoadError(null); setLoadState('loading'); setReloadNonce(n => n + 1); }}
          onBack={() => router.back()}
          testID="prequal-load-failed"
        />
      </View>
    );
  }

  return (
    <PrequalFormInner
      packet={packet}
      gcName={names.gcName}
      subCompanyName={sub?.companyName || names.subName || 'your company'}
      onSave={saveViaRpc}
      onExit={() => router.back()}
    />
  );
}

// ─────────────────────────────────────────────────────────────

function PrequalFormInner({ packet, gcName, subCompanyName, onSave, onExit }: {
  packet: PrequalPacket;
  /** The GC's company from the lookup RPC; '' when the server did not say. */
  gcName: string;
  subCompanyName: string;
  /** Resolves to how the save ended. Autosave reads it to stop saving into a
   *  link the server refuses; Submit awaits it and says "Submitted" only on
   *  'saved' (Q5). The failure alert itself is raised inside saveViaRpc. */
  onSave: (p: PrequalPacket, mode: 'autosave' | 'submit') => Promise<PrequalSaveOutcome>;
  onExit: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Own router: the outer screen's `router` is not in scope here, and the
  // sub-profile link on the submitted state needs to push.
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [financials, setFinancials] = useState<PrequalFinancials>(packet.financials);
  const [safety, setSafety] = useState<PrequalSafetyRecord>(packet.safety);
  const [insurance, setInsurance] = useState<PrequalInsurance>(packet.insurance);
  const [licenses, setLicenses] = useState<PrequalLicense[]>(packet.licenses);
  const [w9OnFile, setW9OnFile] = useState<boolean>(packet.w9OnFile);
  const [dirty, setDirty] = useState(false);
  // Q5: the status this screen shows moves when a submit is confirmed by the
  // server, so the footer changes to "Submitted — awaiting review" without a
  // reload. Starts at what the lookup returned.
  const [status, setStatus] = useState<PrequalPacket['status']>(packet.status);
  const [submitting, setSubmitting] = useState(false);
  // Q5: the server refused a save (approved, expired or replaced link). One
  // alert, then the form locks — retrying every 800ms cannot succeed.
  const [refused, setRefused] = useState(false);
  // An approved packet is final: submit_prequal_packet refuses every write to
  // it, so the fields are read-only rather than inviting edits that bounce.
  const locked = status === 'approved' || refused;
  // Q5 (review r1): the date fields being typed in right now. Their inline
  // "not a date we can read" waits for the blur (or the submit), so it does
  // not flash under every keystroke of a half-typed "2026-1". A date that
  // arrived unreadable from the server is not in here, so it shows at once.
  const [typingDates, setTypingDates] = useState<ReadonlySet<string>>(() => new Set());
  const markTyping = useCallback((key: string, on: boolean) => {
    setTypingDates(prev => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  // ── Autosave pattern. Whenever any field changes, flip dirty; a
  // useEffect then writes back after 800ms of inactivity. We don't use
  // a library — this form has ~25 inputs and direct setState is fine.
  useEffect(() => {
    if (!dirty || locked) return;
    const h = setTimeout(() => {
      const now = new Date().toISOString();
      const next: PrequalPacket = {
        ...packet,
        status: status === 'invited' || status === 'draft' ? 'in_progress' : status,
        financials,
        safety,
        insurance,
        licenses,
        w9OnFile,
        updatedAt: now,
      };
      setDirty(false);
      void onSave(next, 'autosave').then(outcome => { if (outcome === 'refused') setRefused(true); });
    }, 800);
    return () => clearTimeout(h);
  }, [dirty, locked, status, packet, financials, safety, insurance, licenses, w9OnFile, onSave]);

  // ── Live auto-review. Runs on every render cheaply — the engine is pure.
  const preview = useMemo(() => reviewPrequalPacket({
    ...packet, financials, safety, insurance, licenses, w9OnFile,
  }), [packet, financials, safety, insurance, licenses, w9OnFile]);

  // Q5: a typed date that does not read as a real day. The engine lists it as
  // a blocker too; the submit below stops on it with the field named, because
  // the GC would only send it straight back.
  const handleSubmit = useCallback(async () => {
    if (submitting || locked) return;
    // Q5 (review r1): tidy the typed dates HERE too, not only on blur. The
    // scroll view keeps taps with keyboardShouldPersistTaps="handled", so
    // Submit tapped straight from a focused "12/31/2026" never blurred it and
    // was refused for a date one more tap would have accepted.
    const tidy = tidyTypedDates(insurance, licenses);
    if (tidy.changed) {
      setInsurance(tidy.insurance);
      setLicenses(tidy.licenses);
      setDirty(true); // so the tidied value is kept even if this submit stops below
    }
    setTypingDates(new Set());
    const unreadableDates = unreadableDatesOf(tidy.insurance, tidy.licenses);
    // An unreadable date is fixable by typing, so it is named before the hard
    // gate below (which used to catch an unreadable licence date first and say
    // "cannot be auto-approved").
    if (unreadableDates.length > 0) {
      showAlert('Check the dates',
        `${unreadableDates.join(', ')} ${unreadableDates.length === 1 ? 'is' : 'are'} not a date we can read. Enter ${unreadableDates.length === 1 ? 'it' : 'each one'} as YYYY-MM-DD, for example 2026-12-31.`);
      return;
    }
    // Allow submitting even if auto-review is 'needs_info' — the GC
    // still wants eyes on it and the checklist shows them what to ask
    // for. We only block on 'fail' with hard blockers that can't be
    // resolved by filling fields (e.g. EMR too high).
    const review = reviewPrequalPacket({
      ...packet, financials, safety, insurance: tidy.insurance, licenses: tidy.licenses, w9OnFile,
    });
    const hardFail = review.overall === 'fail' && review.findings.some(
      f => !f.passed && f.severity === 'blocker' && f.criterion !== 'coi_expiry'
      && !['cg_20_10', 'cg_20_37', 'w9', 'workers_comp', 'cgl_per_occurrence', 'cgl_aggregate'].includes(f.criterion)
    );
    if (hardFail) {
      showAlert('Can\'t submit yet',
        'Some criteria cannot be auto-approved. Review the checklist above — the GC may still accept with context in the notes, but you\'ll need to reach out directly.');
      return;
    }
    const now = new Date().toISOString();
    const next: PrequalPacket = {
      ...packet,
      status: 'submitted',
      financials, safety, insurance: tidy.insurance, licenses: tidy.licenses, w9OnFile,
      submittedAt: now,
      updatedAt: now,
    };
    // Q5: "Submitted" only once the server has it. This used to fire the save
    // and show "Submitted … sent to the GC" at once, so a dead link or a lost
    // connection showed "Submitted" and "Couldn't save" on top of each other.
    setSubmitting(true);
    // Anything typed before this tap is in `next`; a pending autosave of the
    // same answers would only race it.
    setDirty(false);
    let outcome: PrequalSaveOutcome;
    try {
      outcome = await onSave(next, 'submit');
    } finally {
      setSubmitting(false);
    }
    if (outcome === 'refused') { setRefused(true); return; }
    if (outcome !== 'saved') return; // saveViaRpc has said what went wrong
    setStatus('submitted');
    showAlert('Submitted',
      `Your prequalification packet has been sent to ${gcName || 'the GC'}. They\'ll review it and follow up if anything\'s missing.`,
      [{ text: 'Done', onPress: onExit }],
    );
  }, [submitting, locked, gcName, packet, financials, safety, insurance, licenses, w9OnFile, onSave, onExit]);

  // Field change helpers — each one just patches the right slice of
  // state. Wrapping setState inside these keeps dirty-flag bookkeeping
  // in one place.
  // A locked form (Q5) takes no edits at all — the inputs are read-only, and
  // these guards cover the switches and buttons too.
  const patchFin = useCallback((p: Partial<PrequalFinancials>) => { if (locked) return; setFinancials(f => ({ ...f, ...p })); setDirty(true); }, [locked]);
  const patchSafety = useCallback((p: Partial<PrequalSafetyRecord>) => { if (locked) return; setSafety(s => ({ ...s, ...p })); setDirty(true); }, [locked]);
  const patchIns = useCallback((p: Partial<PrequalInsurance>) => { if (locked) return; setInsurance(i => ({ ...i, ...p })); setDirty(true); }, [locked]);
  const toggleW9 = useCallback((v: boolean) => { if (locked) return; setW9OnFile(v); setDirty(true); }, [locked]);

  const addLicense = useCallback(() => {
    if (locked) return;
    setLicenses(ls => [...ls, { id: generateUUID(), state: '', number: '', classification: '', expiresAt: '' }]);
    setDirty(true);
  }, [locked]);
  const patchLicense = useCallback((id: string, p: Partial<PrequalLicense>) => {
    if (locked) return;
    setLicenses(ls => ls.map(l => l.id === id ? { ...l, ...p } : l));
    setDirty(true);
  }, [locked]);
  const removeLicense = useCallback((id: string) => {
    if (locked) return;
    setLicenses(ls => ls.filter(l => l.id !== id));
    setDirty(true);
  }, [locked]);

  // Q5: a typed date is tidied on blur — "12/31/2026" becomes "2026-12-31" —
  // and left as typed (with the error under it) when it cannot be read.
  const tidyCoiDate = useCallback(() => {
    markTyping('coi', false);
    const raw = insurance.coiExpiry ?? '';
    const tidy = normalizePrequalDateInput(raw);
    if (tidy && tidy !== raw) patchIns({ coiExpiry: tidy });
  }, [insurance.coiExpiry, patchIns, markTyping]);
  const tidyLicenseDate = useCallback((id: string, raw: string) => {
    markTyping(`lic:${id}`, false);
    const tidy = normalizePrequalDateInput(raw);
    if (tidy && tidy !== raw) patchLicense(id, { expiresAt: tidy });
  }, [patchLicense, markTyping]);

  const isSubmitted = status === 'submitted' || status === 'approved';
  // #111: the GC's decision, said to the sub. reviewer_notes came back from the
  // lookup and was never rendered, so a sub sent back for changes reopened his
  // link to a form that looked untouched.
  const needsChanges = status === 'needs_changes';
  const rejected = status === 'rejected';
  const reviewedOn = packet.reviewedAt ? formatReviewedOn(packet.reviewedAt) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={onExit} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          {/* Q5: name who is asking — a form that asks for revenue and
              insurance limits and names nobody reads like phishing. */}
          <Text style={styles.headerEyebrow} numberOfLines={1} testID="prequal-requester">
            {gcName ? `Prequalification for ${gcName}` : 'Prequalification request'}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{subCompanyName}</Text>
        </View>
        {dirty && !locked && (
          <View style={styles.savingChip}>
            <Save size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.savingChipText}>Saving…</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FormLockContext.Provider value={locked}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 + insets.bottom }} keyboardShouldPersistTaps="handled">
          {/* Q5 — a locked form says why, once, instead of an alert per keystroke. */}
          {locked && (
            <View style={[styles.decisionCard, status === 'approved' && styles.decisionCardApproved]} testID="prequal-locked">
              {status === 'approved'
                ? <CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />
                : <AlertTriangle size={18} color={Colors.warningLabel} strokeWidth={1.75} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.decisionTitle}>
                  {status === 'approved' ? 'Approved — answers locked' : 'This link no longer accepts changes'}
                </Text>
                <Text style={styles.decisionBody}>
                  {status === 'approved'
                    ? `${gcName || 'The GC'} approved this packet, so it can\u2019t be edited here. If something has changed, ask them to send you a renewal.`
                    : 'It may have been approved, or the invite link expired or was replaced. Your answers are still on this screen. Ask the GC to send a fresh link.'}
                </Text>
              </View>
            </View>
          )}

          {/* #111 — the decision and the GC's note, word for word. */}
          {(needsChanges || rejected) && (
            <View style={[styles.decisionCard, rejected && styles.decisionCardRejected]} testID={needsChanges ? 'prequal-needs-changes' : 'prequal-rejected'}>
              <AlertTriangle size={18} color={rejected ? themeColors.danger : Colors.warningLabel} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.decisionTitle}>
                  {needsChanges ? 'The GC asked for changes' : 'Not approved'}
                  {reviewedOn ? ` · ${reviewedOn}` : ''}
                </Text>
                {packet.reviewerNotes ? (
                  <Text style={styles.decisionNote}>{packet.reviewerNotes}</Text>
                ) : null}
                <Text style={styles.decisionBody}>
                  {needsChanges
                    ? 'Update the answers below, then tap Resubmit at the bottom.'
                    // submit_prequal_packet moves only draft / invited /
                    // needs_changes to submitted, so a rejected packet stays
                    // rejected whatever is tapped here. Say so.
                    : 'Your answers below still save, but this packet can’t be resubmitted from this link. If you want to be considered again, ask the GC to send you a renewal.'}
                </Text>
              </View>
            </View>
          )}

          {/* Intro */}
          <View style={styles.introCard}>
            <ShieldCheck size={18} color={themeColors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={styles.introTitle}>About this form</Text>
              <Text style={styles.introBody}>
                {gcName ? `${gcName} is` : 'Your GC is'} collecting standard compliance docs — COI limits, licenses, safety
                record. It takes about 10 minutes, everything autosaves, and you don{"\u2019"}t need an
                account. When you{"\u2019"}re done, tap Submit and they{"\u2019"}ll review within a day or two.
              </Text>
            </View>
          </View>

          {/* Live checklist */}
          <View style={[styles.checklistCard, {
            borderLeftColor: preview.overall === 'pass' ? themeColors.success : preview.overall === 'fail' ? themeColors.danger : Colors.warning,
            backgroundColor: preview.overall === 'pass' ? Colors.successLight : preview.overall === 'fail' ? Colors.errorLight : Colors.warningLight,
          }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              {preview.overall === 'pass' && <CheckCircle2 size={Type.footnote.fontSize} color={themeColors.success} strokeWidth={2} />}
              <Text style={styles.checklistTitle}>
                {preview.overall === 'pass' ? 'Ready to submit'
                  : preview.missingFields.length > 0
                    ? `${preview.missingFields.length} field${preview.missingFields.length === 1 ? '' : 's'} left`
                    : 'Review the flags below'}
              </Text>
            </View>
            {preview.missingFields.length > 0 && (
              <Text style={styles.checklistSub}>Missing: {preview.missingFields.join(', ')}</Text>
            )}
          </View>

          {/* ── Financials ──────────────────────────────── */}
          <SectionHeader icon={<DollarSign size={14} color={themeColors.accent} strokeWidth={1.75} />} title="Company & Financials" />

          <Field label="Years in business"
            value={financials.yearsInBusiness?.toString() ?? ''}
            onChangeText={(v) => patchFin({ yearsInBusiness: toNum(v) })}
            keyboardType="number-pad" placeholder="e.g. 8" />

          <Field label="Annual revenue (USD)"
            value={financials.annualRevenue?.toString() ?? ''}
            onChangeText={(v) => patchFin({ annualRevenue: toNum(v) })}
            keyboardType="number-pad" placeholder="Rolled up last 12 months" />

          <Field label="Largest project completed (USD)"
            value={financials.largestProjectCompleted?.toString() ?? ''}
            onChangeText={(v) => patchFin({ largestProjectCompleted: toNum(v) })}
            keyboardType="number-pad" placeholder="Helps us match scope" />

          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Single-project bonding"
                value={financials.bondingCapacitySingle?.toString() ?? ''}
                onChangeText={(v) => patchFin({ bondingCapacitySingle: toNum(v) })}
                keyboardType="number-pad" placeholder="Leave blank if unbonded" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Aggregate bonding"
                value={financials.bondingCapacityAggregate?.toString() ?? ''}
                onChangeText={(v) => patchFin({ bondingCapacityAggregate: toNum(v) })}
                keyboardType="number-pad" placeholder="Aggregate cap" />
            </View>
          </Row>

          <Field label="Bank reference (optional)"
            value={financials.bankReference ?? ''}
            onChangeText={(v) => patchFin({ bankReference: v })}
            placeholder="Bank name & contact" />

          {/* ── Insurance ──────────────────────────────── */}
          <SectionHeader icon={<ShieldCheck size={14} color={themeColors.accent} strokeWidth={1.75} />} title="Insurance" />

          <Row>
            <View style={{ flex: 1 }}>
              <Field label="CGL per occurrence"
                value={insurance.cglPerOccurrence?.toString() ?? ''}
                onChangeText={(v) => patchIns({ cglPerOccurrence: toNum(v) })}
                keyboardType="number-pad" placeholder={`$${packet.criteria.minCglPerOccurrence.toLocaleString()} min`} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="CGL aggregate"
                value={insurance.cglAggregate?.toString() ?? ''}
                onChangeText={(v) => patchIns({ cglAggregate: toNum(v) })}
                keyboardType="number-pad" placeholder={`$${packet.criteria.minCglAggregate.toLocaleString()} min`} />
            </View>
          </Row>

          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Auto liability"
                value={insurance.autoLiability?.toString() ?? ''}
                onChangeText={(v) => patchIns({ autoLiability: toNum(v) })}
                keyboardType="number-pad" placeholder="Vehicles/fleet" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Umbrella"
                value={insurance.umbrella?.toString() ?? ''}
                onChangeText={(v) => patchIns({ umbrella: toNum(v) })}
                keyboardType="number-pad" placeholder="Excess coverage" />
            </View>
          </Row>

          <Field label="COI expiry date (YYYY-MM-DD)"
            value={insurance.coiExpiry ?? ''}
            onChangeText={(v) => { markTyping('coi', true); patchIns({ coiExpiry: v }); }}
            onBlur={tidyCoiDate}
            error={typingDates.has('coi') ? undefined : dateError(insurance.coiExpiry)}
            placeholder="2026-12-31" autoCapitalize="none" />

          <ToggleRow label="Workers Comp — active policy"
            value={!!insurance.workersCompActive}
            onValueChange={(v) => patchIns({ workersCompActive: v })} />
          {insurance.workersCompActive && (
            <Field label="Workers Comp carrier"
              value={insurance.workersCompCarrier ?? ''}
              onChangeText={(v) => patchIns({ workersCompCarrier: v })}
              placeholder="Carrier name" />
          )}

          <ToggleRow label="CG 20 10 endorsement (ongoing ops, additional insured)"
            value={!!insurance.hasCG2010}
            onValueChange={(v) => patchIns({ hasCG2010: v })} />
          <ToggleRow label="CG 20 37 endorsement (completed ops)"
            value={!!insurance.hasCG2037}
            onValueChange={(v) => patchIns({ hasCG2037: v })} />
          <ToggleRow label="Waiver of subrogation"
            value={!!insurance.waiverOfSubrogation}
            onValueChange={(v) => patchIns({ waiverOfSubrogation: v })} />

          {/* ── Safety ──────────────────────────────── */}
          <SectionHeader icon={<HardHat size={14} color={themeColors.accent} strokeWidth={1.75} />} title="Safety Record" />

          <Text style={styles.helperText}>
            3-year EMR (Experience Modification Rate). Lower is better — 1.0 is industry average.
          </Text>
          <Row>
            {(['Year 1', 'Year 2', 'Year 3'] as const).map((label, i) => (
              <View key={label} style={{ flex: 1 }}>
                <Field label={label}
                  value={safety.emr3yr?.[i]?.toString() ?? ''}
                  onChangeText={(v) => {
                    const cur: [number | undefined, number | undefined, number | undefined] =
                      safety.emr3yr ? [safety.emr3yr[0], safety.emr3yr[1], safety.emr3yr[2]] : [undefined, undefined, undefined];
                    cur[i] = toNum(v);
                    patchSafety({ emr3yr: cur });
                  }}
                  keyboardType="decimal-pad" placeholder="e.g. 0.87" />
              </View>
            ))}
          </Row>

          <ToggleRow label="Written safety program on file"
            value={!!safety.writtenSafetyProgram}
            onValueChange={(v) => patchSafety({ writtenSafetyProgram: v })} />
          <ToggleRow label="Recordable incident in last 3 years"
            value={!!safety.hadRecordableIncident}
            onValueChange={(v) => patchSafety({ hadRecordableIncident: v })} />

          {/* ── Licenses ──────────────────────────────── */}
          <SectionHeader icon={<BadgeCheck size={14} color={themeColors.accent} strokeWidth={1.75} />} title="Licenses" />

          {licenses.length === 0 && (
            <Text style={styles.helperText}>
              Add each state license. Some trades (e.g. painting in many states) don{"\u2019"}t require
              a license — leave empty if so.
            </Text>
          )}

          {licenses.map(lic => (
            <View key={lic.id} style={styles.licenseCard}>
              <Row>
                <View style={{ flex: 0.4 }}>
                  <Field label="State" value={lic.state}
                    onChangeText={(v) => patchLicense(lic.id, { state: v.toUpperCase().slice(0, 2) })}
                    autoCapitalize="characters" placeholder="CA" />
                </View>
                <View style={{ flex: 0.6 }}>
                  <Field label="Classification" value={lic.classification}
                    onChangeText={(v) => patchLicense(lic.id, { classification: v })}
                    placeholder="B, C-10, etc." />
                </View>
              </Row>
              <Row>
                <View style={{ flex: 1 }}>
                  <Field label="License #" value={lic.number}
                    onChangeText={(v) => patchLicense(lic.id, { number: v })}
                    placeholder="123456" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Expiry (YYYY-MM-DD)" value={lic.expiresAt}
                    onChangeText={(v) => { markTyping(`lic:${lic.id}`, true); patchLicense(lic.id, { expiresAt: v }); }}
                    onBlur={() => tidyLicenseDate(lic.id, lic.expiresAt)}
                    error={typingDates.has(`lic:${lic.id}`) ? undefined : dateError(lic.expiresAt)}
                    placeholder="2026-06-30" autoCapitalize="none" />
                </View>
              </Row>
              {!locked && (
                <TouchableOpacity onPress={() => removeLicense(lic.id)} style={styles.removeBtn} hitSlop={8}>
                  <Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} />
                  <Text style={styles.removeBtnText}>Remove license</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {!locked && (
            <TouchableOpacity onPress={addLicense} style={styles.addLicenseBtn}>
              <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.addLicenseText}>Add license</Text>
            </TouchableOpacity>
          )}

          {/* ── W-9 ──────────────────────────────── */}
          <SectionHeader icon={<FileText size={14} color={themeColors.accent} strokeWidth={1.75} />} title="Tax / W-9" />
          <ToggleRow label="W-9 on file with this GC"
            value={w9OnFile}
            onValueChange={toggleW9} />
          <Text style={styles.helperText}>
            If you haven{"\u2019"}t sent a W-9 yet, email it separately to your contact or bring a
            copy to kickoff. MAGE doesn{"\u2019"}t upload tax forms through this link.
          </Text>
        </ScrollView>
        </FormLockContext.Provider>
      </KeyboardAvoidingView>

      {/* Submit footer */}
      <View style={[styles.submitBar, { paddingBottom: 12 + insets.bottom }]}>
        {isSubmitted ? (
          <>
            <View style={styles.submittedChip}>
              <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.submittedText}>
                {status === 'approved' ? 'Approved — you\'re all set' : 'Submitted — awaiting review'}
              </Text>
            </View>
            {/* #113: this link used to promise "your work history across every
                contractor who has hired you". Signed out — the sub on a magic
                link, the normal case — it bounced him to the login and lost this
                page; signed in, /sub-profile reads only his own workspace, which
                holds no GC's records about him. No server fan-out exists yet,
                so nothing here claims cross-contractor history. Signed out he
                is offered an account and told plainly what it is. */}
            {isAuthenticated ? (
              <TouchableOpacity
                style={styles.subProfileLink}
                onPress={() => router.push('/sub-profile')}
                accessibilityRole="link"
                accessibilityLabel="Open your work profile for this workspace"
              >
                <Text style={styles.subProfileLinkText}>Open your work profile (this workspace)</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.subProfileLink}
                onPress={() => router.push('/signup')}
                accessibilityRole="link"
                accessibilityLabel="Create your free MAGE ID account"
              >
                <Text style={styles.subProfileLinkText}>Create your free MAGE ID account</Text>
                <Text style={styles.subProfileLinkHint}>
                  A free workspace for your own jobs. This packet stays with the contractor who sent it.
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : refused ? (
          <View style={styles.submittedChip}>
            <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.submittedText}>Link closed — ask the GC for a fresh link</Text>
          </View>
        ) : rejected ? (
          // No bare "Submit" on a rejected packet: the server keeps it
          // rejected, and a "Submitted" alert over that would be a lie.
          <View style={styles.submittedChip}>
            <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.submittedText}>Not approved — ask the GC for a renewal to resubmit</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, (preview.overall !== 'pass' || submitting) && styles.submitBtnDisabled]}
            onPress={() => { void handleSubmit(); }}
            disabled={submitting}
            accessibilityState={{ disabled: submitting }}
            activeOpacity={0.8}
            testID="prequal-submit"
          >
            <Send size={16} color={'#FFFFFF'} strokeWidth={1.75} />
            <Text style={styles.submitBtnText}>
              {submitting ? 'Sending…' : needsChanges ? 'Resubmit' : preview.overall === 'pass' ? 'Submit for review' : 'Submit anyway'}
            </Text>
          </TouchableOpacity>
        )}
        {preview.overall !== 'pass' && !isSubmitted && !rejected && !refused && (
          <Text style={styles.submitHelper}>
            {preview.missingFields.length > 0
              ? 'Some fields are empty. You can still submit and the GC will follow up.'
              : 'A few criteria won\'t auto-approve — the GC will review manually.'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Primitives

/** Q5: true while the form is locked (approved, or the link refused a save).
 *  Field and ToggleRow read it, so every input goes read-only in one place. */
const FormLockContext = React.createContext(false);

/** Q5: the typed dates as they will be saved — "12/31/2026" and "2026/1/5"
 *  tidied to YYYY-MM-DD, anything unreadable left exactly as typed. `changed`
 *  is false (and the inputs come back as the same objects) when nothing moved. */
function tidyTypedDates(insurance: PrequalInsurance, licenses: PrequalLicense[]): {
  insurance: PrequalInsurance; licenses: PrequalLicense[]; changed: boolean;
} {
  const tidyOf = (raw: string | undefined) => {
    const t = raw && raw.trim() ? normalizePrequalDateInput(raw) : null;
    return t && t !== raw ? t : null;
  };
  const coi = tidyOf(insurance.coiExpiry);
  let changed = !!coi;
  const nextLicenses = licenses.map(l => {
    const t = tidyOf(l.expiresAt);
    if (!t) return l;
    changed = true;
    return { ...l, expiresAt: t };
  });
  return {
    insurance: coi ? { ...insurance, coiExpiry: coi } : insurance,
    licenses: changed ? nextLicenses : licenses,
    changed,
  };
}

/** Q5: every typed date that still does not read as a real day, named for the
 *  "Check the dates" alert. Blank is fine (not given yet). */
function unreadableDatesOf(insurance: PrequalInsurance, licenses: PrequalLicense[]): string[] {
  const out: string[] = [];
  const coi = (insurance.coiExpiry ?? '').trim();
  if (coi && !parsePrequalDate(coi)) out.push(`COI expiry "${coi}"`);
  for (const l of licenses) {
    const d = (l.expiresAt ?? '').trim();
    if (d && !parsePrequalDate(d)) out.push(`${l.state || 'licence'} expiry "${d}"`);
  }
  return out;
}

/** The inline error under a typed date: blank is fine (not given yet), a
 *  readable YYYY-MM-DD is fine, anything else is named. */
function dateError(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  if (!v || parsePrequalDate(v)) return undefined;
  return 'Not a date we can read — use YYYY-MM-DD, e.g. 2026-12-31';
}

// The local ErrorState that used to live here moved to
// components/ErrorState.tsx — unchanged in shape, generalised on onRetry /
// steps / icon so the ~150 screens with no load-failure branch at all can use
// it (audit 2026-09-07, "Worth doing" #8).

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onBlur?: () => void;
  /** Shown under the input when set (Q5: an unreadable date). */
  error?: string;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const locked = React.useContext(FormLockContext);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.input, locked && styles.inputLocked, !!props.error && styles.inputError]}
        value={props.value}
        onChangeText={props.onChangeText}
        onBlur={props.onBlur}
        editable={!locked}
        placeholder={props.placeholder}
        placeholderTextColor={themeColors.textMuted}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
      {props.error ? <Text style={styles.fieldError}>{props.error}</Text> : null}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.row}>{children}</View>;
}

function ToggleRow({ label, value, onValueChange }: {
  label: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const locked = React.useContext(FormLockContext);
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} disabled={locked}
        trackColor={{ true: themeColors.accent, false: themeColors.surfaceAlt }}
        thumbColor={Platform.OS === 'android' ? (value ? '#FFFFFF' : '#fff') : undefined} />
    </View>
  );
}

// Parse a user-entered number. Empty → undefined. Strips $ and commas.
function toNum(v: string): number | undefined {
  const cleaned = v.replace(/[$,]/g, '').trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// ─────────────────────────────────────────────────────────────
// Styles

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
    gap: 8, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  headerEyebrow: { fontSize: 10, color: t.accent, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  savingChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillSecondary },
  savingChipText: { fontSize: 10, color: t.textSecondary, fontWeight: '600' },

  introCard: {
    flexDirection: 'row', gap: 10, padding: 14, borderRadius: Tokens.radius.card, backgroundColor: Colors.card,
    borderLeftWidth: 3, borderLeftColor: t.accent, marginBottom: 12,
  },
  introTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text, marginBottom: 2 },
  introBody: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  checklistCard: {
    padding: 12, borderRadius: Tokens.radius.md, borderLeftWidth: 3, marginBottom: 18,
  },
  checklistTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  checklistSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 4, lineHeight: 15 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, marginBottom: 10 },
  sectionHeaderText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1 },

  field: { marginBottom: 12 },
  fieldLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: {
    backgroundColor: Colors.fillSecondary, borderRadius: Tokens.radius.md, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputLocked: { opacity: 0.6 },
  inputError: { borderWidth: 1, borderColor: t.danger },
  fieldError: { fontSize: Type.caption2.fontSize, color: t.dangerLabel, marginTop: 4, lineHeight: 15 },
  row: { flexDirection: 'row', gap: 10 },
  helperText: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 15 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.line,
  },
  toggleLabel: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, paddingRight: 10 },

  licenseCard: {
    padding: 12, borderRadius: Tokens.radius.md, backgroundColor: Colors.card, marginBottom: 10,
    borderWidth: 1, borderColor: t.line,
  },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-end' },
  removeBtnText: { fontSize: Type.caption2.fontSize, color: t.danger, fontWeight: '600' },

  addLicenseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: t.accent, marginTop: 4,
  },
  addLicenseText: { color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '700' },

  submitBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: t.line,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accentFill,
  },
  submitBtnDisabled: { backgroundColor: t.textMuted },
  submitBtnText: { color: '#FFFFFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' },
  submitHelper: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 15 },

  submittedChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: Colors.successLight,
  },
  submittedText: { color: t.success, fontSize: Type.footnote.fontSize, fontWeight: '700' },
  subProfileLink: { paddingTop: 10, paddingBottom: 2, alignItems: 'center' as const },
  subProfileLinkText: { color: t.accentLabel, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, textAlign: 'center' as const },
  subProfileLinkHint: { color: t.textMuted, fontSize: Type.caption2.fontSize, textAlign: 'center' as const, marginTop: 2 },

  decisionCard: {
    flexDirection: 'row' as const, gap: 10, padding: 14, marginBottom: 12,
    borderRadius: Tokens.radius.md, borderLeftWidth: 3, borderLeftColor: Colors.warning, backgroundColor: Colors.warningLight,
  },
  decisionCardRejected: { borderLeftColor: t.danger, backgroundColor: Colors.errorLight },
  decisionCardApproved: { borderLeftColor: t.success, backgroundColor: Colors.successLight },
  decisionTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  decisionNote: { fontSize: Type.footnote.fontSize, color: t.text, marginTop: 6, lineHeight: 19, fontStyle: 'italic' as const },
  decisionBody: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 6, lineHeight: 16 },

  // Still used by the "Loading…" branch above; the failure branches render
  // components/ErrorState.tsx, which carries its own type + button styles.
  errorTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, marginTop: 12 },
  errorBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
});
