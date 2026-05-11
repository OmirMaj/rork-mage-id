// oac-actions.tsx — cross-project dock of OAC action items.
//
// PM audit's "meetings produce decisions; without follow-up they're
// theater" finding. The OAC meeting screen captures action items
// (auto-extracted from voice transcript), but once distributed they
// became orphans: no notification on due date, no surface to scan
// across projects, no obvious carry-forward into the next agenda.
//
// This screen is the GC's Monday-morning loop closer:
//   - Aggregates every open actionItem across every meeting on every
//     project owned by the GC.
//   - Sort: most-overdue first, then due-soon, then no-due-date,
//     then alphabetical by project. Matches the PM's natural triage.
//   - Filter: All open / Overdue / Due this week.
//   - Each row → tap opens the source OAC meeting; inline "Mark
//     done" button closes the action without leaving the dock.
//   - Empty state when nothing's on the loop.
//
// Data shape lives in utils/oacActionItems.ts; this screen is a thin
// view over `aggregateOpenActionItems`. Mark-done writes back to the
// owning meeting via updateOACMeeting (same path the meeting screen
// uses), so the audit trail stays coherent.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2, ChevronRight, ListChecks, Clock, AlertTriangle,
  CalendarClock, User as UserIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { aggregateOpenActionItems, type OpenActionItem } from '@/utils/oacActionItems';
import EmptyState from '@/components/ui/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { OACActionItem } from '@/types';

type FilterKey = 'all' | 'overdue' | 'this_week';

function dueLabel(daysUntilDue: number | null): { text: string; tint: string } {
  if (daysUntilDue == null) return { text: 'No due date', tint: Colors.textMuted };
  if (daysUntilDue < 0) {
    const d = Math.abs(daysUntilDue);
    return { text: `${d}d overdue`, tint: Colors.error };
  }
  if (daysUntilDue === 0) return { text: 'Due today', tint: Colors.warning };
  if (daysUntilDue === 1) return { text: 'Due tomorrow', tint: Colors.warning };
  if (daysUntilDue <= 7) return { text: `Due in ${daysUntilDue}d`, tint: Colors.info };
  return { text: `Due in ${daysUntilDue}d`, tint: Colors.textSecondary };
}

export default function OACActionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, oacMeetings, updateOACMeeting } = useProjects();
  const [filter, setFilter] = useState<FilterKey>('all');

  const openItems = useMemo<OpenActionItem[]>(
    () => aggregateOpenActionItems({ meetings: oacMeetings, projects }),
    [oacMeetings, projects],
  );

  const filtered = useMemo(() => {
    if (filter === 'overdue') {
      return openItems.filter(i => i.daysUntilDue != null && i.daysUntilDue < 0);
    }
    if (filter === 'this_week') {
      return openItems.filter(i => i.daysUntilDue != null && i.daysUntilDue >= 0 && i.daysUntilDue <= 7);
    }
    return openItems;
  }, [openItems, filter]);

  const overdueCount = useMemo(
    () => openItems.filter(i => i.daysUntilDue != null && i.daysUntilDue < 0).length,
    [openItems],
  );
  const thisWeekCount = useMemo(
    () => openItems.filter(i => i.daysUntilDue != null && i.daysUntilDue >= 0 && i.daysUntilDue <= 7).length,
    [openItems],
  );

  const handleMarkDone = useCallback((entry: OpenActionItem) => {
    Alert.alert(
      'Mark action done',
      `Close "${entry.item.description}"? You can still see it in the meeting's audit trail.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark done',
          onPress: () => {
            const now = new Date().toISOString();
            const nextItems: OACActionItem[] = entry.meeting.actionItems.map(it =>
              it.id === entry.item.id ? { ...it, status: 'done', closedAt: now } : it,
            );
            updateOACMeeting(entry.meeting.id, { actionItems: nextItems });
            if (Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
          },
        },
      ],
    );
  }, [updateOACMeeting]);

  const openMeeting = useCallback((entry: OpenActionItem) => {
    router.push({
      pathname: '/oac-meeting' as never,
      params: { projectId: entry.project.id, meetingId: entry.meeting.id } as never,
    });
  }, [router]);

  if (openItems.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'OAC Actions' }} />
        <EmptyState
          icon={<CheckCircle2 size={36} color={Colors.success} strokeWidth={1.6} />}
          title="No actions on the loop"
          message="Owner-architect-contractor meetings turn into open action items here. Run an OAC meeting and any commitments captured in the transcript will show up to chase down."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'OAC Actions',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Open action items</Text>
          <Text style={styles.headerCount}>{openItems.length}</Text>
        </View>
        <Text style={styles.headerSub}>
          Across {new Set(openItems.map(i => i.project.id)).size} project
          {new Set(openItems.map(i => i.project.id)).size === 1 ? '' : 's'}
          {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
        </Text>

        {/* Filter chips */}
        <View style={styles.chipRow}>
          {([
            { key: 'all' as const, label: `All (${openItems.length})` },
            { key: 'overdue' as const, label: `Overdue (${overdueCount})` },
            { key: 'this_week' as const, label: `This week (${thisWeekCount})` },
          ]).map(c => {
            const active = filter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => {
                  setFilter(c.key);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Filter: ${c.label}`}
                accessibilityState={{ selected: active }}
                testID={`oac-filter-${c.key}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.subEmpty}>
            <Text style={styles.subEmptyText}>
              {filter === 'overdue' ? 'Nothing overdue.' : 'Nothing due in the next 7 days.'}
            </Text>
          </View>
        ) : (
          filtered.map(entry => {
            const due = dueLabel(entry.daysUntilDue);
            const overdue = entry.daysUntilDue != null && entry.daysUntilDue < 0;
            return (
              <View key={`${entry.meeting.id}-${entry.item.id}`} style={styles.card}>
                <TouchableOpacity
                  onPress={() => openMeeting(entry)}
                  style={styles.cardBody}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.cardIconWrap,
                      { backgroundColor: (overdue ? Colors.error : Colors.primary) + '15' },
                    ]}
                  >
                    <ListChecks size={16} color={overdue ? Colors.error : Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardProject} numberOfLines={1}>
                      {entry.project.name} · Mtg #{entry.meeting.number}
                    </Text>
                    <Text style={styles.cardTitle} numberOfLines={3}>
                      {entry.item.description}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={styles.metaPill}>
                        <UserIcon size={11} color={Colors.textMuted} />
                        <Text style={styles.metaPillText} numberOfLines={1}>
                          {entry.item.ballInCourt || 'Unassigned'}
                        </Text>
                      </View>
                      <View style={styles.metaPill}>
                        <CalendarClock size={11} color={due.tint} />
                        <Text style={[styles.metaPillText, { color: due.tint }]} numberOfLines={1}>
                          {due.text}
                        </Text>
                      </View>
                      {entry.item.status === 'in_progress' ? (
                        <View style={styles.metaPill}>
                          <Clock size={11} color={Colors.info} />
                          <Text style={[styles.metaPillText, { color: Colors.info }]}>In progress</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </TouchableOpacity>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleMarkDone(entry)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Mark action item done"
                    testID={`mark-done-${entry.item.id}`}
                  >
                    <CheckCircle2 size={14} color={Colors.success} />
                    <Text style={[styles.actionBtnText, { color: Colors.success }]}>Mark done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <View style={styles.footer}>
          <AlertTriangle size={12} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Marking done here closes the item in its source meeting. To add notes, attach a file,
            or change the ball-in-court, open the meeting from the row tap.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  headerTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  headerCount: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  headerSub: {
    paddingHorizontal: 16,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: 12,
  },

  chipRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  chipTextActive: { color: Colors.background },

  subEmpty: { paddingHorizontal: 24, paddingVertical: 18 },
  subEmptyText: {
    fontSize: Type.body.fontSize,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  cardBody: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    padding: 12,
  },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cardProject: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 2,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 8,
  },
  metaPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    maxWidth: 180,
  },
  metaPillText: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },

  cardActions: {
    flexDirection: 'row' as const,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 12,
  },
  actionBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
  },

  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: 16,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});
