// components/codeFlags/CodeFlagSheet.tsx — Code Flags: the sheet behind a chip.
//
// It says, in the app's own words: which kind of work this line looks like,
// why that kind of work is commonly looked at, exactly which words on the line
// triggered it, the section number where the app's checked data holds one, the
// official pages the app already keeps for New York City, Baltimore City and
// Baltimore County, and (outside those three) that the app has no local rules
// for the place. It always says that a line with no flag means nothing, that
// a flag never stops an action, and that it is not on anything the contractor sends.
//
// The same sheet is behind the one building-age row of a change order or an
// estimate (`variant="age"`): the lead and asbestos rules, once for the page.
//
// The sixty-odd sentences (useCodeFlagsCopy) are built HERE, when a sheet
// opens, never once per line. The body sits straight in Sheet's own scroll
// view: no scroll view of its own.
//
// Two actions, neither of which touches the line: open Code Check (the
// existing flow, with its own plan gate, daily limit and one-time notice), and
// hide this flag on this device.
import React, { useCallback } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ExternalLink } from 'lucide-react-native';
import { Sheet } from '@/components/ui/Sheet';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useCodeFlagsCopy } from '@/hooks/useCodeFlagsCopy';
import { showAlert } from '@/utils/alert';
import { codeCheckFromJobHref } from '@/utils/uxRoutes';
import { codeFlagFamily } from '@/utils/codeFlags/rules';
import type { CodeFlagLink, CodeFlagPlace } from '@/utils/codeFlags/place';
import type { CodeFlagHit } from '@/utils/codeFlags/match';

export interface CodeFlagSheetProps {
  visible: boolean;
  onClose: () => void;
  onHide: () => void;
  /** 'line': the chip on one line. 'age': the one building-age row of the page. */
  variant: 'line' | 'age';
  /** The line's name ('line' only). */
  lineName?: string;
  categoryName: string | null;
  projectId: string | null;
  hits: readonly CodeFlagHit[];
  place: CodeFlagPlace;
  /** True when the year built is missing and a building-age rule had words to read. */
  ageNotChecked?: boolean;
  testID?: string;
}

export default function CodeFlagSheet({ visible, onClose, onHide, variant, lineName, categoryName, projectId, hits, place, ageNotChecked, testID }: CodeFlagSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const copy = useCodeFlagsCopy();
  const router = useRouter();

  const openLink = useCallback((link: CodeFlagLink) => {
    Linking.openURL(link.url).catch(() => showAlert(link.label, copy.openLinkFailedBody));
  }, [copy]);

  const askCodeCheck = useCallback(() => {
    onClose();
    if (projectId) router.push(codeCheckFromJobHref(projectId));
    else router.push('/(tabs)/construction-ai');
  }, [onClose, projectId, router]);

  const marylandLead = (hit: CodeFlagHit) => hit.familyId === 'lead_age' && place.state === 'MD';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={variant === 'age' ? copy.ageSheetTitleLabel : copy.sheetTitleLabel}
      subtitle={variant === 'age' ? copy.ageSheetBody : lineName}
      size="form"
      primaryAction={{ label: copy.askLabel, onPress: askCodeCheck, testID: testID ? `${testID}-ask` : undefined }}
      secondaryAction={{ label: copy.hideLabel, onPress: onHide, testID: testID ? `${testID}-hide` : undefined }}
      testID={testID}
    >
      <View style={styles.body}>
        <Text style={styles.text}>{copy.introBody}</Text>

        {hits.map((hit) => {
          const family = codeFlagFamily(hit.familyId);
          return (
            <View key={hit.familyId} style={styles.block} testID={testID ? `${testID}-family-${hit.familyId}` : undefined}>
              <Text style={styles.familyName} accessibilityRole="header">{copy.familyNameLabel(hit.familyId)}</Text>

              <Text style={styles.heading} accessibilityRole="header">{copy.whyHeadingLabel}</Text>
              <Text style={styles.text}>{copy.familyWhy(hit.familyId, place.id)}</Text>
              {hit.yearBuilt != null ? <Text style={styles.text}>{copy.builtBody(hit.familyId, hit.yearBuilt)}</Text> : null}
              {marylandLead(hit) ? <Text style={styles.text}>{copy.marylandLeadBody}</Text> : null}
              {family.books.length ? <Text style={styles.muted}>{copy.booksLabel(family.books.join(', '))}</Text> : null}

              <Text style={styles.heading} accessibilityRole="header">{copy.triggerHeadingLabel}</Text>
              <Text style={styles.text} testID={testID ? `${testID}-trigger-${hit.familyId}` : undefined}>
                {variant === 'age' ? copy.docTriggerBody(hit.triggers, hit.lineCount ?? 0) : copy.triggerBody(hit.triggers, categoryName)}
              </Text>

              {hit.local.section?.asNote ? null : <Text style={styles.heading} accessibilityRole="header">{copy.sectionHeadingLabel}</Text>}
              <Text style={styles.text} testID={testID ? `${testID}-section-${hit.familyId}` : undefined}>
                {hit.local.section ? copy.sectionBody(hit.local.section.id, hit.local.section.label) : copy.noSectionBody}
              </Text>

              {hit.local.links.length ? (
                <>
                  <Text style={styles.heading} accessibilityRole="header">{copy.sourcesHeadingLabel}</Text>
                  {hit.local.links.map((link) => (
                    <TouchableOpacity
                      key={link.url}
                      style={styles.link}
                      onPress={() => openLink(link)}
                      activeOpacity={0.7}
                      accessibilityRole="link"
                      accessibilityLabel={link.label}
                    >
                      <ExternalLink size={14} color={colors.textSecondary} strokeWidth={1.75} />
                      <View style={styles.linkText}>
                        <Text style={styles.linkLabel}>{link.label}</Text>
                        <Text style={styles.muted}>{copy.checkedSub(link.checkedOn)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              ) : null}
            </View>
          );
        })}

        <Text style={styles.text} testID={testID ? `${testID}-place` : undefined}>{copy.placeBody(place, !!projectId)}</Text>
        {ageNotChecked ? <Text style={styles.text}>{copy.ageNotCheckedBody}</Text> : null}

        <View style={styles.block}>
          <Text style={styles.text} testID={testID ? `${testID}-no-flag` : undefined}>{copy.noFlagBody}</Text>
          <Text style={styles.text}>{copy.neverBlocksBody}</Text>
          <Text style={styles.text}>{copy.privateBody}</Text>
          <Text style={styles.muted}>{copy.starterBody}</Text>
          <Text style={styles.muted}>{copy.standingNoteBody}</Text>
        </View>

        <Text style={styles.muted}>{copy.askBody}</Text>
        <Text style={styles.muted}>{copy.hideBody(!!projectId)}</Text>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  body: { gap: 8, paddingBottom: 8 },
  block: { gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: t.line },
  familyName: { ...Type.subheadEmphasized, color: t.text },
  heading: { ...Type.caption2, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted, marginTop: 6 },
  text: { ...Type.footnote, color: t.textSecondary },
  muted: { ...Type.caption1, color: t.textMuted },
  link: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  linkText: { flex: 1 },
  linkLabel: { ...Type.footnoteEmphasized, color: t.text, textDecorationLine: 'underline' },
});
