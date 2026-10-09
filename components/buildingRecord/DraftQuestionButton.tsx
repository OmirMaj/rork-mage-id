// components/buildingRecord/DraftQuestionButton.tsx — "Draft a question".
//
// The contractor types what he needs to ask; the model drafts a subject and
// body; he edits both and sends it HIMSELF from his mail app (or copies it).
// NOTHING IS SENT FROM HERE — no edge function, no email service. The routing
// card says who the question goes to (NYC: the applicant of record on the
// filing, from DOB's public dataset) and why that channel, in the verified
// department row's own words. MAGE has no email for an applicant of record,
// and says so rather than inventing one.
//
// Renders null unless the job's building department is a verified row
// (departmentFor — NYC today), decided BEFORE any hook or effect runs.
//
// A Maryland job goes to MdDraftQuestion FIRST (Baltimore City / Baltimore
// County, same "sends nothing" rules). That branch sits above the NYC
// decision because a job whose address is only "Baltimore, MD" has no
// department until the Census place lookup answers. Both are early returns
// before any hook, so hook order never changes.
//
// Code cards (lane CCWIRE, 2026-10-03): any OTHER New York, New Jersey or
// Connecticut job with an address (askTownKind === 'town') goes to
// TownDraftQuestion: the place lookup names the town, village or city, and
// permitOfficeFor() gives its office row (hand-verified, the NJ DCA roster,
// the CT DAS list, or a name-only card). Same rules: MAGE sends nothing, no
// person is named, an email only when the row carries one. A Census answer in
// one of the five NYC counties routes to the NYC card's inner component.
// A code card's "Ask town" opens the same sheet without its own button
// (`open` / `onOpenChange` / `hideTrigger`) with its question pre-filled
// (`initialQuestion`); Maryland keeps its own button (askTownBlockedReason).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useBuildingRecord } from '@/hooks/useBuildingRecord';
import { isMdJobsite, isNycJobsite } from '@/utils/buildingRecord';
import {
  departmentFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
} from '@/utils/codeJurisdiction';
import {
  askTownKind, buildQuestionPrompt, jobFilingFor, routeOfficeQuestion, routeQuestion, type QuestionRouting,
} from '@/utils/departmentQuestion';
import type { BuildingRecordSummary } from '@/utils/buildingRecord';
import { permitOfficeFor, placeQueryForProject, type PermitOffice, type PlaceQuery } from '@/utils/permitOffices';
import { usePlaceLookup } from '@/utils/placeLookup';
import { mageAISmart } from '@/utils/mageAI';
import { copyToClipboard } from '@/utils/clipboard';
import { showAlert } from '@/utils/alert';
import { MdDraftQuestion } from './MdDraftQuestion';

const draftSchema = z.object({
  subject: z.string().catch('').default(''),
  body: z.string().catch('').default(''),
});

interface DraftQuestionProps {
  project: Project | null | undefined;
  permitNumber?: string | null;
  /** The job's own permit numbers (e.g. its tracked permits). An applicant is
   *  named only when a DOB filing matches one of these or `permitNumber`. */
  permitNumbers?: ReadonlyArray<string | null | undefined>;
  topic?: string;
  testID?: string;
  /** Controlled open (a code card's "Ask town"). Omitted: the button opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the "Draft a question" button (the caller opens the sheet itself). */
  hideTrigger?: boolean;
  /** The question box's starting text, in MAGE's words. He edits it. */
  initialQuestion?: string;
}

/** The props every inner variant passes through to the composer. */
type ComposerControl = Pick<DraftQuestionProps, 'topic' | 'testID' | 'open' | 'onOpenChange' | 'hideTrigger' | 'initialQuestion'>;

export function DraftQuestionButton({
  project, permitNumber, permitNumbers, topic, testID, open, onOpenChange, hideTrigger, initialQuestion,
}: DraftQuestionProps) {
  const control: ComposerControl = { topic, testID, open, onOpenChange, hideTrigger, initialQuestion };
  // Maryland first: a plain "Baltimore, MD" job has no department until the
  // place lookup answers, so the NYC decision below would drop it.
  if (project && isMdJobsite(jobsiteAddressForProject(project))) {
    return (
      <MdDraftQuestion
        project={project}
        permitNumber={permitNumber}
        permitNumbers={permitNumbers}
        topic={topic}
        testID={testID}
      />
    );
  }
  // Any other NY / NJ / CT job with an address: its town's office (pure
  // decision, no hook here).
  if (project && askTownKind(project) === 'town') {
    const query = placeQueryForProject(project);
    if (query) return <TownDraftQuestion project={project} query={query} permitNumber={permitNumber} permitNumbers={permitNumbers} control={control} />;
  }
  // Pure, and decided before any hook below it can run: a job with no
  // verified building department renders nothing at all.
  const department = departmentFor(resolveCodeJurisdiction(jobsiteAddressForProject(project)));
  if (!department || !project) return null;
  return (
    <DraftQuestionInner
      project={project}
      department={department}
      permitNumber={permitNumber}
      permitNumbers={permitNumbers}
      {...control}
    />
  );
}

function DraftQuestionInner({
  project,
  department,
  permitNumber,
  permitNumbers,
  ...control
}: {
  project: Project;
  department: BuildingDepartment;
  permitNumber?: string | null;
  permitNumbers?: ReadonlyArray<string | null | undefined>;
} & ComposerControl) {
  const building = useBuildingRecord(project);

  // A stable key for the job's permit numbers, so a fresh array each render
  // does not re-resolve the filing.
  const numbersKey = [permitNumber ?? '', ...(permitNumbers ?? []).map((n) => n ?? '')].join('\u0001');
  const job = useMemo(
    () => jobFilingFor(building.record, numbersKey.split('\u0001')),
    [building.record, numbersKey],
  );
  const nyc = useMemo(() => isNycJobsite(jobsiteAddressForProject(project)), [project]);
  const routing = useMemo(() => routeQuestion({ department, job, nyc }), [department, job, nyc]);
  return (
    <DraftComposer
      project={project}
      routing={routing}
      buildingSummary={building.summary}
      bin={building.record?.bin ?? null}
      {...control}
    />
  );
}

/**
 * The sheet itself: what he wants to ask, the drafted subject and body (both
 * editable), the routing card, and Open in Mail / Copy. Shared by the NYC and
 * town variants; the routing decides who it is addressed to. Sends nothing.
 */
function DraftComposer({
  project,
  routing,
  buildingSummary,
  bin,
  phone = null,
  topic,
  testID,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  initialQuestion,
}: {
  project: Project;
  routing: QuestionRouting;
  buildingSummary: BuildingRecordSummary | null | undefined;
  bin: string | null;
  /** The office's listed phone (town rows), shown as text, never dialled from here. */
  phone?: string | null;
} & ComposerControl) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : openState;
  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A card that opens the sheet with a new question replaces the old one.
  useEffect(() => {
    if (open && initialQuestion) setQuestion(initialQuestion);
  }, [open, initialQuestion]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const draft = useCallback(async () => {
    if (!question.trim() || drafting) return;
    setDrafting(true);
    setError(null);
    const { prompt, cacheKey } = buildQuestionPrompt({
      project,
      routing,
      question,
      buildingSummary,
      bin,
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
  }, [question, drafting, project, routing, buildingSummary, bin, topic]);

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
      showAlert('No Mail App', 'Copy the draft instead and paste it into your email.');
    }
  }, [routing.toEmail, subject, body]);

  const copy = useCallback(async () => {
    const ok = await copyToClipboard(`Subject: ${subject}\n\n${body}`);
    showAlert(ok ? 'Copied' : 'Copy Failed', ok ? 'The draft is on your clipboard.' : 'Select the text and copy it by hand.');
  }, [subject, body]);

  const hasDraft = subject.trim().length > 0 || body.trim().length > 0;
  const toLine = routing.toName
    ? `To: ${routing.toName}${routing.toDetail ? ` (${routing.toDetail})` : ''}`
    : routing.toFallback;
  const emailLine = routing.toEmail
    ? routing.toEmail
    : 'MAGE has no email for them. Pick them from your contacts.';

  return (
    <View style={hideTrigger ? undefined : styles.wrap}>
      {hideTrigger ? null : (
        <Button
          label="Draft a Question"
          variant="secondary"
          size="sm"
          iconLeft={<MessageSquare size={14} color={colors.text} strokeWidth={2} />}
          onPress={() => setOpen(true)}
          testID={testID}
        />
      )}
      <Sheet
        visible={open}
        onClose={close}
        size="wide"
        title="Draft a Question"
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
        <Text style={styles.label}>What do you need to ask?</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={question}
          onChangeText={setQuestion}
          placeholder="Is a separate plumbing filing needed for the kitchen relocation?"
          placeholderTextColor={colors.textMuted}
          multiline
          accessibilityLabel="What do you need to ask?"
          testID={testID ? `${testID}-question` : undefined}
        />
        <Button
          label={hasDraft ? 'Draft Again' : 'Draft It'}
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
          <Text style={styles.routeTo} testID={testID ? `${testID}-to` : undefined}>{toLine}</Text>
          <Text style={styles.meta} testID={testID ? `${testID}-email` : undefined}>{emailLine}</Text>
          {phone ? <Text style={styles.meta} testID={testID ? `${testID}-phone` : undefined}>{`Phone (from the office list): ${phone}`}</Text> : null}
          {routing.channel ? <Text style={styles.channel}>{routing.channel.label}</Text> : null}
          {routing.whyThisChannel ? <Text style={styles.meta}>{routing.whyThisChannel}</Text> : null}
        </View>
      </Sheet>
    </View>
  );
}

/** The NYC card's department, for a Census answer in one of the five NYC
 *  counties whose typed address missed the NYC row (DepartmentCard does the same). */
const NYC_DEPARTMENT = departmentFor(resolveCodeJurisdiction({ city: 'New York', state: 'NY' }));

/** A NY / NJ / CT town job: the place lookup names the office, then the
 *  composer drafts to it. Renders nothing while the lookup runs or when it
 *  names no office (the job then has no office MAGE can route to). */
function TownDraftQuestion({
  project, query, permitNumber, permitNumbers, control,
}: {
  project: Project;
  query: PlaceQuery;
  permitNumber?: string | null;
  permitNumbers?: ReadonlyArray<string | null | undefined>;
  control: ComposerControl;
}) {
  const lookup = usePlaceLookup(query);
  const answer = lookup.status === 'done' ? permitOfficeFor(lookup.place, { state: query.state, postalCity: query.postalCity }) : null;
  const routable = !!answer && ((answer.kind === 'nyc' && !!NYC_DEPARTMENT) || (answer.kind === 'office' && !!answer.office));
  // Opened from a code card with no button of its own: when the lookup
  // cannot name an office, say why instead of opening nothing.
  const failed = lookup.status === 'error' || (lookup.status === 'done' && !routable);
  const { open, onOpenChange } = control;
  useEffect(() => {
    if (!failed || !open) return;
    showAlert(
      'Town Not Found',
      lookup.status === 'error'
        ? "Couldn't reach the Census geocoder, so MAGE couldn't tell which town issues permits here. Try again in a moment."
        : (answer?.headline ?? "MAGE couldn't tell which town issues permits at this address. Check the project's address, then try again."),
    );
    onOpenChange?.(false);
  }, [failed, open, onOpenChange, lookup.status, answer?.headline]);
  if (!answer) return null;
  if (answer.kind === 'nyc' && NYC_DEPARTMENT) {
    return (
      <DraftQuestionInner
        project={project}
        department={NYC_DEPARTMENT}
        permitNumber={permitNumber}
        permitNumbers={permitNumbers}
        {...control}
      />
    );
  }
  if (answer.kind !== 'office' || !answer.office) return null;
  return <TownOfficeDraft project={project} office={answer.office} {...control} />;
}

function TownOfficeDraft({ project, office, ...control }: { project: Project; office: PermitOffice } & ComposerControl) {
  const routing = useMemo(() => routeOfficeQuestion(office), [office]);
  return (
    <DraftComposer
      project={project}
      routing={routing}
      buildingSummary={null}
      bin={null}
      phone={office.phone}
      {...control}
    />
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { marginTop: 8, alignItems: 'flex-start' },
    label: { ...Type.footnote, color: t.textSecondary, marginTop: 12, marginBottom: 4 },
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

export default DraftQuestionButton;
