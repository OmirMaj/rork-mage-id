// app/prequal-form.tsx — Subcontractor-side magic-link prequal form.
//
// Reached via the emailed link: rork-app://prequal-form?token=XXXX
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
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Switch, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ShieldCheck, CheckCircle2, AlertTriangle, ChevronLeft, Save, Send,
  DollarSign, HardHat, FileText, Plus, Trash2, BadgeCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { reviewPrequalPacket } from '@/utils/prequalEngine';
import { generateUUID } from '@/utils/generateId';
import type {
  PrequalPacket, PrequalFinancials, PrequalSafetyRecord,
  PrequalInsurance, PrequalLicense,
} from '@/types';

// ─────────────────────────────────────────────────────────────

export default function PrequalFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const { getPrequalPacketByToken, upsertPrequalPacket, subcontractors } = useProjects();

  const packet = useMemo(() => (token ? getPrequalPacketByToken(token) : null), [token, getPrequalPacketByToken]);
  const sub = useMemo(() => packet ? subcontractors.find(s => s.id === packet.subcontractorId) ?? null : null, [packet, subcontractors]);

  if (!token) {
    return <ErrorState title="Missing link" body="This page was opened without a valid token. Open the invite link from your email again." onBack={() => router.back()} />;
  }
  if (!packet) {
    return <ErrorState title="Link expired or invalid" body="We couldn't find a prequalification packet for this link. Ask your GC to resend the invite." onBack={() => router.back()} />;
  }

  return <PrequalFormInner packet={packet} subCompanyName={sub?.companyName ?? 'your company'} onSave={upsertPrequalPacket} onExit={() => router.back()} />;
}

// ─────────────────────────────────────────────────────────────

function PrequalFormInner({ packet, subCompanyName, onSave, onExit }: {
  packet: PrequalPacket;
  subCompanyName: string;
  onSave: (p: PrequalPacket) => void;
  onExit: () => void;
}) {
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
      Alert.alert('Can\'t submit yet',
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
    Alert.alert('Submitted',
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
        <TouchableOpacity onPress={onExit} style={styles.headerBtn} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Prequalification · MAGE</Text>
          <Text style={styles.headerTitle}>{subCompanyName}</Text>
        </View>
        {dirty && (
          <View style={styles.savingChip}>
            <Save size={12} color={Colors.textSecondary} />
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
            <ShieldCheck size={18} color={Colors.primary} />
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
            borderLeftColor: preview.overall === 'pass' ? Colors.success : preview.overall === 'fail' ? Colors.error : Colors.warning,
            backgroundColor: preview.overall === 'pass' ? Colors.successLight : preview.overall === 'fail' ? Colors.errorLight : Colors.warningLight,
          }]}>
            <Text style={styles.checklistTitle}>
              {preview.overall === 'pass' ? '✓ Ready to submit'
                : preview.missingFields.length > 0
                  ? `${preview.missingFields.length} field${preview.missingFields.length === 1 ? '' : 's'} left`
                  : 'Review the flags below'}
            </Text>
            {preview.missingFields.length > 0 && (
              <Text style={styles.checklistSub}>Missing: {preview.missingFields.join(', ')}</Text>
            )}
          </View>

          {/* ── Financials ──────────────────────────────── */}
          <SectionHeader icon={<DollarSign size={14} color={Colors.primary} />} title="Company & Financials" />

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
          <SectionHeader icon={<ShieldCheck size={14} color={Colors.primary} />} title="Insurance" />

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
          <SectionHeader icon={<HardHat size={14} color={Colors.primary} />} title="Safety Record" />

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
          <SectionHeader icon={<BadgeCheck size={14} color={Colors.primary} />} title="Licenses" />

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
                <Trash2 size={13} color={Colors.error} />
                <Text style={styles.removeBtnText}>Remove license</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity onPress={addLicense} style={styles.addLicenseBtn}>
            <Plus size={14} color={Colors.primary} />
            <Text style={styles.addLicenseText}>Add license</Text>
          </TouchableOpacity>

          {/* ── W-9 ──────────────────────────────── */}
          <SectionHeader icon={<FileText size={14} color={Colors.primary} />} title="Tax / W-9" />
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
            <CheckCircle2 size={16} color={Colors.success} />
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
            <Send size={16} color={Colors.textOnPrimary} />
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
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AlertTriangle size={32} color={Colors.warning} />
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorBody}>{body}</Text>
      <TouchableOpacity onPress={onBack} style={styles.errorBtn}>
        <Text style={styles.errorBtnText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
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
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function ToggleRow({ label, value, onValueChange }: {
  label: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange}
        trackColor={{ true: Colors.primary, false: Colors.fillTertiary }}
        thumbColor={Platform.OS === 'android' ? (value ? Colors.textOnPrimary : '#fff') : undefined} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8,
    gap: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
  },
  headerEyebrow: { fontSize: 10, color: Colors.primary, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },

  savingChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: Colors.fillSecondary },
  savingChipText: { fontSize: 10, color: Colors.textSecondary, fontWeight: '600' },

  introCard: {
    flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, backgroundColor: Colors.card,
    borderLeftWidth: 3, borderLeftColor: Colors.primary, marginBottom: 12,
  },
  introTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  introBody: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  checklistCard: {
    padding: 12, borderRadius: 10, borderLeftWidth: 3, marginBottom: 18,
  },
  checklistTitle: { fontSize: 13, fontWeight: '700', color: Colors.text },
  checklistSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 4, lineHeight: 15 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 22, marginBottom: 10 },
  sectionHeaderText: { fontSize: 11, color: Colors.primary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1 },

  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  input: {
    backgroundColor: Colors.fillSecondary, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 14, color: Colors.text,
  },
  row: { flexDirection: 'row', gap: 10 },
  helperText: { fontSize: 11, color: Colors.textMuted, marginBottom: 10, lineHeight: 15 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  toggleLabel: { flex: 1, fontSize: 13, color: Colors.text, paddingRight: 10 },

  licenseCard: {
    padding: 12, borderRadius: 10, backgroundColor: Colors.card, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-end' },
  removeBtnText: { fontSize: 11, color: Colors.error, fontWeight: '600' },

  addLicenseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed',
    borderColor: Colors.primary, marginTop: 4,
  },
  addLicenseText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  submitBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.primary,
  },
  submitBtnDisabled: { backgroundColor: Colors.textMuted },
  submitBtnText: { color: Colors.textOnPrimary, fontSize: 14, fontWeight: '800' },
  submitHelper: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 15 },

  submittedChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: Colors.successLight,
  },
  submittedText: { color: Colors.success, fontSize: 13, fontWeight: '700' },

  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginTop: 12 },
  errorBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  errorBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  errorBtnText: { color: Colors.textOnPrimary, fontWeight: '700' },
});
