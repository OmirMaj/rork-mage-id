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
  ShieldCheck, CheckCircle2, AlertTriangle, ChevronLeft, Save, Send,
  DollarSign, HardHat, FileText, Plus, Trash2, BadgeCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { supabase } from '@/lib/supabase';
import { reviewPrequalPacket } from '@/utils/prequalEngine';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import type {
  PrequalPacket, PrequalFinancials, PrequalSafetyRecord,
  PrequalInsurance, PrequalLicense,
} from '@/types';

// ─────────────────────────────────────────────────────────────

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

export default function PrequalFormScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const { subcontractors } = useProjects();

  // Finding 10.1 — Call the SECURITY DEFINER RPC instead of relying on the
  // authed GC's local prequalPackets array. The RPC honors expires_at TTL
  // server-side + works for anon callers (no auth context needed). This
  // makes the token-bearer "no auth" design described in the file's own
  // header comment actually work.
  const [packet, setPacket] = useState<PrequalPacket | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoadState('missing'); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('lookup_prequal_packet_by_token', {
        p_token: token,
      });
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoadState('error');
        return;
      }
      if (!data) {
        setLoadState('missing');
        return;
      }
      setPacket(rowToPacket(data as Record<string, unknown>));
      setLoadState('ok');
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Sub is best-effort — for authed GCs the subcontractors array is
  // populated; for anon subs it's empty and we fall back to "your company".
  const sub = packet ? subcontractors.find(s => s.id === packet.subcontractorId) ?? null : null;

  // RPC-backed save: submits the packet via the submit_prequal_packet
  // SECURITY DEFINER RPC. Server-side guards: token must match, packet
  // must not be approved, packet must not be expired. Status transitions
  // draft|invited|needs_changes → submitted only when p_status is
  // 'submitted'; otherwise status is preserved (autosave path).
  const saveViaRpc = useCallback(async (next: PrequalPacket) => {
    const { data, error } = await supabase.rpc('submit_prequal_packet', {
      p_token: token,
      p_criteria: next.criteria,
      p_financials: next.financials,
      p_safety: next.safety,
      p_insurance: next.insurance,
      p_licenses: next.licenses,
      p_w9_on_file: next.w9OnFile,
      p_w9_doc_path: next.w9DocPath ?? null,
      p_status: next.status,
    });
    if (error) {
      console.warn('[prequal-form] save RPC failed:', error.message);
      showAlert('Save failed', error.message);
      return;
    }
    if (data !== true) {
      showAlert(
        'Couldn\'t save',
        'The packet may have been approved or the invite link expired. Ask the GC to send a fresh link.',
      );
    }
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
  if (loadState === 'missing' || !packet) {
    return <ErrorState
      title={!token ? 'Missing link' : 'Link expired or invalid'}
      body={!token
        ? 'This page was opened without a valid token. Open the invite link from your email again.'
        : 'We couldn\'t find a prequalification packet for this link, or it has expired. Ask your GC to resend the invite.'}
      onBack={() => router.back()}
    />;
  }
  if (loadState === 'error') {
    return <ErrorState
      title="Couldn't load packet"
      body={loadError ?? 'A network or server error occurred. Try again in a moment.'}
      onBack={() => router.back()}
    />;
  }

  return <PrequalFormInner packet={packet} subCompanyName={sub?.companyName ?? 'your company'} onSave={saveViaRpc} onExit={() => router.back()} />;
}

// ─────────────────────────────────────────────────────────────

function PrequalFormInner({ packet, subCompanyName, onSave, onExit }: {
  packet: PrequalPacket;
  subCompanyName: string;
  /** Async or sync; the autosave + handleSubmit callers don't await this
   *  (fire-and-forget). Errors are surfaced inside the save handler via
   *  Alert (see saveViaRpc in the parent). */
  onSave: (p: PrequalPacket) => void | Promise<void>;
  onExit: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [financials, setFinancials] = useState<PrequalFinancials>(packet.financials);
  const [safety, setSafety] = useState<PrequalSafetyRecord>(packet.safety);
  const [insurance, setInsurance] = useState<PrequalInsurance>(packet.insurance);
  const [licenses, setLicenses] = useState<PrequalLicense[]>(packet.licenses);
  const [w9OnFile, setW9OnFile] = useState<boolean>(packet.w9OnFile);
  const [dirty, setDirty] = useState(false);

  // ── Autosave pattern. Whenever any field changes, flip dirty; a
  // useEffect then writes back after 800ms of inactivity. We don't use
  // a library — this form has ~25 inputs and direct setState is fine.
  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(() => {
      const now = new Date().toISOString();
      const next: PrequalPacket = {
        ...packet,
        status: packet.status === 'invited' || packet.status === 'draft' ? 'in_progress' : packet.status,
        financials,
        safety,
        insurance,
        licenses,
        w9OnFile,
        updatedAt: now,
      };
      onSave(next);
      setDirty(false);
    }, 800);
    return () => clearTimeout(h);
  }, [dirty, packet, financials, safety, insurance, licenses, w9OnFile, onSave]);

  // ── Live auto-review. Runs on every render cheaply — the engine is pure.
  const preview = useMemo(() => reviewPrequalPacket({
    ...packet, financials, safety, insurance, licenses, w9OnFile,
  }), [packet, financials, safety, insurance, licenses, w9OnFile]);

  const handleSubmit = useCallback(() => {
    // Allow submitting even if auto-review is 'needs_info' — the GC
    // still wants eyes on it and the checklist shows them what to ask
    // for. We only block on 'fail' with hard blockers that can't be
    // resolved by filling fields (e.g. EMR too high).
    const hardFail = preview.overall === 'fail' && preview.findings.some(
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
      financials, safety, insurance, licenses, w9OnFile,
      submittedAt: now,
      updatedAt: now,
    };
    onSave(next);
    showAlert('Submitted',
      'Your prequalification packet has been sent to the GC. They\'ll review it within a day or two and follow up if anything\'s missing.',
      [{ text: 'Done', onPress: onExit }],
    );
  }, [packet, financials, safety, insurance, licenses, w9OnFile, preview, onSave, onExit]);

  // Field change helpers — each one just patches the right slice of
  // state. Wrapping setState inside these keeps dirty-flag bookkeeping
  // in one place.
  const patchFin = useCallback((p: Partial<PrequalFinancials>) => { setFinancials(f => ({ ...f, ...p })); setDirty(true); }, []);
  const patchSafety = useCallback((p: Partial<PrequalSafetyRecord>) => { setSafety(s => ({ ...s, ...p })); setDirty(true); }, []);
  const patchIns = useCallback((p: Partial<PrequalInsurance>) => { setInsurance(i => ({ ...i, ...p })); setDirty(true); }, []);
  const toggleW9 = useCallback((v: boolean) => { setW9OnFile(v); setDirty(true); }, []);

  const addLicense = useCallback(() => {
    setLicenses(ls => [...ls, { id: generateUUID(), state: '', number: '', classification: '', expiresAt: '' }]);
    setDirty(true);
  }, []);
  const patchLicense = useCallback((id: string, p: Partial<PrequalLicense>) => {
    setLicenses(ls => ls.map(l => l.id === id ? { ...l, ...p } : l));
    setDirty(true);
  }, []);
  const removeLicense = useCallback((id: string) => {
    setLicenses(ls => ls.filter(l => l.id !== id));
    setDirty(true);
  }, []);

  const isSubmitted = packet.status === 'submitted' || packet.status === 'approved';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={onExit} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Prequalification · MAGE</Text>
          <Text style={styles.headerTitle}>{subCompanyName}</Text>
        </View>
        {dirty && (
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
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 + insets.bottom }} keyboardShouldPersistTaps="handled">
          {/* Intro */}
          <View style={styles.introCard}>
            <ShieldCheck size={18} color={themeColors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={styles.introTitle}>About this form</Text>
              <Text style={styles.introBody}>
                Your GC is collecting standard compliance docs — COI limits, licenses, safety
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
            onChangeText={(v) => patchIns({ coiExpiry: v })}
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
                    onChangeText={(v) => patchLicense(lic.id, { expiresAt: v })}
                    placeholder="2026-06-30" autoCapitalize="none" />
                </View>
              </Row>
              <TouchableOpacity onPress={() => removeLicense(lic.id)} style={styles.removeBtn} hitSlop={8}>
                <Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.removeBtnText}>Remove license</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity onPress={addLicense} style={styles.addLicenseBtn}>
            <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.addLicenseText}>Add license</Text>
          </TouchableOpacity>

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
      </KeyboardAvoidingView>

      {/* Submit footer */}
      <View style={[styles.submitBar, { paddingBottom: 12 + insets.bottom }]}>
        {isSubmitted ? (
          <View style={styles.submittedChip}>
            <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.submittedText}>
              {packet.status === 'approved' ? 'Approved — you\'re all set' : 'Submitted — awaiting review'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, preview.overall !== 'pass' && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
          >
            <Send size={16} color={'#FFFFFF'} strokeWidth={1.75} />
            <Text style={styles.submitBtnText}>
              {preview.overall === 'pass' ? 'Submit for review' : 'Submit anyway'}
            </Text>
          </TouchableOpacity>
        )}
        {preview.overall !== 'pass' && !isSubmitted && (
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

function ErrorState({ title, body, onBack }: { title: string; body: string; onBack: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AlertTriangle size={32} color={Colors.warning} strokeWidth={1.75} />
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorBody}>{body}</Text>
      <TouchableOpacity onPress={onBack} style={styles.errorBtn}>
        <Text style={styles.errorBtnText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

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
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={themeColors.textMuted}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
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
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange}
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
  headerTitle: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text },

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
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  submitBtnDisabled: { backgroundColor: t.textMuted },
  submitBtnText: { color: '#FFFFFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' },
  submitHelper: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 15 },

  submittedChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: Colors.successLight,
  },
  submittedText: { color: t.success, fontSize: Type.footnote.fontSize, fontWeight: '700' },

  errorTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text, marginTop: 12 },
  errorBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  errorBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  errorBtnText: { color: '#FFFFFF', fontWeight: '700' },
});
