// components/codeFlags/CodeFlagSheet.tsx — Code Flags: the sheet behind a chip.
//
// It says, in the app's own words: which kind of work this line looks like,
// why that kind of work is commonly looked at, exactly which words on the line
// triggered it, the section number where the app's checked data holds one, the
// official pages the app already keeps for New York City, Baltimore City and
// Baltimore County, and (outside those three) that the app has no local rules
// for the place. It always says that a line with no flag means nothing, that
// a flag never stops an action, and that only the contractor's side sees it.
//
// Two actions, neither of which touches the line: open Code Check (the
// existing flow, with its own plan gate, daily limit and one-time notice), and
// hide this flag on this device.
import React, { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ExternalLink } from 'lucide-react-native';
import { Sheet } from '@/components/ui/Sheet';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { useCodeFlagsCopy } from '@/hooks/useCodeFlagsCopy';
import { showAlert } from '@/utils/alert';
import { codeCheckFromJobHref } from '@/utils/uxRoutes';
import { codeFlagFamily } from '@/utils/codeFlags/rules';
import type { CodeFlagLink } from '@/utils/codeFlags/place';
import type { CodeFlagHit, CodeFlagLineResult } from '@/utils/codeFlags/match';

export interface CodeFlagSheetProps {
  visible: boolean;
  onClose: () => void;
  onHide: () => void;
  lineName: string;
  categoryName: string | null;
  projectId: string | null;
  result: CodeFlagLineResult;
  testID?: string;
}

export default function CodeFlagSheet({ visible, onClose, onHide, lineName, categoryName, projectId, result, testID }: CodeFlagSheetProps) {
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

  const marylandLead = (hit: CodeFlagHit) => hit.familyId === 'lead_age' && result.place.state === 'MD';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={copy.sheetTitleLabel}
      subtitle={lineName}
      size="form"
      primaryAction={{ label: copy.askLabel, onPress: askCodeCheck, testID: testID ? `${testID}-ask` : undefined }}
      secondaryAction={{ label: copy.hideLabel, onPress: onHide, testID: testID ? `${testID}-hide` : undefined }}
      testID={testID}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Text style={styles.text}>{copy.introBody}</Text>

        {result.hits.map((hit) => {
          const family = codeFlagFamily(hit.familyId);
          return (
            <View key={hit.familyId} style={styles.block} testID={testID ? `${testID}-family-${hit.familyId}` : undefined}>
              <Text style={styles.familyName}>{copy.familyNameLabel(hit.familyId)}</Text>

              <Text style={styles.heading}>{copy.whyHeadingLabel}</Text>
              <Text style={styles.text}>{copy.familyWhy(hit.familyId)}</Text>
              {hit.yearBuilt != null ? <Text style={styles.text}>{copy.builtBody(hit.familyId, hit.yearBuilt)}</Text> : null}
              {marylandLead(hit) ? <Text style={styles.text}>{copy.marylandLeadBody}</Text> : null}
              {family.books.length ? <Text style={styles.muted}>{copy.booksLabel(family.books.join(', '))}</Text> : null}

              <Text style={styles.heading}>{copy.triggerHeadingLabel}</Text>
              <Text style={styles.text} testID={testID ? `${testID}-trigger-${hit.familyId}` : undefined}>
                {copy.triggerBody(hit.triggers, categoryName)}
              </Text>

              <Text style={styles.heading}>{copy.sectionHeadingLabel}</Text>
              <Text style={styles.text} testID={testID ? `${testID}-section-${hit.familyId}` : undefined}>
                {hit.local.section ? copy.sectionBody(hit.local.section.id, hit.local.section.label) : copy.noSectionBody}
              </Text>

              {hit.local.links.length ? (
                <>
                  <Text style={styles.heading}>{copy.sourcesHeadingLabel}</Text>
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

        <Text style={styles.text} testID={testID ? `${testID}-place` : undefined}>{copy.placeBody(result.place, !!projectId)}</Text>
        {result.ageNotChecked ? <Text style={styles.text}>{copy.ageNotCheckedBody}</Text> : null}

        <View style={styles.block}>
          <Text style={styles.text} testID={testID ? `${testID}-no-flag` : undefined}>{copy.noFlagBody}</Text>
          <Text style={styles.text}>{copy.neverBlocksBody}</Text>
          <Text style={styles.text}>{copy.privateBody}</Text>
          <Text style={styles.muted}>{copy.starterBody}</Text>
          <Text style={styles.muted}>{copy.standingNoteBody}</Text>
        </View>

        <Text style={styles.muted}>{copy.askSub}</Text>
        <Text style={styles.muted}>{copy.hideSub}</Text>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  scroll: { maxHeight: 460 },
  body: { gap: 8, paddingBottom: 8 },
  block: { gap: 6, paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: t.line },
  familyName: { fontSize: 15, fontWeight: '700', color: t.text },
  heading: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: t.textMuted, marginTop: 6 },
  text: { fontSize: 13.5, lineHeight: 19, color: t.textSecondary },
  muted: { fontSize: 12, lineHeight: 17, color: t.textMuted },
  link: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  linkText: { flex: 1 },
  linkLabel: { fontSize: 13.5, color: t.text, fontWeight: '600', textDecorationLine: 'underline' },
});
