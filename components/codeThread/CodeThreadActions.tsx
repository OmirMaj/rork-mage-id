/**
 * CodeThreadActions — the small buttons under one bullet of a code check
 * (CONTRACT C10). "Add to Permits", "Punch item", "Ask the architect (RFI)",
 * "Schedule via Roadmap".
 *
 * HONESTY
 * - Nothing here files, sends or submits anything. A permit starts as a
 *   tracker row he updates when he actually files; an RFI opens as an UNSENT
 *   draft he sends himself; a punch item is internal.
 * - Every disabled action says why.
 * - An action that was done shows 'Added' with a link to the record, never a
 *   second copy. The guard is LOCAL state set the moment the add succeeds and
 *   BEFORE the saved check is written, so a stale `record` prop (the host has
 *   not re-read storage yet) can never let the same tap land twice.
 * - An action is recorded only after the add succeeded; a thrown add shows
 *   the error, records nothing and clears busy.
 *
 * iOS MODAL RULE: hosts render this inside an RN Modal (the result modal, the
 * saved-check sheet) and pass their onClose as onBeforeNavigate. Every
 * navigation goes through go(): close first, then push after 350 ms on iOS so
 * the push does not land under a Modal that is still dismissing.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useCoreData, useDocsData, useFieldData } from '@/contexts/ProjectContext';
import type { Project } from '@/types';
import type {
  CodeCheckRecord,
  CodeThreadActionKind,
  CodeThreadActionRecord,
  CodeThreadSection,
} from '@/utils/codeThread/types';
import {
  codeCheckRoute,
  permitDraftFromCodeItem,
  punchDraftFromCodeItem,
  rfiDraftFromCodeItem,
} from '@/utils/codeThread/actions';
import { recordCodeThreadAction } from '@/utils/codeThread/store';
import { showAlert } from '@/utils/alert';
import { generateUUID } from '@/utils/generateId';
import { todayCalendarDay } from '@/utils/calendarDate';

export interface CodeThreadActionsProps {
  record: CodeCheckRecord;
  project: Project;
  section: CodeThreadSection;
  index: number;
  text: string;
  testID?: string;
  onBeforeNavigate?: () => void;
}

/** The iOS delay between closing a Modal and pushing a route. */
export const IOS_MODAL_NAV_DELAY_MS = 350;

export const PERMIT_OWNER_ONLY_TEXT = 'Permits are managed by the project owner';
export const PERMIT_CONFIRM_TEXT =
  'Add this permit to your tracker? It starts as Applied in the tracker. Update the status and date when you actually file.';
export const ROADMAP_CAPTION =
  'Inspections are scheduled from the Project Roadmap, which dates them against your permits and lead times.';
/** Shown when the add worked but the saved check could not record it. */
export const NOT_NOTED_TEXT =
  'It was added, but this saved check could not note that on this device. The button stays marked Added until you leave this screen.';
/** The RFI path navigates straight to the draft, so it cannot promise the button state. */
export const NOT_NOTED_RFI_TEXT =
  'The RFI was added as an unsent draft, but this saved check could not note that on this device. If you come back to this check it may offer the RFI again; check your RFI list first.';

/** "Sep 26, 2026" for an ISO instant; the raw string if it does not parse. */
export function codeCheckDateLabel(iso: string | null | undefined): string {
  if (!iso) return 'an unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type DoneMap = Partial<Record<CodeThreadActionKind, CodeThreadActionRecord>>;

export function CodeThreadActions({
  record,
  project,
  section,
  index,
  text,
  testID,
  onBeforeNavigate,
}: CodeThreadActionsProps): React.ReactElement | null {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const { settings } = useCoreData();
  const { addPunchItem } = useFieldData();
  const { addPermit, addRFI } = useDocsData();

  // busy: the kind being added right now. busyRef closes the gap between two
  // taps inside one frame (before the disabled render lands).
  const [busy, setBusy] = useState<CodeThreadActionKind | null>(null);
  const busyRef = useRef(false);
  // doneRef: kinds added on this mount, set synchronously the moment the add
  // returns. A second confirm queued on web (AlertHost queues alerts) carries a
  // stale closure whose localDone is still empty; this ref is never stale.
  const doneRef = useRef<Set<CodeThreadActionKind>>(new Set());
  const [localDone, setLocalDone] = useState<DoneMap>({});

  const doneFor = useCallback(
    (kind: CodeThreadActionKind): CodeThreadActionRecord | null =>
      localDone[kind] ??
      (record.actions ?? []).find((a) => a.section === section && a.index === index && a.kind === kind) ??
      null,
    [localDone, record.actions, section, index],
  );

  // EVERY navigation goes through here: close the host Modal first, then push
  // after the iOS dismiss delay.
  const go = useCallback(
    (href: Href) => {
      onBeforeNavigate?.();
      setTimeout(() => router.push(href), Platform.OS === 'ios' ? IOS_MODAL_NAV_DELAY_MS : 0);
    },
    [onBeforeNavigate, router],
  );

  /**
   * Run one add. `create` performs the write and returns the created id; if it
   * throws, nothing is recorded. On success the local done state is set FIRST,
   * then the action is written onto the saved check.
   */
  const runAdd = useCallback(
    async (
      kind: CodeThreadActionKind,
      create: () => string,
      notSavedText: string = NOT_NOTED_TEXT,
    ): Promise<CodeThreadActionRecord | null> => {
      if (busyRef.current || doneRef.current.has(kind) || doneFor(kind)) return null;
      busyRef.current = true;
      setBusy(kind);
      try {
        const createdId = create();
        doneRef.current.add(kind);
        const action: CodeThreadActionRecord = { kind, section, index, createdId, at: new Date().toISOString() };
        setLocalDone((prev) => ({ ...prev, [kind]: action }));
        const saved = await recordCodeThreadAction(record.projectId, record.id, action);
        if (!saved) {
          showAlert('Added', notSavedText);
        }
        return action;
      } catch (e) {
        showAlert("Couldn't add it", e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [doneFor, section, index, record.projectId, record.id],
  );

  const submittedBy =
    (settings?.branding?.companyName ?? '').trim() ||
    ((user?.name ?? '').trim()) ||
    'Project Team';

  const onAddPermit = () => {
    showAlert('Add to Permits', PERMIT_CONFIRM_TEXT, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: () => {
          void runAdd('permit', () => {
            const p = addPermit(
              permitDraftFromCodeItem({
                project,
                text,
                authority: record.grounding?.authority ?? null,
                checkedOnLabel: codeCheckDateLabel(record.createdAt),
                today: todayCalendarDay(),
              }),
            );
            return p.id;
          });
        },
      },
    ]);
  };

  const onAddPunch = () => {
    void runAdd('punch', () => {
      const id = generateUUID();
      addPunchItem(
        punchDraftFromCodeItem({
          projectId: record.projectId,
          text,
          recordDateLabel: codeCheckDateLabel(record.createdAt),
          authority: record.grounding?.authority ?? null,
          nowISO: new Date().toISOString(),
          id,
        }),
      );
      return id;
    });
  };

  const onAddRfi = async () => {
    const action = await runAdd('rfi', () => {
      const r = addRFI(
        rfiDraftFromCodeItem({
          projectId: record.projectId,
          text,
          authority: record.grounding?.authority ?? null,
          codes: record.grounding?.codes ?? '',
          submittedBy,
          nowISO: new Date().toISOString(),
        }),
      );
      return r.id;
    }, NOT_NOTED_RFI_TEXT);
    // It opens as an unsent draft; he sends it.
    if (action?.createdId) go({ pathname: '/rfi', params: { projectId: record.projectId, rfiId: action.createdId } });
  };

  const hrefFor = (a: CodeThreadActionRecord): Href => {
    if (a.kind === 'permit') return { pathname: '/permits', params: { projectId: record.projectId } };
    if (a.kind === 'rfi') {
      return a.createdId
        ? { pathname: '/rfi', params: { projectId: record.projectId, rfiId: a.createdId } }
        : { pathname: '/rfi', params: { projectId: record.projectId } };
    }
    return a.createdId
      ? { pathname: '/punch-list', params: { projectId: record.projectId, itemId: a.createdId } }
      : { pathname: '/punch-list', params: { projectId: record.projectId } };
  };

  /** `what` starts with 'Added'; the Open link goes to the created record. */
  const doneLine = (a: CodeThreadActionRecord, what: string) => (
    <View key={`done-${a.kind}`} style={styles.doneRow} testID={`codethread-done-${a.kind}-${section}-${index}`}>
      <Check size={14} color={colors.successLabel} />
      <Text style={styles.doneText}>{what}</Text>
      <Button label="Open" size="sm" variant="ghost" onPress={() => go(hrefFor(a))} />
    </View>
  );

  const rootID = testID ?? `codethread-actions-${section}-${index}`;

  if (section === 'permits') {
    const done = doneFor('permit');
    const blocked = !!project.myRole && project.myRole !== 'owner';
    return (
      <View testID={rootID} style={styles.root}>
        {done ? (
          doneLine(done, 'Added to your permit tracker')
        ) : (
          <>
            <View style={styles.row}>
              <Button
                label={busy === 'permit' ? 'Adding…' : 'Add to Permits'}
                size="sm"
                variant="secondary"
                disabled={blocked || busy !== null}
                onPress={onAddPermit}
              />
            </View>
            {blocked ? <Text style={styles.caption}>{PERMIT_OWNER_ONLY_TEXT}</Text> : null}
          </>
        )}
      </View>
    );
  }

  if (section === 'inspections') {
    // No action is recorded: the Roadmap owns the dates. A direct schedule
    // write from here would mark the roadmap as already scheduled (deferred).
    return (
      <View testID={rootID} style={styles.root}>
        <View style={styles.row}>
          <Button
            label="Schedule via Roadmap"
            size="sm"
            variant="secondary"
            onPress={() => go(codeCheckRoute({ projectId: record.projectId, mode: 'roadmap' }))}
          />
        </View>
        <Text style={styles.caption}>{ROADMAP_CAPTION}</Text>
      </View>
    );
  }

  // 'violations' and 'codes': a punch item and an RFI, each with its own done state.
  const punchDone = doneFor('punch');
  const rfiDone = doneFor('rfi');
  return (
    <View testID={rootID} style={styles.root}>
      {punchDone || rfiDone ? (
        <>
          {punchDone ? doneLine(punchDone, 'Added to the punch list (internal)') : null}
          {rfiDone ? doneLine(rfiDone, 'Added as an unsent RFI draft (you send it)') : null}
        </>
      ) : null}
      {!punchDone || !rfiDone ? (
        <View style={styles.row}>
          {!punchDone ? (
            <Button
              label={busy === 'punch' ? 'Adding…' : 'Punch item'}
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onPress={onAddPunch}
            />
          ) : null}
          {!rfiDone ? (
            <Button
              label={busy === 'rfi' ? 'Adding…' : 'Ask the architect (RFI)'}
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onPress={() => { void onAddRfi(); }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { marginTop: 6, gap: 4 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    caption: { ...Type.footnote, color: t.textSecondary },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    doneText: { ...Type.footnote, color: t.successLabel, flexShrink: 1 },
  });

export default CodeThreadActions;
