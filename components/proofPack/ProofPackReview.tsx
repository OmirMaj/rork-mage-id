// components/proofPack/ProofPackReview.tsx — the review screen of the Pay Period Record: what will be in the document, each record's strength, a switch
// to leave a record out, then Create and Share.
//
// This screen only READS the job's records (contexts/ProjectContext, the punch
// seal, the lien waiver list). It changes none of them. The one write it can
// cause is the fingerprint record, and only from the Create and Share tap
// (utils/proofPack/share.ts). Nothing here calls a model.
//
// Leaving a record out is the contractor's right and the reader's business: the
// package counts what was left out and prints the count on its first page.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useT } from '@/contexts/LanguageContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePunchSeal } from '@/hooks/usePunchSeal';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProofPackCopy } from '@/hooks/useProofPackCopy';
import { Button } from '@/components/ui';
import type { LienWaiver } from '@/types';
import type { ProofCoSignatureRecord } from '@/utils/proofPack/core';
import { formatCalendarDay } from '@/utils/calendarDate';
import { loadLienWaiversChecked } from '@/utils/lienWaiverEngine';
import {
  PROOF_ITEM_KINDS, PROOF_STRENGTHS, buildProofPack, listProofCandidates,
  type ProofItem, type ProofItemKind, type ProofPackInput, type ProofPayRef, type ProofStrength,
} from '@/utils/proofPack/core';
import type { ProofDocLang } from '@/utils/proofPack/docCopy';
import type { ProofCheck } from '@/utils/proofPack/fingerprint';
import { proofMoney } from '@/utils/proofPack/html';
import { checkFileAgainst, createAndShareProofPack, type ProofPhotoSource } from '@/utils/proofPack/share';
import { readCoSignatureRecords, readSavedProofPacks, recheckSavedProofPack, type SavedProofPack } from '@/utils/proofPack/store';
import { makeProofPackStyles } from './styles';

export interface ProofPackReviewProps {
  projectId: string;
  payRef: ProofPayRef;
  onBack: () => void;
}

type MadeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'made'; code: string; onFile: boolean; kept: boolean }
  | { kind: 'failed' };

function StrengthChip({ strength, label }: { strength: ProofStrength; label: string }) {
  const styles = useThemedStyles(makeProofPackStyles);
  const strong = strength === 'sealed' || strength === 'signed' || strength === 'locked';
  return (
    <View style={[styles.chip, strong && styles.chipStrong]} testID={`proof-chip-${strength}`}>
      <Text style={[styles.chipText, strong && styles.chipTextStrong]}>{label}</Text>
    </View>
  );
}

export function ProofPackReview({ projectId, payRef: payRefProp, onBack }: ProofPackReviewProps) {
  // One stable object per pay document: the route hands a fresh literal on every render.
  const payRef = useMemo<ProofPayRef>(() => ({ kind: payRefProp.kind, id: payRefProp.id }), [payRefProp.kind, payRefProp.id]);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeProofPackStyles);
  const copy = useProofPackCopy();
  const { lang: appLang } = useT();
  const ctx = useProjects();
  const { status: sealStatus, seal } = usePunchSeal(projectId);

  const project = useMemo(() => ctx.projects.find((p) => p.id === projectId) ?? null, [ctx.projects, projectId]);

  // Lien waivers are not in the project context: read them once. A failed read
  // stays `undefined`, and the package prints "not checked" for that section.
  const [waivers, setWaivers] = useState<LienWaiver[] | undefined>(undefined);
  const [waiversSettled, setWaiversSettled] = useState(false);
  useEffect(() => {
    let live = true;
    loadLienWaiversChecked(projectId)
      .then((r) => { if (live) { setWaivers(r.ok ? r.waivers : undefined); setWaiversSettled(true); } })
      .catch(() => { if (live) setWaiversSettled(true); });
    return () => { live = false; };
  }, [projectId]);

  // The signature rows for change orders live on the server: read them once.
  // A failed read stays `undefined`: a change order is then never called Signed.
  const [coSignatures, setCoSignatures] = useState<ProofCoSignatureRecord[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    readCoSignatureRecords(projectId).then((r) => { if (live) setCoSignatures(r); }).catch(() => {});
    return () => { live = false; };
  }, [projectId]);

  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const [docLang, setDocLang] = useState<ProofDocLang>(appLang === 'es' ? 'es' : 'en');
  const [made, setMade] = useState<MadeState>({ kind: 'idle' });
  const [savedPacks, setSavedPacks] = useState<SavedProofPack[]>([]);
  const [checks, setChecks] = useState<Record<string, { check?: ProofCheck; file?: ProofCheck; busy?: boolean }>>({});

  const reloadSaved = useCallback(() => {
    readSavedProofPacks(projectId).then(setSavedPacks).catch(() => setSavedPacks([]));
  }, [projectId]);
  useEffect(() => { reloadSaved(); }, [reloadSaved]);

  const photos = useMemo(() => ctx.getPhotosForProject(projectId), [ctx, projectId]);
  const reports = useMemo(() => ctx.getDailyReportsForProject(projectId), [ctx, projectId]);

  const baseInput = useMemo<Omit<ProofPackInput, 'leaveOut' | 'generatedAt'> | null>(() => {
    if (!project) return null;
    return {
      project: { id: project.id, name: project.name, location: project.location },
      payRef,
      payApps: ctx.getAIAPayAppsForProject(projectId),
      invoices: ctx.getInvoicesForProject(projectId),
      dailyReports: reports,
      dailyReportsLoaded: ctx.dailyReportsLoaded,
      photos,
      photosLoaded: ctx.photosLoaded,
      changeOrders: ctx.getChangeOrdersForProject(projectId),
      coSignatures,
      punchItems: ctx.getPunchItemsForProject(projectId),
      punchSeal: sealStatus === 'ready' ? seal : undefined,
      permits: ctx.getPermitsForProject(projectId),
      lienWaivers: waivers,
      fieldTickets: ctx.getFieldTicketsForProject(projectId),
    };
  }, [project, payRef, ctx, projectId, reports, photos, sealStatus, seal, waivers, coSignatures]);

  // The preview never carries a time: the clock is read once, at the tap.
  const preview = useMemo(
    () => (baseInput ? buildProofPack({ ...baseInput, leaveOut: Array.from(off), generatedAt: '' }) : null),
    [baseInput, off],
  );
  const candidates = useMemo<ProofItem[]>(
    () => (baseInput ? listProofCandidates({ ...baseInput, generatedAt: '' }) : []),
    [baseInput],
  );

  const toggle = useCallback((key: string) => {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setMade({ kind: 'idle' });
  }, []);

  const day = useCallback((d: string | null) => (d ? formatCalendarDay(d) : ''), []);

  const itemTitle = useCallback((i: ProofItem): string => {
    switch (i.kind) {
      case 'daily_report': return day(i.day);
      case 'photo': return day(i.day);
      case 'change_order': return `#${i.number} ${i.description}`.trim();
      case 'punch_seal': return copy.kindLabel('punch_seal');
      case 'punch_item': return i.description;
      case 'inspection': return i.name;
      case 'lien_waiver': return i.subName;
      case 'field_ticket': return `#${i.number} ${i.workDescription}`.trim();
      default: return '';
    }
  }, [copy, day]);

  const itemSub = useCallback((i: ProofItem): string => {
    switch (i.kind) {
      case 'photo': return copy.photoStampBody(i.placeSource);
      case 'change_order': return proofMoney(i.changeAmountCents);
      case 'lien_waiver': return `${day(i.throughDay)} ${proofMoney(i.paidAmountCents)}`.trim();
      case 'punch_item': return i.location;
      case 'daily_report': return i.workPerformed.slice(0, 80);
      default: return day(i.day);
    }
  }, [copy, day]);

  const onCreate = useCallback(async () => {
    if (!baseInput || made.kind === 'busy') return;
    const built = buildProofPack({ ...baseInput, leaveOut: Array.from(off), generatedAt: new Date().toISOString() });
    if (!built.ok) return;
    setMade({ kind: 'busy' });
    try {
      // Where each photo's image is. The gallery copy first, then the report's own.
      const sources: ProofPhotoSource[] = [
        ...photos.map((p) => ({ id: p.id, uri: p.uri, localUri: p.localUri, storagePath: p.storagePath, timestamp: p.timestamp })),
        ...reports.flatMap((r) => (r.photos ?? []).filter((p) => !p.incidentPhoto)
          .map((p) => ({ id: p.id, uri: p.uri, localUri: p.localUri, storagePath: p.storagePath, timestamp: p.timestamp }))),
      ];
      const seen = new Set<string>();
      const photoSources = sources.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
      const res = await createAndShareProofPack({
        pack: built.pack, lang: docLang, branding: ctx.settings.branding, photoSources,
      });
      setMade({ kind: 'made', code: res.saved.fingerprint.code, onFile: !!res.saved.serverCreatedAt, kept: res.keptOnDevice });
      reloadSaved();
    } catch {
      setMade({ kind: 'failed' });
    }
  }, [baseInput, made.kind, off, photos, reports, docLang, ctx.settings.branding, reloadSaved]);

  const onCheck = useCallback(async (s: SavedProofPack) => {
    const k = s.fingerprint.hash;
    setChecks((c) => ({ ...c, [k]: { ...c[k], busy: true } }));
    try {
      const r = await recheckSavedProofPack(s);
      setChecks((c) => ({ ...c, [k]: { ...c[k], check: r.check, busy: false } }));
    } catch {
      setChecks((c) => ({ ...c, [k]: { ...c[k], check: 'not_checked', busy: false } }));
    }
  }, []);

  const onCheckFile = useCallback(async (s: SavedProofPack) => {
    const k = s.fingerprint.hash;
    try {
      const DocumentPicker = await import('expo-document-picker');
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      const uri = picked.canceled ? null : picked.assets?.[0]?.uri;
      if (!uri) return;
      setChecks((c) => ({ ...c, [k]: { ...c[k], busy: true } }));
      const r = await recheckSavedProofPack(s);
      const file = r.onFile === undefined ? 'not_checked' : await checkFileAgainst(uri, r.onFile?.pdfHash ?? null);
      setChecks((c) => ({ ...c, [k]: { ...c[k], file, busy: false } }));
    } catch {
      setChecks((c) => ({ ...c, [k]: { ...c[k], file: 'not_checked', busy: false } }));
    }
  }, []);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <Pressable style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel={copy.backLabel} testID="proof-pack-back">
        <ChevronLeft size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header">{copy.screenTitleLabel}</Text>
    </View>
  );

  if (!project || !preview || !preview.ok) {
    const why = !project || !preview
      ? copy.missingPayBody
      : preview.ok ? '' : preview.reason === 'period_end_missing' ? copy.missingPeriodBody : copy.missingPayBody;
    return (
      <View style={styles.screen} testID="proof-pack-missing">
        {header}
        <View style={styles.body}>
          <View style={styles.blocked}><Text style={styles.blockedText}>{why}</Text></View>
        </View>
      </View>
    );
  }

  const pack = preview.pack;
  const pay = pack.pay;
  const billedCents = pay.kind === 'pay_app' ? pay.currentPaymentDueCents : pay.totalDueCents;
  const byKind = (k: ProofItemKind) => candidates.filter((i) => i.kind === k);

  return (
    <View style={styles.screen} testID="proof-pack-review">
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card} testID="proof-pack-what">
          <Text style={styles.lead}>{copy.whatThisIsBody}</Text>
          <Text style={styles.lead}>{copy.whatThisIsNotBody}</Text>
        </View>

        <View style={styles.card} testID="proof-pack-pay">
          <View style={styles.kindHead}>
            <Text style={styles.value}>{pay.kind === 'pay_app' ? copy.payAppLabel(pay.applicationNumber) : copy.invoiceLabel(pay.number)}</Text>
            <StrengthChip strength={pay.strength} label={copy.strengthLabel(pay.strength)} />
          </View>
          <Text style={styles.heading}>{copy.periodHeadingLabel}</Text>
          <Text style={styles.para} testID="proof-pack-period">
            {pack.period.from ? copy.periodRangeBody(day(pack.period.from), day(pack.period.to)) : copy.periodOpenBody(day(pack.period.to))}
          </Text>
          <Text style={styles.heading}>{copy.billedLabel}</Text>
          <Text style={styles.big} testID="proof-pack-billed">{proofMoney(billedCents)}</Text>
        </View>

        <View style={styles.card} testID="proof-pack-counts">
          <Text style={styles.heading}>{copy.countsHeadingLabel}</Text>
          <View style={styles.strip}>
            {PROOF_STRENGTHS.map((s) => (
              <View key={s} style={styles.stripCell}>
                <Text style={styles.stripCount} testID={`proof-count-${s}`}>{pack.counts[s]}</Text>
                <StrengthChip strength={s} label={copy.strengthLabel(s)} />
              </View>
            ))}
          </View>
          {PROOF_STRENGTHS.map((s) => (
            <View key={s} style={styles.ruleRow}>
              <StrengthChip strength={s} label={copy.strengthLabel(s)} />
              <Text style={styles.ruleText}>{copy.strengthBody(s)}</Text>
            </View>
          ))}
        </View>

        {!waiversSettled && <Text style={styles.note}>{copy.loadingBody}</Text>}
        {waiversSettled && waivers === undefined && <Text style={styles.note} testID="proof-pack-waivers-unread">{copy.waiversNotReadBody}</Text>}

        {PROOF_ITEM_KINDS.map((k) => {
          const rows = byKind(k);
          const included = rows.filter((i) => !off.has(i.key)).length;
          return (
            <View key={k} style={styles.card} testID={`proof-kind-${k}`}>
              <View style={styles.kindHead}>
                <Text style={styles.value}>{copy.kindLabel(k)}</Text>
                {rows.length > 0 && <Text style={styles.note}>{copy.includedCountBody(included, rows.length)}</Text>}
              </View>
              {rows.length === 0 && <Text style={styles.note}>{copy.emptyKindBody}</Text>}
              {rows.map((i) => {
                const on = !off.has(i.key);
                const title = itemTitle(i) || copy.kindLabel(k);
                return (
                  <View key={i.key} style={[styles.row, !on && styles.rowOff]} testID={`proof-item-${i.key}`}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
                      {!!itemSub(i) && <Text style={styles.rowSub} numberOfLines={2}>{itemSub(i)}</Text>}
                      <StrengthChip strength={i.strength} label={copy.strengthLabel(i.strength)} />
                    </View>
                    <Switch
                      value={on}
                      onValueChange={() => toggle(i.key)}
                      accessibilityLabel={copy.includeA11yLabel(title)}
                      testID={`proof-switch-${i.key}`}
                    />
                  </View>
                );
              })}
            </View>
          );
        })}

        <View style={styles.card}>
          <Text style={styles.para} testID="proof-pack-left-out">
            {pack.leftOut.total > 0 ? copy.leftOutBody(pack.leftOut.total) : copy.nothingLeftOutBody}
          </Text>
          <Text style={styles.heading}>{copy.openHeadingLabel}</Text>
          <Text style={styles.para} testID="proof-pack-open">{copy.openCountBody(pack.openItems.length)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>{copy.languageHeadingLabel}</Text>
          <View style={styles.langRow}>
            {(['en', 'es'] as const).map((l) => (
              <Pressable
                key={l}
                style={[styles.lang, docLang === l && styles.langOn]}
                onPress={() => setDocLang(l)}
                accessibilityRole="button"
                accessibilityState={{ selected: docLang === l }}
                testID={`proof-lang-${l}`}
              >
                <Text style={[styles.langText, docLang === l && styles.langTextOn]}>
                  {l === 'en' ? copy.languageEnglishLabel : copy.languageSpanishLabel}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card} testID="proof-pack-privacy">
          <Text style={styles.heading}>{copy.privacyHeadingLabel}</Text>
          <Text style={styles.para}>{copy.privacyBody}</Text>
          <Text style={styles.para}>{copy.peopleBody}</Text>
        </View>

        <Button
          label={made.kind === 'busy' ? copy.creatingLabel : copy.createLabel}
          variant="primary"
          onPress={onCreate}
          loading={made.kind === 'busy'}
          disabled={made.kind === 'busy'}
          testID="proof-pack-create"
        />
        {made.kind === 'made' && (
          <View style={styles.result} testID="proof-pack-made">
            <Text style={styles.para}>{made.onFile ? copy.madeOnFileBody(made.code) : copy.madeNotOnFileBody}</Text>
            {!made.kept && <Text style={styles.para}>{copy.notKeptBody}</Text>}
          </View>
        )}
        {made.kind === 'failed' && (
          <View style={styles.blocked} testID="proof-pack-failed"><Text style={styles.blockedText}>{copy.failedBody}</Text></View>
        )}

        <View style={styles.card} testID="proof-pack-saved">
          <Text style={styles.heading}>{copy.savedHeadingLabel}</Text>
          {savedPacks.length === 0 && <Text style={styles.note}>{copy.savedEmptyBody}</Text>}
          {savedPacks.map((s) => {
            const st = checks[s.fingerprint.hash] ?? {};
            const name = s.pack.pay.kind === 'pay_app' ? copy.payAppLabel(s.pack.pay.applicationNumber) : copy.invoiceLabel(s.pack.pay.number);
            return (
              <View key={s.fingerprint.hash} style={[styles.row, { flexDirection: 'column', alignItems: 'stretch' }]} testID={`proof-saved-${s.fingerprint.code}`}>
                <Text style={styles.rowTitle}>{name}</Text>
                <Text style={styles.heading}>{copy.checkCodeLabel}</Text>
                <Text style={styles.code}>{s.fingerprint.code}</Text>
                <Text style={styles.heading}>{copy.fingerprintLabel}</Text>
                <Text style={styles.mono} selectable>{s.fingerprint.hash}</Text>
                <View style={styles.btnRow}>
                  <Button label={copy.checkAgainLabel} variant="secondary" onPress={() => onCheck(s)} loading={!!st.busy} testID={`proof-check-${s.fingerprint.code}`} />
                  {Platform.OS !== 'web' && (
                    <Button label={copy.checkFileLabel} variant="secondary" onPress={() => onCheckFile(s)} testID={`proof-check-file-${s.fingerprint.code}`} />
                  )}
                </View>
                {Platform.OS === 'web' && <Text style={styles.note}>{copy.fileCheckNativeBody}</Text>}
                {st.check && <Text style={styles.para} testID={`proof-check-result-${s.fingerprint.code}`}>{copy.checkBody(st.check)}</Text>}
                {st.file && <Text style={styles.para} testID={`proof-file-result-${s.fingerprint.code}`}>{copy.fileCheckBody(st.file)}</Text>}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
