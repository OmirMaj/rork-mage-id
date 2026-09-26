// InspectionReadyCard — "Get ready for Rough electrical · in 2 days". One row
// per inspection this job has in the next PREP_WINDOW_DAYS days; a tap opens
// the Inspection Ready sheet. Mounted on the job page (app/project-detail.tsx),
// which passes the `prep` deep-link param as `openKey` ('permit:<permitId>',
// from the Home Brain Watch line) so the matching inspection opens by itself.
//
// Renders NOTHING — no effect, no storage read — when there is no inspection
// in the window, which is every job on most days (and the smoke fixture).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ClipboardCheck, ChevronRight } from 'lucide-react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import { cardSurface } from '@/components/ui';
import { upcomingInspectionsFor, type UpcomingInspection } from '@/utils/inspectionPrep';
import InspectionReadySheet from '@/components/inspectionPrep/InspectionReadySheet';

function whenLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days`;
}

export default function InspectionReadyCard({ project, openKey }: { project: Project; openKey?: string | null }) {
  const { permits } = useProjects();
  const upcoming = useMemo(() => upcomingInspectionsFor(project, permits, new Date()), [project, permits]);
  // Held here (plain state, no effect) so a sheet stays open after its
  // inspection leaves the window — a saved Fail moves the permit out of it.
  const [selected, setSelected] = useState<UpcomingInspection | null>(null);
  if (upcoming.length === 0 && !selected) return null;
  return (
    <InspectionReadyList
      project={project}
      upcoming={upcoming}
      openKey={openKey ?? null}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

function InspectionReadyList({
  project, upcoming, openKey, selected, onSelect,
}: {
  project: Project;
  upcoming: UpcomingInspection[];
  openKey: string | null;
  selected: UpcomingInspection | null;
  onSelect: (u: UpcomingInspection | null) => void;
}) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);

  // The deep link opens its inspection ONCE per key — closing the sheet must
  // not reopen it on the next render.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!openKey || openedFor.current === openKey) return;
    const match = upcoming.find((u) => u.key === openKey || u.key.startsWith(`${openKey}:`));
    if (!match) return;
    openedFor.current = openKey;
    onSelect(match);
  }, [openKey, upcoming, onSelect]);

  return (
    <View style={s.card} testID="inspection-ready-card">
      {upcoming.map((u) => (
        <TouchableOpacity
          key={u.key}
          style={s.row}
          onPress={() => onSelect(u)}
          accessibilityRole="button"
          accessibilityLabel={`Get ready for ${u.name}, ${whenLabel(u.daysUntil)}`}
          testID={`inspection-ready-row-${u.key}`}
          activeOpacity={0.7}
        >
          <View style={s.icon}>
            <ClipboardCheck size={16} color={t.accentLabel} strokeWidth={1.75} />
          </View>
          <View style={s.body}>
            <Text style={s.rowHeading} numberOfLines={2}>{`Get ready for ${u.name}`}</Text>
            <Text style={s.rowMeta} numberOfLines={2}>
              {`${whenLabel(u.daysUntil)} · ${u.authority ?? 'issuing authority not set'}`}
            </Text>
          </View>
          <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      ))}
      {selected ? (
        <InspectionReadySheet
          inspection={selected}
          project={project}
          visible
          onClose={() => onSelect(null)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    ...cardSurface(t, { radius: 'lg', pad: 'none' }),
    marginBottom: Tokens.spacing.md,
    overflow: 'hidden' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  icon: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    backgroundColor: t.neutralSoft,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  rowHeading: { ...Type.bodyCompactEmphasized, color: t.text },
  rowMeta: { ...Type.caption1, color: t.textSecondary },
});
