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
import { useBuildingRecord } from '@/hooks/useBuildingRecord';
import { isNycJobsite } from '@/utils/buildingRecord';
import {
  departmentFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
} from '@/utils/codeJurisdiction';
import { buildQuestionPrompt, jobFilingFor, routeQuestion } from '@/utils/departmentQuestion';
import { mageAISmart } from '@/utils/mageAI';
import { copyToClipboard } from '@/utils/clipboard';
import { showAlert } from '@/utils/alert';

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
}

export function DraftQuestionButton({ project, permitNumber, permitNumbers, topic, testID }: DraftQuestionProps) {
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
      topic={topic}
      testID={testID}
    />
  );
}

function DraftQuestionInner({
  project,
  department,
  permitNumber,
  permitNumbers,
  topic,
  testID,
}: {
  project: Project;
  department: BuildingDepartment;
  permitNumber?: string | null;
  permitNumbers?: ReadonlyArray<string | null | undefined>;
  topic?: string;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const building = useBuildingRecord(project);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A stable key for the job's permit numbers, so a fresh array each render
  // does not re-resolve the filing.
  const numbersKey = [permitNumber ?? '', ...(permitNumbers ?? []).map((n) => n ?? '')].join('\u0001');
  const job = useMemo(
    () => jobFilingFor(building.record, numbersKey.split('\u0001')),
    [building.record, numbersKey],
  );
  const nyc = useMemo(() => isNycJobsite(jobsiteAddressForProject(project)), [project]);
  const routing = useMemo(() => routeQuestion({ department, job, nyc }), [department, job, nyc]);

  const close = useCallback(() => setOpen(false), []);

  const draft = useCallback(async () => {
    if (!question.trim() || drafting) return;
    setDrafting(true);
    setError(null);
    const { prompt, cacheKey } = buildQuestionPrompt({
      project,
      routing,
      question,
      buildingSummary: building.summary,
      bin: building.record?.bin ?? null,
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
  }, [question, drafting, project, routing, building.summary, building.record, topic]);

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
  const toLine = routing.toName
    ? `To: ${routing.toName}${routing.toDetail ? ` (${routing.toDetail})` : ''}`
    : routing.toFallback;
  const emailLine = routing.toEmail
    ? routing.toEmail
    : 'MAGE has no email for them — pick them from your contacts.';

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
        subtitle={topic ? `About ${topic}. Nothing is sent from MAGE — you send it.` : 'Nothing is sent from MAGE — you send it.'}
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
          placeholder="e.g. Is a separate plumbing filing needed for the kitchen relocation?"
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
          <Text style={styles.routeTo} testID={testID ? `${testID}-to` : undefined}>{toLine}</Text>
          <Text style={styles.meta} testID={testID ? `${testID}-email` : undefined}>{emailLine}</Text>
          {routing.channel ? <Text style={styles.channel}>{routing.channel.label}</Text> : null}
          {routing.whyThisChannel ? <Text style={styles.meta}>{routing.whyThisChannel}</Text> : null}
        </View>
      </Sheet>
    </View>
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
