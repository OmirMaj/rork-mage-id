// components/backcharge/BackchargeSection.tsx — backcharges on ONE sub on ONE
// job, in /sub-portal-setup's editor, above the sub's invoices.
//
// Lists the open ones (reason, $, photo, date) and the ones already taken off
// a bill, a total open, "New backcharge", "Void" per open item, and a notice
// the GC sends himself (the share sheet, only on his tap — MAGE sends nothing).
// Device-local: see hooks/useBackcharges.ts.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Plus, Send, Camera } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, Button } from '@/components/ui';
import { showAlert } from '@/utils/alert';
import { shareText } from '@/utils/shareText';
import { formatCalendarDay } from '@/utils/calendarDate';
import { useBackcharges } from '@/hooks/useBackcharges';
import { backchargeNotice, formatCents, openFor, sumCents, type Backcharge } from '@/utils/backcharges';
import { BackchargeSheet } from '@/components/backcharge/BackchargeSheet';
import type { Commitment, Project, Subcontractor } from '@/types';

export const BACKCHARGE_DEVICE_NOTE = 'Saved on this device until you sign out.';

export interface BackchargeSectionProps {
  project: Project;
  sub: Subcontractor;
  commitments: Commitment[];
  /** The sub's submitted invoices, to name the one a backcharge came off. */
  invoices?: readonly { id: string; invoiceNumber?: string | number }[];
}

export function BackchargeSection({ project, sub, commitments, invoices }: BackchargeSectionProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { getPhotosForProject, settings } = useProjects();
  const { list, loaded, add, voidOne } = useBackcharges();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const open = useMemo(() => openFor(list, project.id, sub.id), [list, project.id, sub.id]);
  const applied = useMemo(
    () => list.filter(b => b.status === 'applied' && b.projectId === project.id && b.subId === sub.id),
    [list, project.id, sub.id],
  );
  const photoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of getPhotosForProject(project.id)) m.set(p.id, p.uri);
    return m;
  }, [getPhotosForProject, project.id]);
  const thumbOf = (b: Backcharge) => (b.photoId ? photoById.get(b.photoId) : undefined) ?? b.photoUri ?? null;
  const openTotal = sumCents(open);

  const confirmVoid = useCallback((b: Backcharge) => {
    showAlert(
      'Void this backcharge?',
      `${b.reason} — ${formatCents(b.amountCents)}. It will not come off any bill.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Void', style: 'destructive', onPress: () => voidOne(b.id) },
      ],
    );
  }, [voidOne]);

  const draftNotice = useCallback(async () => {
    const message = backchargeNotice({
      subName: sub.contactName?.split(' ')[0] || sub.companyName,
      projectName: project.name,
      companyName: settings?.branding?.companyName ?? '',
      items: open,
    });
    const r = await shareText({ message, title: `Backcharges — ${project.name}` });
    setShareMsg(r === 'copied' ? 'Notice copied — paste it into your message.' : r === 'failed' ? 'Couldn’t open the share sheet on this device.' : null);
  }, [sub, project.name, settings, open]);

  return (
    <View style={styles.section} testID="backcharge-section">
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Backcharges</Text>
        {open.length > 0 ? (
          <Text style={styles.total} testID="backcharge-open-total">Open: {formatCents(openTotal)}</Text>
        ) : null}
      </View>
      <Text style={styles.subtitle}>
        Damage, cleanup or rework you paid for — taken off {sub.companyName}’s next bill. {BACKCHARGE_DEVICE_NOTE}
      </Text>
      <Card pad="none" radius="card">
        {!loaded ? (
          <Text style={[styles.muted, styles.pad]}>Loading backcharges…</Text>
        ) : open.length === 0 && applied.length === 0 ? (
          <Text style={[styles.muted, styles.pad]}>No backcharges on this sub for this job.</Text>
        ) : null}
        {open.map((b, i) => {
          const thumb = thumbOf(b);
          return (
            <View key={b.id} style={[styles.row, i > 0 && styles.divider]} testID={`backcharge-row-${b.id}`}>
              {thumb ? (
                <Image source={{ uri: thumb }} style={styles.thumb} accessibilityLabel="Backcharge photo" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Camera size={16} color={t.textMuted} strokeWidth={1.75} />
                </View>
              )}
              <View style={styles.rowBody}>
                <Text style={styles.reason} numberOfLines={2}>{b.reason}</Text>
                <Text style={styles.meta}>
                  {formatCalendarDay(b.createdAt.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })}
                  {b.basis === 'hours_x_rate' && b.hours != null && b.rateCents != null
                    ? ` · ${b.hours} h × ${formatCents(b.rateCents)}/h` : ''}
                  {thumb ? '' : ' · no photo'}
                </Text>
              </View>
              <View style={styles.rowEnd}>
                <Text style={styles.amount}>{formatCents(b.amountCents)}</Text>
                <TouchableOpacity
                  onPress={() => confirmVoid(b)}
                  accessibilityRole="button"
                  accessibilityLabel={`Void backcharge ${b.reason}`}
                  testID={`backcharge-void-${b.id}`}
                  style={styles.voidBtn}
                >
                  <Text style={styles.voidText}>Void</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {applied.map((b, i) => (
          <View key={b.id} style={[styles.row, (open.length > 0 || i > 0) && styles.divider]} testID={`backcharge-applied-${b.id}`}>
            <View style={styles.rowBody}>
              <Text style={[styles.reason, styles.dim]} numberOfLines={2}>{b.reason} · {formatCents(b.amountCents)}</Text>
              <Text style={styles.meta}>
                Taken off {invoiceLabel(b.appliedInvoiceId, invoices)}
                {b.appliedAt ? ` on ${formatCalendarDay(b.appliedAt.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      <View style={styles.actions}>
        <Button
          label="New backcharge"
          variant="secondary"
          size="sm"
          disabled={!loaded}
          onPress={() => setSheetOpen(true)}
          iconLeft={<Plus size={14} color={t.text} strokeWidth={1.75} />}
          testID="backcharge-new"
        />
        {open.length > 0 ? (
          <Button
            label={`Draft notice to ${sub.companyName}`}
            variant="ghost"
            size="sm"
            onPress={() => { void draftNotice(); }}
            iconLeft={<Send size={14} color={t.text} strokeWidth={1.75} />}
            testID="backcharge-notice"
          />
        ) : null}
      </View>
      {!loaded ? <Text style={styles.muted}>Loading — New backcharge opens once the list is read.</Text> : null}
      {shareMsg ? <Text style={styles.muted}>{shareMsg}</Text> : null}
      {sheetOpen ? (
        <BackchargeSheet
          visible
          project={project}
          sub={sub}
          commitments={commitments}
          onClose={() => setSheetOpen(false)}
          onSave={(b) => { add(b); setSheetOpen(false); }}
        />
      ) : null}
    </View>
  );
}

/** "invoice #12" when the invoice is on screen; never an invented number. */
function invoiceLabel(id: string | null, invoices: BackchargeSectionProps['invoices']): string {
  const inv = id ? invoices?.find(i => i.id === id) : undefined;
  return inv?.invoiceNumber != null && String(inv.invoiceNumber).length > 0 ? `invoice #${inv.invoiceNumber}` : 'an invoice';
}

export default BackchargeSection;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
  total: { ...Type.footnoteEmphasized, color: t.text },
  subtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 2, marginBottom: 12, lineHeight: 18 },
  pad: { padding: 14 },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  thumb: { width: 40, height: 40, borderRadius: Tokens.radius.sm },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  rowBody: { flex: 1, minWidth: 0 },
  reason: { ...Type.subheadEmphasized, color: t.text },
  dim: { color: t.textSecondary },
  meta: { ...Type.caption1, color: t.textMuted, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Type.subheadEmphasized, color: t.text },
  voidBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  voidText: { ...Type.footnoteEmphasized, color: t.dangerLabel },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, alignItems: 'center' },
});
