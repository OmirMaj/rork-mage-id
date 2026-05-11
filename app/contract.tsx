// contract — GC-side contract editor. Drafts the formal scope-of-work +
// payment schedule, captures the GC signature, sends it to the homeowner
// via the portal for counter-signature.
//
// Flow:
//   1. GC opens this screen from a project. We load (or seed) the active
//      contract for the project.
//   2. GC edits scope/value/payment-schedule/allowances inline.
//   3. GC taps "Sign & Send" → captures their signature, sets status to
//      'sent', the homeowner sees + signs in the portal.
//   4. Once both signatures are on, status is 'signed' and the contract
//      is the binding document. Subsequent invoices reference it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, Plus, Trash2, DollarSign, Calendar, Send,
  CheckCircle2, AlertTriangle, Edit3, FileSignature, ChevronRight,
} from 'lucide-react-native';
import EmptyState from '@/components/ui/EmptyState';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchActiveContract, fetchContractsForProject, saveContract, setContractStatus,
  buildDraftContract, defaultPaymentSchedule,
} from '@/utils/contractEngine';
import { generateUUID } from '@/utils/generateId';
import { formatMoney } from '@/utils/formatters';
import { statusPillStyle } from '@/utils/statusPill';
import { syncAllowancesToSelections } from '@/utils/selectionsEngine';
import { sendEmail } from '@/utils/emailService';
import { wrapEmailHtml, emailQuote, escapeHtml } from '@/utils/emailLayout';
import SignaturePad from '@/components/SignaturePad';
import { fireConfetti } from '@/components/animations/Confetti';
import { StatusPipeline, type PipelineStage } from '@/components/StatusPipeline';
import type { ProjectContract, PaymentMilestone, ContractAllowance, ContractStatus } from '@/types';

// Pipeline shown at the top of every saved contract. Void is omitted
// from the visual (user can still set status=void via the existing UI);
// it's a side branch, not a normal forward step. 'sent' is the period
// after the GC sends the contract to the homeowner but before they
// counter-sign — the homeowner-action waiting state.
const CONTRACT_PIPELINE_STAGES: PipelineStage<ContractStatus>[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'signed', label: 'Signed', terminal: true },
];
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function ContractScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, updateProject: ctxUpdateProject, settings } = useProjects();
  const project = projectId ? getProject(projectId) : undefined;

  const [contract, setContract] = useState<ProjectContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signatureModal, setSignatureModal] = useState(false);
  // Vision-doc feature #1 (Living Contract): version history. We
  // load every version of the contract for this project so the GC
  // (and the homeowner via portal, later) can see the audit trail
  // of amendments. Only surfaces when 2+ versions exist — silent
  // for the common single-version case so it doesn't add noise.
  const [historyVersions, setHistoryVersions] = useState<ProjectContract[]>([]);

  // Load (or seed a draft for) this project's contract.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!project) { setLoading(false); return; }
      const [existing, allVersions] = await Promise.all([
        fetchActiveContract(project.id),
        fetchContractsForProject(project.id),
      ]);
      if (cancelled) return;
      if (existing) {
        setContract(existing);
      } else {
        // Seed a draft from the project — caller can edit before saving.
        const draft = buildDraftContract({ project });
        setContract({
          ...draft,
          id: '',
          userId: user?.id ?? '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setHistoryVersions(allVersions);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [project, user]);

  // Generic field setter.
  const updateContract = useCallback(<K extends keyof ProjectContract>(key: K, value: ProjectContract[K]) => {
    setContract(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // Re-balance the payment schedule when contract value changes — only
  // for milestones that were % based; fixed-dollar entries stay put.
  const handleValueChange = useCallback((newValue: number) => {
    setContract(prev => {
      if (!prev) return prev;
      const next = { ...prev, contractValue: newValue };
      next.paymentSchedule = prev.paymentSchedule.map(m => {
        if (m.percent != null) {
          return { ...m, amount: Math.round(newValue * (m.percent / 100)) };
        }
        return m;
      });
      return next;
    });
  }, []);

  const addMilestone = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: [...prev.paymentSchedule, {
        id: generateUUID(),
        label: 'New milestone',
        trigger: 'on_milestone',
        triggerMilestone: '',
        amount: 0,
        status: 'pending',
      }],
    } : prev);
  }, []);

  const removeMilestone = useCallback((id: string) => {
    const m = contract?.paymentSchedule.find(x => x.id === id);
    const amount = m?.amount;
    Alert.alert(
      'Remove this milestone?',
      m?.label
        ? `"${m.label}"${amount ? ` — $${amount.toLocaleString()}` : ''} will be removed from the payment schedule.`
        : 'This milestone will be removed from the payment schedule.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setContract(prev => prev ? {
            ...prev,
            paymentSchedule: prev.paymentSchedule.filter(x => x.id !== id),
          } : prev);
        } },
      ],
    );
  }, [contract]);

  const updateMilestone = useCallback((id: string, patch: Partial<PaymentMilestone>) => {
    setContract(prev => prev ? {
      ...prev,
      paymentSchedule: prev.paymentSchedule.map(m => m.id === id ? { ...m, ...patch } : m),
    } : prev);
  }, []);

  const addAllowance = useCallback(() => {
    setContract(prev => prev ? {
      ...prev,
      allowances: [...prev.allowances, { id: generateUUID(), category: '', amount: 0 }],
    } : prev);
  }, []);

  const removeAllowance = useCallback((id: string) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.filter(a => a.id !== id),
    } : prev);
  }, []);

  const updateAllowance = useCallback((id: string, patch: Partial<ContractAllowance>) => {
    setContract(prev => prev ? {
      ...prev,
      allowances: prev.allowances.map(a => a.id === id ? { ...a, ...patch } : a),
    } : prev);
  }, []);

  // Save the draft (no status change). Used as a debounced auto-save
  // OR explicit "Save draft" button.
  const handleSaveDraft = useCallback(async () => {
    if (!contract) return;
    setSaving(true);
    try {
      const saved = await saveContract({ ...contract, id: contract.id || undefined });
      if (saved) {
        setContract(saved);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Save failed', 'Could not save the contract. Check your connection.');
      }
    } finally {
      setSaving(false);
    }
  }, [contract]);

  // Sign + send — captures the GC's signature, status='sent'.
  const handleSignAndSend = useCallback(async (signaturePaths: string[], typedName: string) => {
    if (!contract) return;
    if (!typedName.trim()) {
      Alert.alert('Name required', 'Type your full legal name to sign the contract.');
      return;
    }
    setSigning(true);
    try {
      // Save first to get an id.
      const saved = await saveContract({ ...contract, id: contract.id || undefined });
      if (!saved) {
        Alert.alert('Save failed', 'Could not save the contract before signing.');
        return;
      }
      // Then attach the GC signature + flip status to 'sent'.
      const ok = await setContractStatus(saved.id, 'sent', {
        gcSignature: {
          name: typedName.trim(),
          role: 'gc',
          signedAt: new Date().toISOString(),
          signaturePaths,
        },
      });
      if (!ok) {
        Alert.alert('Send failed', 'Saved as draft but could not mark as sent.');
        return;
      }
      const refreshed = await fetchActiveContract(saved.projectId);
      if (refreshed) setContract(refreshed);

      // 🎉 Milestone! Fire a celebratory confetti burst when the GC
      // signs and sends. The homeowner counter-signing also fires one
      // (handled separately on the portal side). Tiny bit of joy in
      // an otherwise paperwork-heavy moment.
      fireConfetti({ count: 50 });

      // Connector: auto-create SelectionCategory rows from contract
      // allowances so the GC doesn't have to re-type the same data into
      // the selections screen. Idempotent — skips categories that
      // already exist by name. Fire-and-forget; UX continues even if
      // this fails.
      const allowancesPayload = (saved.allowances ?? []).filter(a => a.category && a.amount > 0);
      let createdCount = 0;
      if (allowancesPayload.length > 0) {
        try {
          createdCount = await syncAllowancesToSelections(saved.projectId, allowancesPayload);
        } catch (err) {
          console.warn('[contract] allowance → selection sync failed', err);
        }
      }

      // Connector: flip project to 'in_progress' so the schedule, budget
      // tracker and portal all reflect the project actually being live.
      // Only flip if we're upgrading from a pre-active state — never
      // overwrite 'completed' or 'closed'.
      if (project && (project.status === 'draft' || project.status === 'estimated')) {
        ctxUpdateProject(project.id, { status: 'in_progress' });
      }

      // Email the homeowner the portal URL + a sign-and-send prompt.
      // Pre-fix this was the audit's #4 finding — the contract status
      // flipped to 'sent' but no email actually went out, so the homeowner
      // had no idea there was anything to counter-sign. Best-effort —
      // failure here doesn't roll back the contract send.
      let emailNote = '';
      try {
        const portalSettings = project?.clientPortal;
        const invites = portalSettings?.invites ?? [];
        const recipients = invites
          .filter(i => (i.email ?? '').trim().includes('@'))
          .map(i => ({ email: i.email!.trim(), name: i.name }));
        if (project && portalSettings?.enabled && portalSettings.portalId && recipients.length > 0) {
          const portalUrl = `https://mageid.app/portal/${portalSettings.portalId}`;
          const companyName = settings?.branding?.companyName || 'MAGE ID';
          const senderName = settings?.branding?.contactName || companyName;
          const senderEmail = settings?.branding?.email;
          const greetingFirstName = (recipients[0].name ?? '').split(' ')[0] || 'there';
          const html = wrapEmailHtml({
            preheader: `${companyName} sent you the contract for ${project.name}. Tap to review and counter-sign.`,
            eyebrow: 'Contract — ready to sign',
            title: `${project.name}`,
            subtitle: `Hi ${greetingFirstName}, ${companyName} sent you the construction contract.`,
            bodyHtml: [
              `<p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#4A5159;">
                 The contract — scope, value, payment schedule, and allowances — is ready for your review and counter-signature in your project portal.
                 You can read the full agreement, ask questions inside the portal, and sign with one tap. Once you sign, ${escapeHtml(companyName)} can start.
               </p>`,
              contract.scopeText ? emailQuote(contract.scopeText.slice(0, 600)) : '',
              `<p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#4A5159;">
                 <strong style="color:#0B0D10;">Project:</strong> ${escapeHtml(project.name)}<br/>
                 ${project.location ? `<strong style="color:#0B0D10;">Location:</strong> ${escapeHtml(project.location)}<br/>` : ''}
                 <strong style="color:#0B0D10;">Contract value:</strong> ${escapeHtml(formatMoney(contract.contractValue ?? 0))}
               </p>`,
            ].join(''),
            cta: { label: 'Review & sign in your portal', href: portalUrl },
            companyName,
            project: { name: project.name, location: project.location },
            sender: { name: senderName, email: senderEmail, phone: settings?.branding?.phone },
          });

          const subject = `${project.name} — your contract is ready to sign`;
          const sendResults = await Promise.all(recipients.map(r =>
            sendEmail({
              to: r.email,
              subject,
              html,
              replyTo: senderEmail,
              fromCompanyName: companyName,
            })
          ));
          const sentCount = sendResults.filter(r => r.success).length;
          if (sentCount > 0) {
            emailNote = ` Emailed the portal link to ${sentCount} recipient${sentCount === 1 ? '' : 's'}.`;
          } else {
            emailNote = ' Note: portal email failed to send — copy the portal URL and share it manually.';
          }
        } else {
          emailNote = ' Note: no portal invitee email on file — share the portal URL manually so the homeowner can counter-sign.';
        }
      } catch (err) {
        console.warn('[contract] email send failed', err);
        emailNote = ' Note: portal email failed to send — copy the portal URL and share it manually.';
      }

      setSignatureModal(false);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Contract sent',
        (createdCount > 0
          ? `The homeowner can review and counter-sign in their portal. We also pre-created ${createdCount} selection categor${createdCount === 1 ? 'y' : 'ies'} from your allowances — head to Selections to add AI-curated options.`
          : 'The homeowner can review and counter-sign in their portal. You\'ll be notified when they do.')
          + emailNote,
      );
    } finally {
      setSigning(false);
    }
  }, [contract, project, ctxUpdateProject, settings]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon={<FileSignature size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No contract open yet"
          message="Contracts (scope, payment schedule, allowances, signatures) live inside a project. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Contracts inside the project tile grid.',
            'Edit the seeded draft, sign as the GC, and send to the homeowner for counter-signature.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }
  if (loading || !contract) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  const isLocked = contract.status === 'sent' || contract.status === 'signed';
  const totalScheduled = contract.paymentSchedule.reduce((s, m) => s + (m.amount ?? 0), 0);
  const scheduleMatchesValue = Math.abs(totalScheduled - contract.contractValue) < 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Construction Agreement</Text>
        </View>
        <StatusPill status={contract.status} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 100 }}>
        {contract.status !== 'void' && (
          <View style={{ marginBottom: Tokens.spacing.sm }}>
            <StatusPipeline
              stages={CONTRACT_PIPELINE_STAGES}
              current={contract.status}
              startedAt={contract.sentAt ?? contract.createdAt}
            />
          </View>
        )}

        {/* Version history — vision-doc feature #1 (Living Contract).
            Only renders when there's a real history (2+ versions on
            file). For the common new-contract case the section is
            silent. Contract value + status per version is the audit
            trail a GC's lawyer wants in a dispute. */}
        {historyVersions.length > 1 && (
          <View style={styles.historyCard}>
            <View style={styles.historyHead}>
              <FileText size={14} color={Colors.primary} />
              <Text style={styles.historyTitle}>Contract version history</Text>
              <View style={styles.historyCountPill}>
                <Text style={styles.historyCountText}>{historyVersions.length}</Text>
              </View>
            </View>
            <Text style={styles.historyHint}>
              Every CO, selection change, and schedule shift recorded against this project. The signed
              record of what was agreed at every stage.
            </Text>
            <View style={styles.historyList}>
              {historyVersions.map((v, idx) => {
                const active = v.id === contract.id;
                return (
                  <View
                    key={v.id || `version-${v.version}`}
                    style={[
                      styles.historyRow,
                      idx < historyVersions.length - 1 && styles.historyRowBorder,
                      active && styles.historyRowActive,
                    ]}
                  >
                    <View style={styles.historyVersionPill}>
                      <Text style={styles.historyVersionText}>v{v.version}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyRowTitle} numberOfLines={1}>
                        {v.title}
                        {active ? ' · current' : ''}
                      </Text>
                      <Text style={styles.historyRowSub} numberOfLines={1}>
                        {formatMoney(v.contractValue)} · {v.status}
                        {v.signedAt ? ` · signed ${new Date(v.signedAt).toLocaleDateString()}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Title + value */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Contract title</Text>
          <TextInput
            style={[styles.input, isLocked && styles.inputDisabled]}
            value={contract.title}
            onChangeText={v => updateContract('title', v)}
            editable={!isLocked}
            placeholder="Construction Agreement"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={[styles.cardLabel, { marginTop: 14 }]}>Contract value</Text>
          <View style={styles.amountField}>
            <DollarSign size={16} color={Colors.textMuted} />
            <TextInput
              style={[styles.amountInput, isLocked && styles.inputDisabled]}
              value={String(contract.contractValue || '')}
              onChangeText={v => handleValueChange(Number(v.replace(/[^0-9.]/g, '')) || 0)}
              keyboardType="numeric"
              editable={!isLocked}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        {/* Scope */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Scope of work *</Text>
          <Text style={styles.cardHelper}>What you'll build, materials of note, exclusions. Be specific — this is what the homeowner agrees to.</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.scopeText}
            onChangeText={v => updateContract('scopeText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={8}
            placeholder="Describe the scope in detail..."
            placeholderTextColor={Colors.textMuted}
            textAlignVertical="top"
          />
        </View>

        {/* Payment schedule */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Payment schedule</Text>
              <Text style={styles.cardHelper}>
                Tied to specific triggers. Total must equal contract value.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addMilestone}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {contract.paymentSchedule.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              locked={isLocked}
              onChange={patch => updateMilestone(m.id, patch)}
              onRemove={() => removeMilestone(m.id)}
            />
          ))}

          <View style={styles.scheduleTotalRow}>
            <Text style={styles.scheduleTotalLabel}>Total scheduled</Text>
            <Text style={[
              styles.scheduleTotalValue,
              !scheduleMatchesValue && { color: Colors.warning },
            ]}>
              {formatMoney(totalScheduled)}
            </Text>
          </View>

          {/* Mismatch banner — moved out of the inline total so the
              warning gets its own row instead of crashing into the dollar
              amount. Reads more like a real "this is wrong" alert. */}
          {!scheduleMatchesValue && (
            <View style={styles.scheduleMismatchBanner}>
              <Text style={styles.scheduleMismatchText}>
                Total doesn't match contract value of {formatMoney(contract.contractValue)}
              </Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.rebalanceBtn}
                  onPress={() => updateContract('paymentSchedule', defaultPaymentSchedule(contract.contractValue))}
                >
                  <Text style={styles.rebalanceText}>Reset to 25/25/25/25</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Allowances */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Allowances (optional)</Text>
              <Text style={styles.cardHelper}>
                Budget set aside for finishes the homeowner picks (cabinets, fixtures, tile, etc.).
                Overruns trigger a Change Order.
              </Text>
            </View>
            {!isLocked && (
              <TouchableOpacity style={styles.smallBtn} onPress={addAllowance}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.smallBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
          {contract.allowances.map(a => (
            <View key={a.id} style={styles.allowanceRow}>
              <TextInput
                style={[styles.allowanceCategory, isLocked && styles.inputDisabled]}
                value={a.category}
                onChangeText={v => updateAllowance(a.id, { category: v })}
                editable={!isLocked}
                placeholder="Category"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.allowanceAmountField}>
                <DollarSign size={12} color={Colors.textMuted} />
                <TextInput
                  style={[styles.allowanceAmount, isLocked && styles.inputDisabled]}
                  value={String(a.amount || '')}
                  onChangeText={v => updateAllowance(a.id, { amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
                  keyboardType="numeric"
                  editable={!isLocked}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              {!isLocked && (
                <TouchableOpacity onPress={() => removeAllowance(a.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {contract.allowances.length === 0 && (
            <Text style={styles.allowanceEmpty}>
              No allowances yet. Tap Add to set a budget for fixtures, finishes, or any homeowner-picked items.
            </Text>
          )}
        </View>

        {/* Terms */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Terms & conditions</Text>
          <TextInput
            style={[styles.input, styles.inputTermsMultiline, isLocked && styles.inputDisabled]}
            value={contract.termsText}
            onChangeText={v => updateContract('termsText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
          />
        </View>

        {/* Warranty */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Warranty</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, isLocked && styles.inputDisabled]}
            value={contract.warrantyText}
            onChangeText={v => updateContract('warrantyText', v)}
            editable={!isLocked}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        {/* Signatures */}
        {(contract.gcSignature || contract.homeownerSignature) && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Signatures</Text>
            {contract.gcSignature && (
              <SignatureBlock label="Contractor" name={contract.gcSignature.name} signedAt={contract.gcSignature.signedAt} />
            )}
            {contract.homeownerSignature && (
              <SignatureBlock label="Homeowner" name={contract.homeownerSignature.name} signedAt={contract.homeownerSignature.signedAt} />
            )}
          </View>
        )}

        {/* Action bar */}
        {contract.status === 'draft' && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleSaveDraft}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator size="small" color={Colors.text} /> : (
                <>
                  <Edit3 size={14} color={Colors.text} />
                  <Text style={styles.secondaryBtnText}>Save draft</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, !scheduleMatchesValue && styles.primaryBtnDisabled]}
              onPress={() => setSignatureModal(true)}
              disabled={!scheduleMatchesValue || saving}
              activeOpacity={0.85}
            >
              <FileSignature size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Sign & send</Text>
            </TouchableOpacity>
          </View>
        )}

        {contract.status === 'sent' && (
          <View style={styles.statusBanner}>
            <Send size={16} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusBannerTitle}>Sent to the homeowner</Text>
              <Text style={styles.statusBannerBody}>
                You'll be notified when they sign. Until then this contract is read-only.
              </Text>
            </View>
          </View>
        )}

        {contract.status === 'signed' && (
          <View style={[styles.statusBanner, { backgroundColor: Colors.success + '0D', borderColor: Colors.success + '30' }]}>
            <CheckCircle2 size={16} color={Colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusBannerTitle, { color: Colors.success }]}>Signed by both parties</Text>
              <Text style={styles.statusBannerBody}>
                Binding agreement on file. Invoices on this project should reference it.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Signature modal */}
      <SignatureModal
        visible={signatureModal}
        onClose={() => setSignatureModal(false)}
        onSign={handleSignAndSend}
        signing={signing}
        defaultName={user?.name ?? user?.email ?? ''}
      />
    </View>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function StatusPill({ status }: { status: ProjectContract['status'] }) {
  // Use the shared statusPillStyle helper so SIGNED / SENT / VOID /
  // DRAFT match the same green/amber/red/gray scheme used on lien
  // waivers and the closeout binder header.
  const label = (status ?? 'draft').toUpperCase();
  const { color, backgroundColor } = statusPillStyle(status);
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function MilestoneRow({ milestone, locked, onChange, onRemove }: {
  milestone: PaymentMilestone;
  locked: boolean;
  onChange: (patch: Partial<PaymentMilestone>) => void;
  onRemove: () => void;
}) {
  const cfg =
    milestone.status === 'paid'     ? { bg: Colors.success + '15', color: Colors.success, label: 'PAID' } :
    milestone.status === 'invoiced' ? { bg: Colors.primary + '15', color: Colors.primary, label: 'INVOICED' } :
    milestone.status === 'skipped'  ? { bg: Colors.fillSecondary,  color: Colors.textMuted, label: 'SKIPPED' } :
                                       { bg: Colors.fillSecondary, color: Colors.textMuted, label: 'PENDING' };
  const triggerLabel =
    milestone.trigger === 'on_signing'   ? 'On signing'
    : milestone.trigger === 'on_final'   ? 'On final completion'
    : milestone.trigger === 'on_invoice' ? 'On invoice'
    : milestone.trigger === 'on_date'    ? `On ${milestone.triggerDate ?? 'date'}`
    : (milestone.triggerMilestone || 'On milestone');

  return (
    <View style={styles.milestoneCard}>
      {/* Top row: status pill on left, trash on far right.
          Pill sits OUTSIDE the input area so there's no overlap, no
          cramped feeling. Trash is its own column with explicit width. */}
      <View style={styles.milestoneHeader}>
        <View style={[styles.milestoneStatus, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.milestoneStatusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {!locked && (
          <TouchableOpacity onPress={onRemove} hitSlop={8} style={styles.milestoneTrash} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={14} color={Colors.error} /></TouchableOpacity>
        )}
      </View>

      {/* Label input — clearly bordered, full width, with a small caption
          ABOVE so the user knows what they're editing. Replaces the
          "text floating in a box" anti-pattern. */}
      <Text style={styles.milestoneFieldLabel}>Milestone</Text>
      <TextInput
        style={[styles.milestoneLabelInput, locked && styles.inputDisabled]}
        value={milestone.label}
        onChangeText={v => onChange({ label: v })}
        editable={!locked}
        placeholder="e.g. 25% Deposit"
        placeholderTextColor={Colors.textMuted}
      />

      {/* Amount + Trigger row — two columns with explicit flex so they
          can't overlap. Amount is the bigger box (flex 1), trigger is
          the smaller display column (flex 1.2 since text wraps). */}
      <View style={styles.milestoneFieldsRow}>
        <View style={styles.milestoneFieldCol}>
          <Text style={styles.milestoneFieldLabel}>Amount</Text>
          <View style={styles.milestoneAmountBox}>
            <DollarSign size={14} color={Colors.textMuted} />
            <TextInput
              style={[styles.milestoneAmountInput, locked && styles.inputDisabled]}
              value={String(milestone.amount ?? '')}
              onChangeText={v => onChange({ amount: Number(v.replace(/[^0-9.]/g, '')) || 0 })}
              keyboardType="numeric"
              editable={!locked}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>
        <View style={styles.milestoneFieldCol}>
          <Text style={styles.milestoneFieldLabel}>Trigger</Text>
          <View style={styles.milestoneTriggerBox}>
            <Text style={styles.milestoneTriggerText} numberOfLines={2}>
              {triggerLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* Trigger description (shown only for 'on_milestone' type) — full
          width, gets its own labelled input below the row above. */}
      {milestone.trigger === 'on_milestone' && !locked && (
        <>
          <Text style={[styles.milestoneFieldLabel, { marginTop: 10 }]}>Trigger description</Text>
          <TextInput
            style={styles.milestoneTriggerInput}
            value={milestone.triggerMilestone ?? ''}
            onChangeText={v => onChange({ triggerMilestone: v })}
            placeholder="e.g. Foundation pour complete and inspected"
            placeholderTextColor={Colors.textMuted}
          />
        </>
      )}
    </View>
  );
}

function SignatureBlock({ label, name, signedAt }: { label: string; name: string; signedAt: string }) {
  return (
    <View style={styles.sigBlock}>
      <Text style={styles.sigLabel}>{label}</Text>
      <Text style={styles.sigName}>{name}</Text>
      <Text style={styles.sigDate}>Signed {new Date(signedAt).toLocaleDateString()}</Text>
    </View>
  );
}

function SignatureModal({ visible, onClose, onSign, signing, defaultName }: {
  visible: boolean;
  onClose: () => void;
  onSign: (paths: string[], typedName: string) => void;
  signing: boolean;
  defaultName: string;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    if (visible) {
      setPaths([]);
      setTypedName(defaultName);
    }
  }, [visible, defaultName]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Sign & send</Text>
          <Text style={styles.modalBody}>
            Sign below + type your full legal name. The contract becomes binding when the
            homeowner counter-signs in their portal.
          </Text>
          <SignaturePad
            initialPaths={paths}
            onSave={setPaths}
            onClear={() => setPaths([])}
            height={150}
          />
          <TextInput
            style={styles.modalNameInput}
            value={typedName}
            onChangeText={setTypedName}
            placeholder="Your full legal name"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={signing}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (paths.length === 0 || !typedName.trim()) && styles.primaryBtnDisabled]}
              onPress={() => onSign(paths, typedName)}
              disabled={signing || paths.length === 0 || !typedName.trim()}
            >
              {signing ? <ActivityIndicator size="small" color="#FFF" /> : (
                <>
                  <FileSignature size={14} color="#FFF" />
                  <Text style={styles.modalConfirmText}>Sign & send</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Version history (Living Contract feature)
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Tokens.spacing.sm,
  },
  historyHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
  },
  historyTitle: {
    flex: 1,
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  historyCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary + '15',
  },
  historyCountText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.primary,
  },
  historyHint: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: 6,
    marginBottom: 10,
    lineHeight: 16,
  },
  historyList: {
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  historyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 10,
  },
  historyRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  historyRowActive: {
    backgroundColor: Colors.primary + '08',
  },
  historyVersionPill: {
    minWidth: 32,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
  },
  historyVersionText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.background,
    letterSpacing: 0.4,
  },
  historyRowTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  historyRowSub: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: 1,
  },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: Tokens.spacing.xxs },

  pill: { paddingHorizontal: 9, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full },
  pillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Tokens.spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.xs, marginBottom: Tokens.spacing.xxs },
  cardLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  cardHelper: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },

  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  smallBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: Colors.primary },

  input: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 11,
    fontSize: Type.bodyCompact.fontSize, color: Colors.text,
  },
  inputDisabled: { opacity: 0.7 },
  inputMultiline: { minHeight: 110, paddingTop: 11 },
  inputTermsMultiline: { minHeight: 200, paddingTop: 11, fontSize: Type.caption1.fontSize, lineHeight: 18 },

  amountField: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    backgroundColor: Colors.background, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: Tokens.spacing.xs,
  },
  amountInput: { flex: 1, fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text },

  // ── Milestone row (Payment Schedule) ──
  // Redesigned to remove the cramped/overlapping look. Each input has
  // a small caption above it and a clearly bordered box. Amount + Trigger
  // sit in a 2-column row with explicit flex so neither pushes into the
  // other. Status pill moved to its own header row to stop crowding the
  // label input.
  milestoneCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Tokens.spacing.sm,
    paddingBottom: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  milestoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: Tokens.spacing.xs,
  },
  milestoneTrash: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.errorLight,
  },
  milestoneStatus: { paddingHorizontal: 9, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full },
  milestoneStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  milestoneFieldLabel: {
    fontSize: 10, fontWeight: '800', color: Colors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: Tokens.spacing.xxs,
  },
  milestoneLabelInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 9,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: Colors.text,
    marginBottom: Tokens.spacing.sm,
  },
  milestoneFieldsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  milestoneFieldCol: { flex: 1, minWidth: 0 },
  milestoneAmountBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 9,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    minHeight: 44,
  },
  milestoneAmountInput: {
    flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700', color: Colors.text,
    padding: 0,
    minHeight: 22,
  },
  milestoneTriggerBox: {
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 9,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  milestoneTriggerText: {
    fontSize: Type.footnote.fontSize, fontWeight: '600', color: Colors.text,
    lineHeight: 17,
  },
  milestoneTriggerInput: {
    fontSize: Type.footnote.fontSize, color: Colors.text,
    backgroundColor: Colors.background, borderRadius: 9,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
    minHeight: 44,
  },

  scheduleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: Tokens.spacing.sm, marginTop: 6,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  scheduleTotalLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  scheduleTotalValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text },
  // Mismatch banner — its own row, amber tint, real "this is wrong" affordance
  scheduleMismatchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.warningLight,
    borderRadius: 9,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 10,
    marginTop: 10,
    gap: 10,
  },
  scheduleMismatchText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    color: Colors.warning,
    lineHeight: 16,
  },
  rebalanceBtn: {
    backgroundColor: Colors.warning,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rebalanceText: { fontSize: Type.caption2.fontSize, color: '#FFF', fontWeight: '800', letterSpacing: 0.3 },

  allowanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10, marginBottom: Tokens.spacing.xs,
    borderWidth: 1, borderColor: Colors.border,
    minHeight: 48,
  },
  allowanceCategory: {
    flex: 1, fontSize: Type.bodyCompact.fontSize, color: Colors.text, padding: 0,
    fontWeight: '600',
  },
  allowanceAmountField: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    paddingHorizontal: 10, paddingVertical: Tokens.spacing.xs,
    backgroundColor: Colors.background, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: Colors.border,
    minWidth: 110,
  },
  allowanceAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text, padding: 0, flex: 1 },
  allowanceEmpty: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontStyle: 'italic', textAlign: 'center', paddingVertical: Tokens.spacing.sm },

  sigBlock: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sigLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
  sigName:  { fontSize: Type.callout.fontSize, fontWeight: '800', color: Colors.text, fontStyle: 'italic', marginTop: Tokens.spacing.xxs },
  sigDate:  { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs,
    paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
  primaryBtnDisabled: { opacity: 0.45 },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  secondaryBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },

  statusBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
    marginTop: 10,
  },
  statusBannerTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: Colors.primary },
  statusBannerBody:  { fontSize: Type.caption1.fontSize, color: Colors.text, marginTop: 3, lineHeight: 17 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: Tokens.spacing.lg, gap: Tokens.spacing.sm },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text },
  modalBody: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, lineHeight: 18 },
  modalNameInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Tokens.radius.md,
    paddingHorizontal: 14, paddingVertical: Tokens.spacing.sm,
    fontSize: Type.subhead.fontSize, fontWeight: '700', color: Colors.text,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, paddingVertical: Tokens.spacing.sm, borderRadius: 11, backgroundColor: Colors.background, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Tokens.spacing.sm, borderRadius: 11, backgroundColor: Colors.primary },
  modalConfirmText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
