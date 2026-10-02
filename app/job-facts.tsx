// app/job-facts.tsx — the owner's screen for a job facts link (lane FACTS, M4).
//
// The GC picks which sections of one job appear (permits, inspections, the
// change-order trail, finished milestones, chosen photos, closeout and
// warranties), previews EXACTLY what the viewer will see, and publishes a
// read-only page at https://mageid.app/facts/<code>. Refresh rewrites the same
// link; Revoke turns it off for everyone at once.
//
// ONE PAYLOAD. The preview renders the output of utils/jobFacts/buildJobFacts
// — the same object Publish / Refresh write and job-facts-view serves. There
// is no second renderer of "what the page will say" fed from other data.
//
// HONESTY. Recorded facts only: no AI, no predictions, no percentages. The
// link, the "Copied" chip and "Turned off" appear only after the awaited write
// returns the server's row (utils/jobFacts/jobFactLinks.ts — online-only, not
// queued; see its header for why). Offline, every write is disabled and says
// why. Money only behind the amounts switch (off by default), in cents.
// What the builder left out is listed, never hidden.
//
// Phone: one scroll, ChevronLeft back. Desktop web: two panes, the picker on
// the left and the preview on the right.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, FileCheck, Link2, RefreshCw, WifiOff, XCircle } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useCoreData, useDocsData, useFieldData, useFinancialsData } from '@/contexts/ProjectContext';
import { Button, Card, ScreenHeader } from '@/components/ui';
import { CheckSync, StaggerList, type CheckRow, type CheckStatus } from '@/components/motion/kit';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useOffline } from '@/hooks/useOnline';
import { showAlert } from '@/utils/alert';
import { formatCalendarDayL, formatDateL } from '@/i18n';
import { loadCloseoutBinderChecked } from '@/utils/closeoutBinderEngine';
import { isPhotoShareable } from '@/utils/photoShareToken';
import { JOB_FACTS_PHOTO_MAX, buildJobFacts, payloadPhotoIds, type JobFactsBinder } from '@/utils/jobFacts/buildJobFacts';
import { buildFactsUrl, fetchForProject, publish, refresh, revoke } from '@/utils/jobFacts/jobFactLinks';
import {
  JOB_FACT_SECTIONS,
  type JobFact,
  type JobFactLeftOut,
  type JobFactLink,
  type JobFactSection,
  type JobFactsPayload,
} from '@/utils/jobFacts/types';

type T = ReturnType<typeof useT>['t'];
type TN = ReturnType<typeof useT>['tn'];

/** jsonb reorders object keys, so "has the page changed?" compares key-sorted JSON. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function sectionName(t: T, s: JobFactSection): string {
  switch (s) {
    case 'permits': return t('office.jobFacts.section.permits', 'Permits');
    case 'inspections': return t('office.jobFacts.section.inspections', 'Inspections');
    case 'changeOrders': return t('office.jobFacts.section.changeOrders', 'Change orders');
    case 'milestones': return t('office.jobFacts.section.milestones', 'Finished milestones');
    case 'photos': return t('office.jobFacts.section.photos', 'Photos');
    case 'closeout': return t('office.jobFacts.section.closeout', 'Closeout and warranties');
  }
}

function sectionHint(t: T, s: JobFactSection): string {
  switch (s) {
    case 'permits': return t('office.jobFacts.hint.permits', 'Number, type, office and status, with the applied, approved and expiry dates.');
    case 'inspections': return t('office.jobFacts.hint.inspections', 'Each inspection’s name, result and date. Never the inspector’s notes.');
    case 'changeOrders': return t('office.jobFacts.hint.changeOrders', 'Number, description, status and each recorded step. Drafts never show.');
    case 'milestones': return t('office.jobFacts.hint.milestones', 'Milestones marked done with a recorded finish date. No planned dates.');
    case 'photos': return t('office.jobFacts.hint.photos', 'Only the photos you pick, up to 30.');
    case 'closeout': return t('office.jobFacts.hint.closeout', 'When the closeout binder was finalized and delivered, and each warranty’s term.');
  }
}

/** "From the permit log", "From change order #4" — the same words the public page prints. */
function sourceLine(t: T, f: JobFact): string {
  switch (f.source.record) {
    case 'permit': return t('office.jobFacts.source.permit', 'From the permit log');
    case 'inspection': return t('office.jobFacts.source.inspection', 'From the inspection log');
    case 'change_order': return t('office.jobFacts.source.changeOrder', 'From change order #{n}', { n: f.source.ref });
    case 'schedule': return t('office.jobFacts.source.schedule', 'From the schedule');
    case 'photo': return t('office.jobFacts.source.photo', 'From the photo log');
    case 'warranty': return t('office.jobFacts.source.warranty', 'From the warranty log');
    case 'closeout_binder': return t('office.jobFacts.source.binder', 'From the closeout binder');
  }
}

function leftOutLine(tn: TN, l: JobFactLeftOut): string {
  const c = l.count;
  const k = `${l.kind}:${l.reason}`;
  switch (k) {
    case 'milestone:no_date': return tn('office.jobFacts.leftOut.milestoneNoDate', c, { one: '1 finished milestone has no recorded finish date, so it’s not shown.', other: '{count} finished milestones have no recorded finish date, so they’re not shown.' });
    case 'permit:no_date': return tn('office.jobFacts.leftOut.permitNoDate', c, { one: '1 permit has no dates recorded, so it’s not shown.', other: '{count} permits have no dates recorded, so they’re not shown.' });
    case 'inspection:no_date': return tn('office.jobFacts.leftOut.inspectionNoDate', c, { one: '1 inspection has no date, so it’s not shown.', other: '{count} inspections have no date, so they’re not shown.' });
    case 'change_order:draft': return tn('office.jobFacts.leftOut.coDraft', c, { one: '1 draft change order is never shown.', other: '{count} draft change orders are never shown.' });
    case 'change_order:no_date': return tn('office.jobFacts.leftOut.coNoDate', c, { one: '1 change order has no date, so it’s not shown.', other: '{count} change orders have no date, so they’re not shown.' });
    case 'change_order_event:internal': return tn('office.jobFacts.leftOut.coInternal', c, { one: '1 internal change-order record (a note or a marker) is not shown.', other: '{count} internal change-order records (notes and markers) are not shown.' });
    case 'change_order_event:no_date': return tn('office.jobFacts.leftOut.coEventNoDate', c, { one: '1 change-order step has no date, so it’s not shown.', other: '{count} change-order steps have no date, so they’re not shown.' });
    case 'photo:recalled': return tn('office.jobFacts.leftOut.photoRecalled', c, { one: '1 photo is drafted or recalled in the client portal, so it’s not shown.', other: '{count} photos are drafted or recalled in the client portal, so they’re not shown.' });
    case 'photo:not_synced': return tn('office.jobFacts.leftOut.photoNotSynced', c, { one: '1 photo hasn’t uploaded yet, so it’s not shown.', other: '{count} photos haven’t uploaded yet, so they’re not shown.' });
    case 'photo:not_found': return tn('office.jobFacts.leftOut.photoNotFound', c, { one: '1 picked photo is no longer on this job.', other: '{count} picked photos are no longer on this job.' });
    case 'photo:over_cap': return tn('office.jobFacts.leftOut.photoOverCap', c, { one: '1 photo is over the 30-photo limit.', other: '{count} photos are over the 30-photo limit.' });
    case 'photo:no_date': return tn('office.jobFacts.leftOut.photoNoDate', c, { one: '1 photo has no date, so it’s not shown.', other: '{count} photos have no date, so they’re not shown.' });
    case 'warranty:recalled': return tn('office.jobFacts.leftOut.warrantyRecalled', c, { one: '1 warranty is drafted or recalled in the client portal, so it’s not shown.', other: '{count} warranties are drafted or recalled in the client portal, so they’re not shown.' });
    case 'warranty:no_date': return tn('office.jobFacts.leftOut.warrantyNoDate', c, { one: '1 warranty has no start or end date, so it’s not shown.', other: '{count} warranties have no start or end date, so they’re not shown.' });
    case 'closeout_binder:no_date': return tn('office.jobFacts.leftOut.binderNoDate', c, { one: 'The closeout binder is missing 1 recorded date, so that step isn’t shown.', other: 'The closeout binder is missing {count} recorded dates, so those steps aren’t shown.' });
    default: return tn('office.jobFacts.leftOut.other', c, { one: '1 record isn’t shown.', other: '{count} records aren’t shown.' });
  }
}

type Busy = null | 'load' | 'publish' | 'refresh' | 'revoke';
type Beat = { key: string; status: CheckStatus; text: string };

export default function JobFactsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tn } = useT();
  const { colors: c } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const offline = useOffline();
  const { projectId: rawId } = useLocalSearchParams<{ projectId?: string }>();
  const projectId = typeof rawId === 'string' ? rawId : '';

  const { getProject, settings } = useCoreData();
  const { projectPhotos } = useFieldData();
  const { changeOrders } = useFinancialsData();
  const { warranties, permits } = useDocsData();
  const project = projectId ? getProject(projectId) : null;

  const [sections, setSections] = useState<JobFactSection[]>([]);       // all off on first open
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [includeCoAmounts, setIncludeCoAmounts] = useState(false);
  const [binder, setBinder] = useState<JobFactsBinder | null>(null);
  const [link, setLink] = useState<JobFactLink | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>('load');
  const [beat, setBeat] = useState<Beat | null>(null);
  const [copied, setCopied] = useState(false);
  const beatSeq = useRef(0);
  const seeded = useRef(false);

  // The live link and the binder, once per job.
  useEffect(() => {
    if (!projectId) { setBusy(null); return; }
    let alive = true;
    setBusy('load');
    void (async () => {
      const [res, b] = await Promise.all([fetchForProject(projectId), loadCloseoutBinderChecked(projectId)]);
      if (!alive) return;
      if (b.ok && b.value) setBinder({ status: b.value.status, finalizedAt: b.value.finalizedAt, sentAt: b.value.sentAt });
      if (res.ok) {
        setLink(res.value);
        setLoadError(null);
        // A live link opens on what it published, so the preview starts as the page.
        if (res.value && !seeded.current) {
          seeded.current = true;
          setSections(JOB_FACT_SECTIONS.filter((s) => res.value!.sections.includes(s)));
          setPhotoIds(payloadPhotoIds(res.value.payload));
          setIncludeCoAmounts(res.value.payload?.includeCoAmounts === true);
        }
      } else {
        setLoadError(res.error);
      }
      setBusy(null);
    })();
    return () => { alive = false; };
  }, [projectId]);

  const jobPhotos = useMemo(() => (projectPhotos ?? []).filter((p) => p.projectId === projectId), [projectPhotos, projectId]);
  const pickable = useMemo(() => jobPhotos.filter((p) => isPhotoShareable(p) && !!p.storagePath), [jobPhotos]);

  const payload: JobFactsPayload | null = useMemo(() => {
    if (!project) return null;
    return buildJobFacts({
      project,
      businessName: settings?.branding?.companyName ?? null,
      permits: (permits ?? []).filter((p) => p.projectId === projectId),
      changeOrders: (changeOrders ?? []).filter((co) => co.projectId === projectId),
      photos: jobPhotos,
      warranties: (warranties ?? []).filter((w) => w.projectId === projectId),
      binder,
      sections,
      photoIds,
      includeCoAmounts,
    });
  }, [project, settings?.branding?.companyName, permits, changeOrders, jobPhotos, warranties, binder, sections, photoIds, includeCoAmounts, projectId]);

  // S3: the preview differs from what the page serves → nudge Refresh.
  const stale = !!link && !!payload && stableJson(link.payload) !== stableJson(payload);
  const nothingOn = sections.length === 0;

  const flash = useCallback((status: CheckStatus, text: string, key?: string) => {
    const k = key ?? `beat-${++beatSeq.current}`;
    setBeat({ key: k, status, text });
    return k;
  }, []);

  const toggleSection = useCallback((s: JobFactSection, on: boolean) => {
    setSections((cur) => JOB_FACT_SECTIONS.filter((x) => (x === s ? on : cur.includes(x))));
  }, []);

  const togglePhoto = useCallback((id: string) => {
    setPhotoIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= JOB_FACTS_PHOTO_MAX ? cur : [...cur, id]));
  }, []);

  const onPublish = useCallback(async () => {
    if (!payload || offline || busy) return;
    setBusy('publish');
    const k = flash('active', t('office.jobFacts.beat.publishing', 'Publishing the link…'));
    const res = await publish(projectId, [...payload.sections], payload);
    if (res.ok) { setLink(res.value); setCopied(false); flash('done', t('office.jobFacts.beat.published', 'Link published'), k); }
    else flash('failed', res.error, k);
    setBusy(null);
  }, [payload, offline, busy, flash, t, projectId]);

  const onRefresh = useCallback(async () => {
    if (!payload || !link || offline || busy) return;
    setBusy('refresh');
    const k = flash('active', t('office.jobFacts.beat.refreshing', 'Refreshing the facts…'));
    const res = await refresh(link.id, [...payload.sections], payload);
    if (res.ok) { setLink(res.value); flash('done', t('office.jobFacts.beat.refreshed', 'Facts refreshed. Same link.'), k); }
    else flash('failed', res.error, k);
    setBusy(null);
  }, [payload, link, offline, busy, flash, t]);

  const onCopy = useCallback(async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(buildFactsUrl(link.code));
      setCopied(true);
    } catch {
      flash('failed', t('office.jobFacts.copyFailed', 'Couldn’t copy the link. Select it and copy it by hand.'));
    }
  }, [link, flash, t]);

  const doRevoke = useCallback(async () => {
    if (!link || offline) return;
    setBusy('revoke');
    const k = flash('active', t('office.jobFacts.beat.revoking', 'Turning off the link…'));
    const res = await revoke(link.id);
    if (res.ok) { setLink(null); setCopied(false); flash('done', t('office.jobFacts.beat.revoked', 'Link turned off. Anyone who opens it sees “no longer active.”'), k); }
    else flash('failed', res.error, k);
    setBusy(null);
  }, [link, offline, flash, t]);

  const onRevoke = useCallback(() => {
    if (!link || offline || busy) return;
    showAlert(
      t('office.jobFacts.revokeTitle', 'Turn off this link?'),
      t('office.jobFacts.revokeBody', 'Anyone who has it will see ‘no longer active.’ You can publish a new link later, but this one can’t be turned back on.'),
      [
        { text: t('office.jobFacts.cancel', 'Cancel'), style: 'cancel' },
        { text: t('office.jobFacts.revokeConfirm', 'Turn off link'), style: 'destructive', onPress: () => { void doRevoke(); } },
      ],
    );
  }, [link, offline, busy, t, doRevoke]);

  const checkRows: CheckRow[] = beat ? [{
    key: beat.key,
    status: beat.status,
    render: (st) => <Text style={[styles.beatText, st === 'failed' && styles.beatFailed]}>{beat.text}</Text>,
  }] : [];

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)' as never));

  if (!project) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader variant="tool" title={t('office.jobFacts.screenTitle', 'Job facts')} onBack={back} />
        <View style={styles.pad}>
          <Text style={styles.body}>{t('office.jobFacts.noJob', 'Open a job first. Job facts are shared one job at a time.')}</Text>
        </View>
      </View>
    );
  }

  // ── the link card ──────────────────────────────────────────────────────────
  const linkCard = (
    <Card style={styles.block} testID="job-facts-link">
      <View style={styles.rowHead}>
        <Link2 size={18} color={c.accent} />
        <Text style={styles.blockHead}>{t('office.jobFacts.linkHead', 'Your link')}</Text>
      </View>
      {offline && (
        <View style={styles.warn} testID="job-facts-offline">
          <WifiOff size={16} color={c.warningLabel} />
          <Text style={styles.warnText}>{t('office.jobFacts.offline', 'You’re offline. Publishing needs a connection so the link works the moment you send it.')}</Text>
        </View>
      )}
      {loadError && <Text style={styles.errorText}>{loadError}</Text>}
      {busy === 'load' ? (
        <Text style={styles.muted}>{t('office.jobFacts.loading', 'Checking for a live link…')}</Text>
      ) : link ? (
        <>
          <Text style={styles.url} selectable testID="job-facts-url">{buildFactsUrl(link.code)}</Text>
          <Text style={styles.muted}>{t('office.jobFacts.asOf', 'Facts as of {date}', { date: formatDateL(link.publishedAt) })}</Text>
          <Text style={styles.muted}>
            {link.lastViewedAt
              ? t('office.jobFacts.lastOpened', 'Last opened {date}', { date: formatDateL(link.lastViewedAt) })
              : t('office.jobFacts.notOpened', 'Not opened yet')}
          </Text>
          {stale && (
            <View style={styles.warn} testID="job-facts-stale">
              <RefreshCw size={16} color={c.warningLabel} />
              <Text style={styles.warnText}>{t('office.jobFacts.stale', 'The preview no longer matches the page. Refresh facts to update it. The link stays the same.')}</Text>
            </View>
          )}
          <View style={styles.actions}>
            <Button label={copied ? t('office.jobFacts.copied', 'Copied') : t('office.jobFacts.copy', 'Copy link')} onPress={() => { void onCopy(); }} variant="secondary" size="sm"
              iconLeft={copied ? <Check size={16} color={c.successLabel} /> : <Copy size={16} color={c.text} />} testID="job-facts-copy" />
            <Button label={t('office.jobFacts.refresh', 'Refresh facts')} onPress={() => { void onRefresh(); }} variant={stale ? 'primary' : 'secondary'} size="sm"
              disabled={offline || !!busy || nothingOn} loading={busy === 'refresh'} testID="job-facts-refresh" />
            <Button label={t('office.jobFacts.revoke', 'Turn off link')} onPress={onRevoke} variant="destructive" size="sm"
              disabled={offline || !!busy} loading={busy === 'revoke'} iconLeft={<XCircle size={16} color={c.dangerLabel} />} testID="job-facts-revoke" />
          </View>
          <Text style={styles.dangerNote}>{t('office.jobFacts.revokeNote', 'Turning it off stops the link working for anyone who has it.')}</Text>
        </>
      ) : (
        <>
          <Text style={styles.muted}>{t('office.jobFacts.noLink', 'No live link for this job yet. Pick what to share, check the preview, then publish.')}</Text>
          <View style={styles.actions}>
            <Button label={t('office.jobFacts.publish', 'Publish link')} onPress={() => { void onPublish(); }} size="sm"
              disabled={offline || !!busy || nothingOn} loading={busy === 'publish'} testID="job-facts-publish" />
          </View>
          {nothingOn && !offline && <Text style={styles.muted}>{t('office.jobFacts.pickFirst', 'Turn on at least one section to publish.')}</Text>}
        </>
      )}
      {checkRows.length > 0 && (
        <CheckSync
          rows={checkRows}
          style={styles.beat}
          renderCheck={(st) => (st === 'done' ? <Check size={16} color={c.successLabel} /> : st === 'failed' ? <XCircle size={16} color={c.dangerLabel} /> : <View style={styles.dot} />)}
          testID="job-facts-beat"
        />
      )}
    </Card>
  );

  // ── the picker ─────────────────────────────────────────────────────────────
  const picker = (
    <View>
      {linkCard}
      <Card style={styles.block} testID="job-facts-picker">
        <Text style={styles.blockHead}>{t('office.jobFacts.pickHead', 'What the page shows')}</Text>
        <StaggerList
          items={JOB_FACT_SECTIONS}
          keyOf={(s) => s}
          armed={busy !== 'load'}
          renderItem={(s, _i, enter) => (
            <Animated.View style={[styles.toggleRow, enter]}>
              <View style={styles.flex}>
                <Text style={styles.toggleName}>{sectionName(t, s)}</Text>
                <Text style={styles.muted}>{sectionHint(t, s)}</Text>
                {s === 'changeOrders' && sections.includes('changeOrders') && (
                  <View style={styles.subToggle}>
                    <Text style={[styles.body, styles.flex]}>{t('office.jobFacts.amounts', 'Show dollar amounts')}</Text>
                    <Switch value={includeCoAmounts} onValueChange={setIncludeCoAmounts} trackColor={{ false: c.line, true: c.accent }}
                      accessibilityLabel={t('office.jobFacts.amounts', 'Show dollar amounts')} testID="job-facts-amounts" />
                  </View>
                )}
              </View>
              <Switch value={sections.includes(s)} onValueChange={(v) => toggleSection(s, v)} trackColor={{ false: c.line, true: c.accent }}
                accessibilityLabel={sectionName(t, s)} testID={`job-facts-section-${s}`} />
            </Animated.View>
          )}
        />
      </Card>
      {sections.includes('photos') && (
        <Card style={styles.block} testID="job-facts-photos">
          <Text style={styles.blockHead}>
            {t('office.jobFacts.photosPicked', 'Photos picked: {n} of {max}', { n: photoIds.length, max: JOB_FACTS_PHOTO_MAX })}
          </Text>
          {pickable.length === 0 ? (
            <Text style={styles.muted}>{t('office.jobFacts.noPhotos', 'No photos on this job can be shared yet. A photo shows here once it has uploaded and isn’t drafted or recalled in the client portal.')}</Text>
          ) : (
            <View style={styles.grid}>
              {pickable.slice(0, 200).map((p) => {
                const on = photoIds.includes(p.id);
                const full = !on && photoIds.length >= JOB_FACTS_PHOTO_MAX;
                return (
                  <Pressable key={p.id} onPress={() => togglePhoto(p.id)} disabled={full}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: full }}
                    accessibilityLabel={p.tag || t('office.jobFacts.photoA11y', 'Photo')}
                    style={[styles.thumbWrap, on && styles.thumbOn, full && styles.thumbOff]}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    {on && <View style={styles.thumbCheck}><Check size={12} color={c.surface} /></View>}
                  </Pressable>
                );
              })}
            </View>
          )}
          {photoIds.length >= JOB_FACTS_PHOTO_MAX && <Text style={styles.muted}>{t('office.jobFacts.photoCap', '30 photos is the most one page shows.')}</Text>}
        </Card>
      )}
    </View>
  );

  // ── the preview: the payload itself ────────────────────────────────────────
  const photoUri = new Map(jobPhotos.map((p) => [p.id, p.uri]));
  const preview = payload && (
    <Card style={styles.block} testID="job-facts-preview">
      <Text style={styles.eyebrow}>{t('office.jobFacts.previewEyebrow', 'Preview · what the viewer sees')}</Text>
      <Text style={styles.previewJob}>{payload.job.name}</Text>
      {payload.job.business && <Text style={styles.muted}>{payload.job.business}</Text>}
      <Text style={styles.muted}>
        {link && !stale
          ? t('office.jobFacts.asOf', 'Facts as of {date}', { date: formatDateL(link.publishedAt) })
          : t('office.jobFacts.notPublished', 'Not published yet. The page will say the date you publish.')}
      </Text>
      {payload.sections.length === 0 && <Text style={[styles.body, styles.gap]}>{t('office.jobFacts.emptyPreview', 'Nothing is switched on, so the page would be empty.')}</Text>}
      {payload.sections.map((s) => {
        const list = payload.facts.filter((f) => f.section === s);
        return (
          <View key={s} style={styles.gap}>
            <Text style={styles.sectionHead}>{sectionName(t, s)}</Text>
            {list.length === 0 && <Text style={styles.muted}>{t('office.jobFacts.noneRecorded', 'Nothing recorded yet.')}</Text>}
            {list.map((f, i) => (
              <View key={`${f.kind}-${i}`} style={styles.fact}>
                {f.photo && photoUri.get(f.photo.id) ? <Image source={{ uri: photoUri.get(f.photo.id) }} style={styles.factPhoto} /> : null}
                <View style={styles.flex}>
                  <Text style={styles.factValue}>{f.value}</Text>
                  <Text style={styles.body}>{f.label}{f.detail ? ` · ${f.detail}` : ''}</Text>
                  {typeof f.amountCents === 'number' && (
                    <Text style={styles.body}>{(f.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</Text>
                  )}
                  <Text style={styles.muted}>{sourceLine(t, f)} · {f.term ? formatCalendarDayL(f.date) : t('office.jobFacts.recorded', 'Recorded {date}', { date: formatCalendarDayL(f.date) })}</Text>
                </View>
              </View>
            ))}
          </View>
        );
      })}
      {payload.leftOut.length > 0 && (
        <View style={[styles.warn, styles.gap]} testID="job-facts-leftout">
          <View style={styles.flex}>
            <Text style={styles.warnHead}>{t('office.jobFacts.leftOutHead', 'Left out')}</Text>
            {payload.leftOut.map((l) => <Text key={`${l.kind}:${l.reason}`} style={styles.warnText}>{leftOutLine(tn, l)}</Text>)}
          </View>
        </View>
      )}
      <Text style={[styles.muted, styles.gap]}>
        {t('office.jobFacts.footer', 'Read-only. Shared by {business}. Nothing here is a prediction.', { business: payload.job.business || t('office.jobFacts.yourBusiness', 'your business') })}
      </Text>
    </Card>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        variant="tool"
        title={t('office.jobFacts.screenTitle', 'Job facts')}
        subtitle={t('office.jobFacts.subtitle', 'A read-only page with the facts you pick. Nothing is predicted.')}
        onBack={back}
        actions={<FileCheck size={20} color={c.accent} />}
      />
      {isDesktop ? (
        <View style={styles.panes}>
          <ScrollView style={styles.paneLeft} contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>{picker}</ScrollView>
          <ScrollView style={styles.paneRight} contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>{preview}</ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}>
          {picker}
          {preview}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    pad: { padding: 16, gap: 12 },
    panes: { flex: 1, flexDirection: 'row' },
    paneLeft: { flex: 5, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.line },
    paneRight: { flex: 6 },
    block: { marginBottom: 12 },
    flex: { flex: 1 },
    gap: { marginTop: 14 },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    blockHead: { ...Type.headline, color: c.text, marginBottom: 6 },
    sectionHead: { ...Type.subheadEmphasized, color: c.text, marginBottom: 6 },
    previewJob: { ...Type.serifHeadline, color: c.text, marginTop: 4 },
    eyebrow: { ...Type.footnoteEmphasized, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    body: { ...Type.bodyCompact, color: c.text },
    muted: { ...Type.footnote, color: c.textSecondary, marginTop: 2 },
    url: { ...Type.bodyCompactEmphasized, color: c.accentLabel, marginTop: 8 },
    errorText: { ...Type.footnote, color: c.dangerLabel, marginTop: 6 },
    dangerNote: { ...Type.footnote, color: c.dangerLabel, marginTop: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.warningSoft, borderRadius: Tokens.radius.md, padding: 10, marginTop: 8 },
    warnHead: { ...Type.footnoteEmphasized, color: c.warningLabel, marginBottom: 2 },
    warnText: { ...Type.footnote, color: c.warningLabel, flex: 1 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    toggleName: { ...Type.bodyCompactEmphasized, color: c.text },
    subToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    thumbWrap: { width: 72, height: 72, borderRadius: Tokens.radius.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
    thumbOn: { borderColor: c.accent },
    thumbOff: { opacity: 0.4 },
    thumb: { width: '100%', height: '100%' },
    thumbCheck: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: Tokens.radius.full, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    fact: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    factPhoto: { width: 56, height: 56, borderRadius: Tokens.radius.xs },
    factValue: { ...Type.bodyCompactEmphasized, color: c.text },
    beat: { marginTop: 10 },
    beatText: { ...Type.footnote, color: c.text, flex: 1 },
    beatFailed: { color: c.dangerLabel },
    dot: { width: 8, height: 8, borderRadius: Tokens.radius.full, backgroundColor: c.textMuted },
  });
}
