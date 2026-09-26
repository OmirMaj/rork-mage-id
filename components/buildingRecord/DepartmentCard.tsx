// DepartmentCard — how to reach the building department for this job.
//
// TWO PATHS, decided in the outer component BEFORE any hook:
//   1. A city row that carries a verified `department` block
//      (utils/codeJurisdiction.ts; NYC is the only one today) renders that
//      block exactly as before.
//   2. Otherwise, a NY / NJ / CT jobsite (placeQueryForProject() is non-null)
//      asks the place-lookup edge function which town, village or city it is
//      in, and shows permitOfficeFor()'s answer: a hand-verified NY card, the
//      NJ DCA roster or CT DAS list entry, or a NAME-ONLY card that says MAGE
//      hasn't verified the contact details. A Census answer in one of the five
//      NYC counties shows the NYC card. The lookup and its cache live in
//      utils/placeLookup.ts; this file only renders.
// Every other job (the Portland golden fixture included) returns null before
// any hook, effect or storage read, so it renders byte-identically.
//
// Every fact is shown with where it came from and when. Fee schedules are
// LINKS: MAGE never computes a fee.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Phone, ExternalLink, Mail } from 'lucide-react-native';
import type { Project } from '@/types';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Badge, Card } from '@/components/ui';
import {
  departmentFor,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
  type BuildingDepartment,
} from '@/utils/codeJurisdiction';
import {
  NAME_ONLY_BADGE,
  permitOfficeFor,
  placeQueryForProject,
  telUrlFor,
  type PermitOffice,
  type PlaceQuery,
} from '@/utils/permitOffices';
import { usePlaceLookup } from '@/utils/placeLookup';

export interface DepartmentCardProps {
  project: Project | null | undefined;
  testID?: string;
}

export function DepartmentCard({ project, testID }: DepartmentCardProps) {
  const resolved = resolveCodeJurisdiction(jobsiteAddressForProject(project));
  const department = departmentFor(resolved);
  if (!department) {
    const query = placeQueryForProject(project);
    if (query) return <PermitOfficeLookup query={query} testID={testID ?? 'department-card'} />;
  }
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

/** Open a URL a department block or an office card holds. Never assembled
 *  from user input. */
function open(url: string) {
  Linking.openURL(url).catch(() => { /* nothing to do: the link stays visible */ });
}

function DepartmentCardBody({
  department: d, authorityName, testID, headline,
}: { department: BuildingDepartment; authorityName: string; testID: string; headline?: string | null }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const telHref = d.phone ? `tel:${d.phone.replace(/[^\d+]/g, '')}` : null;
  const call = useCallback(() => { if (telHref) open(telHref); }, [telHref]);

  return (
    <Card testID={testID}>
      <Card.Label>BUILDING DEPARTMENT</Card.Label>
      {headline ? <Text style={s.note} testID={`${testID}-headline`}>{headline}</Text> : null}
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

// ─────────────────────────────────────────────────────────────────────
// NY / NJ / CT outside the city rows
// ─────────────────────────────────────────────────────────────────────

/** The NYC block, for a Census answer in one of the five NYC counties whose
 *  typed address didn't reach the NYC row. */
const NYC_RESOLVED = resolveCodeJurisdiction({ city: 'New York', state: 'NY' });
const NYC_DEPARTMENT = departmentFor(NYC_RESOLVED);

function PermitOfficeLookup({ query, testID }: { query: PlaceQuery; testID: string }) {
  const s = useThemedStyles(makeStyles);
  const lookup = usePlaceLookup(query);

  if (lookup.status === 'idle' || lookup.status === 'loading') {
    return (
      <Card testID={`${testID}-loading`}>
        <Card.Label>BUILDING DEPARTMENT</Card.Label>
        <Text style={s.body}>Finding which town, village or city issues permits here…</Text>
      </Card>
    );
  }
  if (lookup.status === 'error') {
    return (
      <Card testID={`${testID}-error`}>
        <Card.Label>BUILDING DEPARTMENT</Card.Label>
        <Text style={s.body}>Couldn&apos;t reach the Census geocoder, so MAGE didn&apos;t look up the permit office. It will try again next time.</Text>
      </Card>
    );
  }

  const answer = permitOfficeFor(lookup.place, { state: query.state, postalCity: query.postalCity });
  if (answer.kind === 'unsupported') return null;
  if (answer.kind === 'nyc') {
    if (!NYC_DEPARTMENT || NYC_RESOLVED.kind !== 'city') return null;
    return <DepartmentCardBody department={NYC_DEPARTMENT} authorityName={NYC_RESOLVED.entry.authorityName} testID={testID} headline={answer.headline} />;
  }
  if (answer.kind === 'unresolved' || !answer.office) {
    return (
      <Card testID={`${testID}-unresolved`}>
        <Card.Label>BUILDING DEPARTMENT</Card.Label>
        {answer.headline ? <Text style={s.note} testID={`${testID}-headline`}>{answer.headline}</Text> : null}
        <Card.Meta>From US Census geography</Card.Meta>
      </Card>
    );
  }
  return <PermitOfficeBody office={answer.office} headline={answer.headline} cautions={answer.cautions} testID={testID} />;
}

function PermitOfficeBody({
  office: o, headline, cautions, testID,
}: { office: PermitOffice; headline: string | null; cautions: readonly string[]; testID: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const telHref = telUrlFor(o.phone);
  const call = useCallback(() => { if (telHref) open(telHref); }, [telHref]);
  const hasLinks = !!(o.phone || o.portalUrl || o.email);

  return (
    <Card testID={testID}>
      <Card.Label>BUILDING DEPARTMENT</Card.Label>
      {headline ? <Text style={s.note} testID={`${testID}-headline`}>{headline}</Text> : null}
      <Card.Title>{o.title}</Card.Title>
      {o.subtitle ? <Text style={s.body}>{o.subtitle}</Text> : null}
      {o.verification === 'name-only' ? (
        <View style={s.badgeRow} testID={`${testID}-unverified`}>
          <Badge tone="warn">{NAME_ONLY_BADGE}</Badge>
        </View>
      ) : null}

      {o.address.length ? <Text style={s.body} testID={`${testID}-address`}>{o.address.join('\n')}</Text> : null}

      {hasLinks ? (
        <View style={s.links}>
          {o.phone ? (
            telHref ? (
              <TouchableOpacity style={s.link} onPress={call} accessibilityRole="link" accessibilityLabel={`Call ${o.phone}`} testID={`${testID}-phone`}>
                <Phone size={14} color={t.accentLabel} strokeWidth={2} />
                <Text style={s.linkText}>{o.phone}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.body} testID={`${testID}-phone`}>{o.phone}</Text>
            )
          ) : null}
          {o.portalUrl ? (
            <TouchableOpacity style={s.link} onPress={() => open(o.portalUrl!)} accessibilityRole="link" testID={`${testID}-portal`}>
              <ExternalLink size={14} color={t.accentLabel} strokeWidth={2} />
              <Text style={s.linkText}>Permit portal</Text>
            </TouchableOpacity>
          ) : null}
          {o.email ? (
            <TouchableOpacity style={s.link} onPress={() => open(`mailto:${o.email}`)} accessibilityRole="link" testID={`${testID}-email`}>
              <Mail size={14} color={t.accentLabel} strokeWidth={2} />
              <Text style={s.linkText}>{o.email}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {o.hours ? <Text style={s.body}>{o.hours}</Text> : null}
      {o.facts.map((f) => <Text key={f} style={s.body}>{f}</Text>)}
      {cautions.map((c) => <Text key={c} style={s.note} testID={`${testID}-caution`}>{c}</Text>)}

      {o.sourceUrl ? (
        <TouchableOpacity onPress={() => open(o.sourceUrl!)} accessibilityRole="link" testID={`${testID}-source`}>
          <Card.Meta>Source: {o.sourceLabel}</Card.Meta>
        </TouchableOpacity>
      ) : (
        <Card.Meta>Source: {o.sourceLabel}</Card.Meta>
      )}
    </Card>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  links: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Tokens.spacing.sm, marginTop: Tokens.spacing.xs },
  link: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Tokens.spacing.xxs, paddingVertical: Tokens.spacing.xxs },
  linkText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  body: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xs },
  note: { ...Type.footnote, color: t.text, marginTop: Tokens.spacing.xs },
  badgeRow: { flexDirection: 'row' as const, marginTop: Tokens.spacing.xs },
});
