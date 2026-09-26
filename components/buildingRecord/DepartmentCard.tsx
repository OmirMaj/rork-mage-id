// DepartmentCard — how to reach the building department for this job.
//
// NYC FIRST, and nothing else: it renders null unless the jobsite resolves to
// a city row that carries a verified `department` block (utils/codeJurisdiction
// .ts; NYC is the only one today). The null return happens in the outer
// component, BEFORE any hook, effect or storage read, so every non-NYC surface
// (the Portland golden fixture included) renders byte-identically.
//
// Every fact is shown as nyc.gov published it on `checkedOn`, with the date.
// Fee schedules are LINKS: MAGE never computes a DOB fee.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Phone, ExternalLink } from 'lucide-react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card } from '@/components/ui';
import {
  departmentFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
} from '@/utils/codeJurisdiction';

export interface DepartmentCardProps {
  project: Project | null | undefined;
  testID?: string;
}

export function DepartmentCard({ project, testID }: DepartmentCardProps) {
  const resolved = resolveCodeJurisdiction(jobsiteAddressForProject(project));
  const department = departmentFor(resolved);
  if (!department || resolved.kind !== 'city') return null;
  return (
    <DepartmentCardBody
      department={department}
      authorityName={resolved.entry.authorityName}
      testID={testID ?? 'department-card'}
    />
  );
}

export default DepartmentCard;

/** Open a URL the department block holds. Never assembled from user input. */
function open(url: string) {
  Linking.openURL(url).catch(() => { /* nothing to do: the link stays visible */ });
}

function DepartmentCardBody({
  department: d, authorityName, testID,
}: { department: BuildingDepartment; authorityName: string; testID: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const telHref = d.phone ? `tel:${d.phone.replace(/[^\d+]/g, '')}` : null;
  const call = useCallback(() => { if (telHref) open(telHref); }, [telHref]);

  return (
    <Card testID={testID}>
      <Card.Label>BUILDING DEPARTMENT</Card.Label>
      <Card.Title>{authorityName}</Card.Title>

      <View style={s.links}>
        {d.phone ? (
          <TouchableOpacity style={s.link} onPress={call} accessibilityRole="link" accessibilityLabel={`Call ${d.phone}`} testID={`${testID}-phone`}>
            <Phone size={14} color={t.accentLabel} strokeWidth={2} />
            <Text style={s.linkText}>{d.phone}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={s.link} onPress={() => open(d.portalUrl)} accessibilityRole="link" testID={`${testID}-portal`}>
          <ExternalLink size={14} color={t.accentLabel} strokeWidth={2} />
          <Text style={s.linkText}>DOB NOW portal</Text>
        </TouchableOpacity>
        {d.statusLookupUrl ? (
          <TouchableOpacity style={s.link} onPress={() => open(d.statusLookupUrl!)} accessibilityRole="link" testID={`${testID}-status`}>
            <ExternalLink size={14} color={t.accentLabel} strokeWidth={2} />
            <Text style={s.linkText}>Look up a filing's status</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {d.hours ? <Text style={s.body}>{d.hours}</Text> : null}
      {d.afterHours ? <Text style={s.body}>{d.afterHours}</Text> : null}
      {d.applicantOfRecordNote ? <Text style={s.note}>{d.applicantOfRecordNote}</Text> : null}

      {d.feeScheduleUrls?.length ? (
        <View style={s.links}>
          {d.feeScheduleUrls.map((f) => (
            <TouchableOpacity key={f.url} style={s.link} onPress={() => open(f.url)} accessibilityRole="link" testID={`${testID}-fee`}>
              <ExternalLink size={14} color={t.accentLabel} strokeWidth={2} />
              <Text style={s.linkText}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <TouchableOpacity onPress={() => open(d.sourceUrl)} accessibilityRole="link" testID={`${testID}-source`}>
        <Card.Meta>Checked {d.checkedOn} on nyc.gov</Card.Meta>
      </TouchableOpacity>
    </Card>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  links: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Tokens.spacing.sm, marginTop: Tokens.spacing.xs },
  link: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xxs, paddingVertical: Tokens.spacing.xxs },
  linkText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  body: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xs },
  note: { ...Type.footnote, color: t.text, marginTop: Tokens.spacing.xs },
});
