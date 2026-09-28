// components/buildingRecord/MdDraftQuestion.tsx — "Draft a question" for a
// Baltimore City or Baltimore County job.
//
// Rendered by DraftQuestionButton's Maryland branch, which runs BEFORE that
// component's NYC decision (a job whose address is only "Baltimore, MD" has
// no department until the Census place lookup answers).
//
// SAME RULES AS THE NYC SHEET. The contractor types the question, the model
// drafts a subject and body through the same client path (mageAISmart +
// buildQuestionPrompt), and he sends it himself from his mail app or copies
// it. Nothing is sent from here: no edge function, no email service.
//
// WHICH GOVERNMENT. Baltimore City (DHCD) and Baltimore County (PAI) are
// separate governments. The department comes from the verified rows in
// utils/codeJurisdiction.ts, resolved first from the job's own address (its
// county, a ZIP that lies in one of them, or the side of a parcel the
// contractor confirmed on the Building record card), then from the Census
// county of the place lookup. Any other Maryland county renders nothing here:
// the Department card shows its name-only office, and MAGE never drafts to an
// office it has not verified.
//
// WHO. Baltimore's permits data publishes no applicant MAGE may show, so the
// card names the office, never a person. The office is the contractor's pick
// among the row's channels that have a phone or an email; nothing infers it
// from a permit. An office with no email gets none (never another desk's).
// FILING FACTS. The job's permit number is matched with mdPermitForNumber;
// the prompt says "not checked" when the record was not loaded or the read
// failed, and never describes a City permit's status (the City publishes none).

import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import { MessageSquare } from 'lucide-react-native';
import { z } from 'zod';
import type { Project } from '@/types';
import { Button, Sheet, cardSurface } from '@/components/ui';
import { type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useJobBuildingRecord } from '@/hooks/useJobBuildingRecord';
import { mdPermitForNumber, type MdPermitRow } from '@/utils/buildingRecord';
import {
  departmentFor,
  jurisdictionQueryForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
  type ResolvedCodeJurisdiction,
} from '@/utils/codeJurisdiction';
import {
  buildQuestionPrompt,
  mdFilingStateFor,
  mdOfficeChannels,
  routeQuestion,
  type JobFiling,
  type MdSideLike,
} from '@/utils/departmentQuestion';
import { placeQueryForProject } from '@/utils/permitOffices';
import { usePlaceLookup } from '@/utils/placeLookup';
import { mageAISmart } from '@/utils/mageAI';
import { copyToClipboard } from '@/utils/clipboard';
import { showAlert } from '@/utils/alert';

const draftSchema = z.object({
  subject: z.string().catch('').default(''),
  body: z.string().catch('').default(''),
});

/** Maryland routing reads Baltimore's permits data, never an NYC filing. */
const NO_NYC_FILING: JobFiling = { state: 'not_checked', filing: null, asOf: null };

/** The side a verified Baltimore row stands for, or null for any other row. */
export function mdSideForResolved(r: ResolvedCodeJurisdiction | null | undefined): MdSideLike | null {
  if (!r || r.kind !== 'city' || r.entry.state !== 'MD') return null;
  if (r.entry.name === 'Baltimore City') return 'baltimore_city';
  if (r.entry.name === 'Baltimore County') return 'baltimore_county';
  return null;
}

export interface MdDraftQuestionProps {
  project: Project;
  permitNumber?: string | null;
  permitNumbers?: ReadonlyArray<string | null | undefined>;
  topic?: string;
  testID?: string;
}

export function MdDraftQuestion({ project, permitNumber, permitNumbers, topic, testID }: MdDraftQuestionProps) {
  const building = useJobBuildingRecord(project);
  // The job's own address first (county, single-government ZIP, or the parcel
  // side the contractor confirmed).
  const first = resolveCodeJurisdiction(jurisdictionQueryForProject(project, building.confirmedCounty));
  const firstDepartment = departmentFor(first);
  // Only when that settles nothing does the Census place lookup run.
  const placeQuery = useMemo(
    () => (firstDepartment ? null : placeQueryForProject(project)),
    [firstDepartment, project],
  );
  const lookup = usePlaceLookup(placeQuery);

  let resolved: ResolvedCodeJurisdiction | null = firstDepartment ? first : null;
  if (!resolved && lookup.status === 'done' && lookup.place?.county?.name) {
    resolved = resolveCodeJurisdiction({
      ...jurisdictionQueryForProject(project, building.confirmedCounty),
      county: lookup.place.county.name,
    });
  }
  const department = resolved ? departmentFor(resolved) : null;
  const side = mdSideForResolved(resolved);
  if (!department || !side || !resolved || resolved.kind !== 'city') return null;

  // The loaded record counts only when it is for the same government.
  const md = building.md;
  const record = md.phase === 'ready' && md.side === side ? md.record : null;
  return (
    <MdDraftSheet
      project={project}
      department={department}
      authorityName={resolved.entry.authorityName}
      side={side}
      record={record}
      summary={record ? md.summary : null}
      permitNumber={permitNumber}
      permitNumbers={permitNumbers}
      topic={topic}
      testID={testID}
    />
  );
}

export default MdDraftQuestion;

type MdRecord = NonNullable<ReturnType<typeof useJobBuildingRecord>['md']['record']>;
type MdSummary = ReturnType<typeof useJobBuildingRecord>['md']['summary'];

function MdDraftSheet({
  project, department, authorityName, side, record, summary, permitNumber, permitNumbers, topic, testID,
}: {
  project: Project;
  department: BuildingDepartment;
  authorityName: string;
  side: MdSideLike;
  record: MdRecord | null;
  summary: MdSummary | null;
  permitNumber?: string | null;
  permitNumbers?: ReadonlyArray<string | null | undefined>;
  topic?: string;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // Only the channels with a phone or an email are offices to ask.
  const channels = useMemo(() => mdOfficeChannels(department), [department]);
  const [open, setOpen] = useState(false);
  const [officeLabel, setOfficeLabel] = useState<string | null>(channels[0]?.label ?? null);
  const [question, setQuestion] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A stable key for the job's permit numbers, so a fresh array each render
  // does not re-match.
  const numbersKey = [permitNumber ?? '', ...(permitNumbers ?? []).map((n) => n ?? '')].join('\u0001');
  const match = useMemo<MdPermitRow | null>(() => {
    if (!record) return null;
    for (const n of numbersKey.split('\u0001')) {
      const hit = mdPermitForNumber(record, n);
      if (hit) return hit;
    }
    return null;
  }, [record, numbersKey]);
  const filingState = useMemo(
    () => mdFilingStateFor({ permits: record?.permits ?? null, permitNumbers: numbersKey.split('\u0001'), match }),
    [record, numbersKey, match],
  );
  const routing = useMemo(() => routeQuestion({
    department,
    job: NO_NYC_FILING,
    nyc: false,
    md: {
      side,
      authorityName,
      channelLabel: officeLabel,
      filingState,
      match,
      permitsAsOf: record?.permits.asOf ?? null,
      permitsTruncated: record?.permits.truncated ?? false,
    },
  }), [department, side, authorityName, officeLabel, filingState, match, record]);

  const close = useCallback(() => setOpen(false), []);

  const draft = useCallback(async () => {
    if (!question.trim() || drafting) return;
    setDrafting(true);
    setError(null);
    const { prompt, cacheKey } = buildQuestionPrompt({
      project,
      routing,
      question,
      buildingSummary: summary,
      topic: topic ?? null,
    });
    try {
      const res = await mageAISmart(prompt, draftSchema, cacheKey);
      if (!res.success || !res.data) {
        setError(res.error ?? 'The draft did not come back. Try again, or write it yourself below.');
        return;
      }
      const d = res.data as z.infer<typeof draftSchema>;
      setSubject(d.subject);
      setBody(d.body);
    } catch {
      setError('The draft did not come back. Try again, or write it yourself below.');
    } finally {
      setDrafting(false);
    }
  }, [question, drafting, project, routing, summary, topic]);

  const openInMail = useCallback(async () => {
    const recipients = routing.toEmail ? [routing.toEmail] : [];
    try {
      if (Platform.OS !== 'web' && (await MailComposer.isAvailableAsync())) {
        await MailComposer.composeAsync({ recipients, subject, body, isHtml: false });
        return;
      }
      const url = `mailto:${recipients.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      await Linking.openURL(url);
    } catch {
      showAlert('No mail app', 'Copy the draft instead and paste it into your email.');
    }
  }, [routing.toEmail, subject, body]);

  const copy = useCallback(async () => {
    const ok = await copyToClipboard(`Subject: ${subject}\n\n${body}`);
    showAlert(ok ? 'Copied' : 'Copy failed', ok ? 'The draft is on your clipboard.' : 'Select the text and copy it by hand.');
  }, [subject, body]);

  const hasDraft = subject.trim().length > 0 || body.trim().length > 0;
  const emailLine = routing.toEmail
    ? routing.toEmail
    : 'MAGE has no email for this office. Pick it from your contacts.';

  return (
    <View style={styles.wrap}>
      <Button
        label="Draft a question"
        variant="secondary"
        size="sm"
        iconLeft={<MessageSquare size={14} color={colors.text} strokeWidth={2} />}
        onPress={() => setOpen(true)}
        testID={testID}
      />
      <Sheet
        visible={open}
        onClose={close}
        size="wide"
        title="Draft a question"
        subtitle={topic ? `About ${topic}. MAGE doesn’t send it; you do.` : 'MAGE doesn’t send it; you do.'}
        testID={testID ? `${testID}-sheet` : undefined}
        primaryAction={{
          label: 'Open in Mail',
          onPress: () => { void openInMail(); },
          disabled: !hasDraft,
          disabledReason: 'Draft the email (or type it) first.',
          testID: testID ? `${testID}-mail` : undefined,
        }}
        secondaryAction={{
          label: 'Copy',
          onPress: () => { void copy(); },
          disabled: !hasDraft,
          testID: testID ? `${testID}-copy` : undefined,
        }}
      >
        {channels.length > 1 ? (
          <>
            <Text style={styles.label}>Which office?</Text>
            <View style={styles.offices}>
              {channels.map((c) => (
                <Button
                  key={c.label}
                  label={c.label}
                  size="sm"
                  variant={c.label === routing.channel?.label ? 'primary' : 'secondary'}
                  onPress={() => setOfficeLabel(c.label)}
                  testID={testID ? `${testID}-office-${channels.indexOf(c)}` : undefined}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>What do you need to ask?</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={question}
          onChangeText={setQuestion}
          placeholder="e.g. Does the rear deck need its own permit?"
          placeholderTextColor={colors.textMuted}
          multiline
          accessibilityLabel="What do you need to ask?"
          testID={testID ? `${testID}-question` : undefined}
        />
        <Button
          label={hasDraft ? 'Draft again' : 'Draft it'}
          size="sm"
          onPress={() => { void draft(); }}
          loading={drafting}
          disabled={!question.trim()}
          testID={testID ? `${testID}-draft` : undefined}
        />
        {!question.trim() ? <Text style={styles.meta}>Type the question first.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          accessibilityLabel="Subject"
          testID={testID ? `${testID}-subject` : undefined}
        />
        <Text style={styles.label}>Body</Text>
        <TextInput
          style={[styles.input, styles.multiline, styles.body]}
          value={body}
          onChangeText={setBody}
          multiline
          accessibilityLabel="Body"
          testID={testID ? `${testID}-body` : undefined}
        />

        <View style={styles.routing}>
          <Text style={styles.routeTo} testID={testID ? `${testID}-to` : undefined}>{routing.toFallback}</Text>
          <Text style={styles.meta} testID={testID ? `${testID}-email` : undefined}>{emailLine}</Text>
          {routing.channel ? <Text style={styles.channel}>{routing.channel.label}</Text> : null}
          {routing.channel?.phone ? (
            <Text style={styles.meta} testID={testID ? `${testID}-phone` : undefined}>{routing.channel.phone}</Text>
          ) : null}
          {routing.whyThisChannel ? <Text style={styles.meta}>{routing.whyThisChannel}</Text> : null}
          {!record ? (
            <Text style={styles.meta} testID={testID ? `${testID}-not-loaded` : undefined}>
              Building record not loaded, so the job&apos;s permits were not checked. Open the job&apos;s Building record card to add it.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginTop: 8, alignItems: 'flex-start' },
    label: { ...Type.footnote, color: t.textSecondary, marginTop: 12, marginBottom: 4 },
    offices: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.xs },
    input: {
      ...Type.body,
      color: t.text,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 40,
    },
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    body: { minHeight: 160 },
    meta: { ...Type.footnote, color: t.textMuted, marginTop: 4 },
    error: { ...Type.footnote, color: t.danger, marginTop: 6 },
    routing: { ...cardSurface(t, { radius: 'md', pad: 12 }), marginTop: 16, gap: 2 },
    routeTo: { ...Type.subhead, color: t.text },
    channel: { ...Type.footnoteEmphasized, color: t.text, marginTop: 6 },
  });
