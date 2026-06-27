// Leads pipeline — the screen Buildertrend doesn't have.
//
// Three things here that competitors don't do:
//   1. Voice-first lead intake.  The "+" is a mic button. Tap, speak,
//      done — same UniversalMic flow we already have, but routed to a
//      dedicated lead handler.
//   2. Fast-response timer on every "new" card. Big bold red text the
//      moment a lead has been waiting more than 1 hour.  First-response
//      time is the single biggest driver of close rate; making it
//      visible at a glance changes behavior on day one.
//   3. AI score badge per card (1-10) so the GC can prioritize without
//      reading every entry.  Computed client-side from the structured
//      fields, not a paid add-on.
//
// Layout: KPI bar at top (counts + avg response time + win rate), then
// a horizontally-scrolling row of stage columns. Each card is tappable
// to /lead-detail.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import {
  Plus, Phone, Mail, Clock, TrendingUp, Mic, ChevronRight, Upload,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_SOURCE_LABELS, type Lead, type LeadStage } from '@/types';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import ReactivationBanner from '@/components/ReactivationBanner';
import { parseLeadFromTranscript } from '@/utils/voiceFormParsers';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const STAGE_COLORS: Record<LeadStage, string> = {
  new: '#FF6A1A',
  qualified: '#1A6B3C',
  proposal: '#0D6CB1',
  won: '#16A34A',
  lost: '#9CA3AF',
};

export default function LeadsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { leads, addLead, getLeadsByStage } = useProjects();

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Group + sort once. New leads sort by oldest first (so the most
  // overdue first-response sits at the top); all others sort by
  // most-recently-updated.
  const grouped = useMemo<Record<LeadStage, Lead[]>>(() => {
    const out: Record<LeadStage, Lead[]> = { new: [], qualified: [], proposal: [], won: [], lost: [] };
    for (const l of leads) out[l.stage].push(l);
    out.new.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
    (['qualified','proposal','won','lost'] as LeadStage[]).forEach(s => {
      out[s].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
    return out;
  }, [leads]);

  // KPIs.
  const kpi = useMemo(() => {
    const total = leads.length;
    const newCount = grouped.new.length;
    const wonCount = grouped.won.length;
    const lostCount = grouped.lost.length;
    const closedCount = wonCount + lostCount;
    const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0;
    // Avg first-response time across leads that have been responded to.
    const responded = leads.filter(l => l.firstRespondedAt);
    const avgResponseHours = responded.length === 0 ? null : Math.round(
      responded.reduce((sum, l) => {
        const ms = new Date(l.firstRespondedAt!).getTime() - new Date(l.receivedAt).getTime();
        return sum + ms;
      }, 0) / responded.length / 3600000
    );
    // Outstanding = leads with no first response.
    const outstanding = leads.filter(l => !l.firstRespondedAt && l.stage === 'new').length;
    return { total, newCount, wonCount, lostCount, winRate, avgResponseHours, outstanding };
  }, [leads, grouped]);

  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    setCreating(true);
    try {
      const partial = await parseLeadFromTranscript(transcript);
      const newLead = addLead({
        name: partial.name || 'Voice-captured lead',
        phone: partial.phone || undefined,
        email: partial.email || undefined,
        address: partial.address || undefined,
        projectType: partial.projectType || undefined,
        scope: partial.scope || undefined,
        budgetMin: partial.budgetMin || undefined,
        budgetMax: partial.budgetMax || undefined,
        timeline: partial.timeline || undefined,
        source: partial.source || 'other',
        sourceOther: partial.sourceOther || undefined,
        stage: 'new',
        score: partial.score,
        scoreReason: partial.scoreReason,
        touches: [],
      });
      router.push({ pathname: '/lead-detail' as never, params: { leadId: newLead.id } as never });
    } finally {
      setCreating(false);
    }
  }, [addLead, router]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Pipeline',
          headerLargeTitle: false,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/import-pipeline' as never)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Import clients"
              testID="leads-import"
            >
              <Upload size={20} color={themeColors.accent} />
            </TouchableOpacity>
          ),
        }}
      />
      {/* Native iOS header already accounts for the safe area (notch/
          dynamic island). Manual `insets.top + 8` was double-counting
          and producing a tall blank gap above the KPI strip. */}
      <View style={[styles.root, { paddingTop: 8 }]}>
        {/* KPI bar */}
        <View style={styles.kpiBar}>
          <View style={styles.kpiBlock}>
            <Text style={styles.kpiNum}>{kpi.total}</Text>
            <Text style={styles.kpiLabel}>Open leads</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiBlock}>
            <Text style={[styles.kpiNum, kpi.outstanding > 0 && styles.kpiNumWarn]}>{kpi.outstanding}</Text>
            <Text style={styles.kpiLabel}>Awaiting reply</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiBlock}>
            <Text style={styles.kpiNum}>{kpi.avgResponseHours == null ? '—' : `${kpi.avgResponseHours}h`}</Text>
            <Text style={styles.kpiLabel}>Avg first reply</Text>
          </View>
          <View style={styles.kpiDivider} />
          <View style={styles.kpiBlock}>
            <Text style={styles.kpiNum}>{kpi.winRate}%</Text>
            <Text style={styles.kpiLabel}>Win rate</Text>
          </View>
        </View>

        {leads.length === 0 && (
          <View style={styles.emptyBanner}>
            <MageAIMark size={20} color={themeColors.accent} />
            <Text style={styles.emptyBannerTitle}>No leads in the pipeline yet</Text>
            <Text style={styles.emptyBannerBody}>
              Capture every inbound — homeowner calls, web inquiries, referrals — so they don't slip past the first 24 hours. Tap the mic at the bottom to dictate a lead, or Add by hand to type one in. Leads land in the New column and move through Qualified → Proposal → Won as you work them.
            </Text>
            <TouchableOpacity
              style={styles.emptyImportBtn}
              onPress={() => router.push('/import-pipeline' as never)}
              activeOpacity={0.85}
              testID="leads-empty-import"
            >
              <Upload size={15} color="#FFF" />
              <Text style={styles.emptyImportBtnText}>Import your existing clients</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reactivation nudge — surfaces clients who've gone quiet so the
            relationship (and platform) stays warm. Self-hides when none. */}
        <ReactivationBanner />

        {/* Pipeline columns */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.columnsRow}
        >
          {LEAD_STAGES.map((stage) => (
            <View key={stage} style={styles.column}>
              <View style={styles.columnHead}>
                <View style={[styles.stageDot, { backgroundColor: STAGE_COLORS[stage] }]} />
                <Text style={styles.columnTitle}>{LEAD_STAGE_LABELS[stage]}</Text>
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{grouped[stage].length}</Text>
                </View>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.cardsCol}>
                {grouped[stage].length === 0 ? (
                  <Text style={styles.emptyColumn}>—</Text>
                ) : (
                  grouped[stage].map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      onPress={() => router.push({ pathname: '/lead-detail' as never, params: { leadId: l.id } as never })}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          ))}
        </ScrollView>

        {/* Floating voice + manual add */}
        <View style={[styles.fabRow, { bottom: insets.bottom + 18 }]}>
          <TouchableOpacity
            style={styles.fabSecondary}
            onPress={() => router.push({ pathname: '/lead-detail' as never, params: { mode: 'new' } as never })}
            activeOpacity={0.85}
          >
            <Plus size={18} color={themeColors.text} />
            <Text style={styles.fabSecondaryText}>Add by hand</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fabPrimary}
            onPress={() => setVoiceOpen(true)}
            disabled={creating}
            activeOpacity={0.85}
          >
            <Mic size={18} color="#FFF" />
            <Text style={styles.fabPrimaryText}>{creating ? 'Adding…' : 'New lead by voice'}</Text>
            <MageAIMark size={12} color="#FFF" />
          </TouchableOpacity>
        </View>

        <VoiceCaptureModal
          visible={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onTranscriptReady={handleVoiceTranscript}
          title="Capture a lead"
          contextLine="speak it the way the homeowner described it"
          suggestions={[
            'John Smith, 555 1234, kitchen remodel, found us on Houzz, eighty thousand budget, wants to start in spring',
            'Jane Garcia, jane at email dot com, full bathroom renovation, referral from Bob, twenty-five thousand',
            'Patel family, 312-555-0199, two-story addition, our website, two hundred thousand, no rush',
            'Mike Doe, walk-in this morning, ADU in the back yard, ballpark one fifty',
          ]}
        />
      </View>
    </>
  );
}

function LeadCard({ lead, onPress }: { lead: Lead; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const waiting = lead.stage === 'new' && !lead.firstRespondedAt;
  const ageMs = Date.now() - new Date(lead.receivedAt).getTime();
  const ageHours = Math.floor(ageMs / 3600000);
  const overdue = waiting && ageHours >= 1;

  const budget = lead.budgetMax || lead.budgetMin
    ? formatMoney(lead.budgetMax ?? lead.budgetMin ?? 0)
    : null;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={onPress}>
      <View style={styles.cardHead}>
        <Text style={styles.cardName} numberOfLines={1}>{lead.name}</Text>
        {lead.score != null && (
          <View style={[styles.scoreBadge, lead.score >= 8 && styles.scoreBadgeHot]}>
            <MageAIMark size={10} color={lead.score >= 8 ? '#FFF' : themeColors.accent} />
            <Text style={[styles.scoreBadgeText, lead.score >= 8 && styles.scoreBadgeTextHot]}>{lead.score}</Text>
          </View>
        )}
      </View>
      {!!lead.projectType && <Text style={styles.cardLine} numberOfLines={1}>{lead.projectType}</Text>}
      <View style={styles.cardMeta}>
        {!!lead.source && <Text style={styles.cardMetaText} numberOfLines={1}>{LEAD_SOURCE_LABELS[lead.source]}</Text>}
        {!!budget && <Text style={styles.cardMetaText}>{budget}</Text>}
      </View>
      {waiting && (
        <View style={[styles.waitingPill, overdue && styles.waitingPillOverdue]}>
          <Clock size={11} color={overdue ? '#FFF' : Colors.warning} />
          <Text style={[styles.waitingText, overdue && styles.waitingTextOverdue]}>
            {ageHours < 1 ? 'just now' : `waiting ${ageHours}h`}
          </Text>
        </View>
      )}
      {!!lead.phone && (
        <View style={styles.cardContactRow}>
          <Phone size={11} color={themeColors.textMuted} />
          <Text style={styles.cardContactText} numberOfLines={1}>{lead.phone}</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  kpiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: t.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
    marginHorizontal: 12,
    borderRadius: Tokens.radius.lg,
    marginTop: 8,
  },
  kpiBlock: { flex: 1, alignItems: 'center' },
  kpiNum: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text },
  kpiNumWarn: { color: Colors.warning },
  kpiLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, fontWeight: '500' as const },
  kpiDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: t.line },
  columnsRow: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 100, gap: 12 },
  column: {
    width: 280,
    flexDirection: 'column',
  },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  stageDot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: 0.5, textTransform: 'uppercase' },
  countPill: {
    backgroundColor: t.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Tokens.radius.md,
    minWidth: 24,
    alignItems: 'center',
  },
  countPillText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textMuted },
  cardsCol: { gap: 8, paddingBottom: 12 },
  emptyColumn: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', paddingTop: 16 },
  emptyBanner: {
    margin: 16,
    padding: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    gap: 6,
    alignItems: 'flex-start' as const,
  },
  emptyBannerTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  emptyBannerBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  emptyImportBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7,
    backgroundColor: t.accent, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: Tokens.radius.md, marginTop: 10, alignSelf: 'flex-start' as const,
  },
  emptyImportBtnText: { color: '#FFF', fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: t.line,
    gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.accent + '15',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
  },
  scoreBadgeHot: { backgroundColor: t.accent },
  scoreBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent },
  scoreBadgeTextHot: { color: '#FFF' },
  cardLine: { fontSize: Type.footnote.fontSize, color: t.text },
  cardMeta: { flexDirection: 'row', gap: 10 },
  cardMetaText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Colors.warning + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.sm,
    marginTop: 2,
  },
  waitingPillOverdue: { backgroundColor: t.danger },
  waitingText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: Colors.warning },
  waitingTextOverdue: { color: '#FFF' },
  cardContactRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardContactText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  fabRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  fabPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  fabPrimaryText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  fabSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.surface,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
  },
  fabSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
});
