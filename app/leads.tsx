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
  Plus, Phone, Mail, Clock, TrendingUp, Mic, Sparkles, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { LEAD_STAGES, LEAD_STAGE_LABELS, LEAD_SOURCE_LABELS, type Lead, type LeadStage } from '@/types';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { parseLeadFromTranscript } from '@/utils/voiceFormParsers';
import { formatMoney } from '@/utils/formatters';

const STAGE_COLORS: Record<LeadStage, string> = {
  new: '#FF6A1A',
  qualified: '#1A6B3C',
  proposal: '#0D6CB1',
  won: '#16A34A',
  lost: '#9CA3AF',
};

export default function LeadsScreen() {
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
      <Stack.Screen options={{ title: 'Pipeline', headerLargeTitle: false }} />
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
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
            <Plus size={18} color={Colors.text} />
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
            <Sparkles size={12} color="#FFF" />
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
            'Henderson family, 312-555-0199, two-story addition, our website, two hundred thousand, no rush',
            'Mike Doe, walk-in this morning, ADU in the back yard, ballpark one fifty',
          ]}
        />
      </View>
    </>
  );
}

function LeadCard({ lead, onPress }: { lead: Lead; onPress: () => void }) {
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
            <Sparkles size={10} color={lead.score >= 8 ? '#FFF' : Colors.primary} />
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
          <Phone size={11} color={Colors.textMuted} />
          <Text style={styles.cardContactText} numberOfLines={1}>{lead.phone}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  kpiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
    marginHorizontal: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  kpiBlock: { flex: 1, alignItems: 'center' },
  kpiNum: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  kpiNumWarn: { color: Colors.warning },
  kpiLabel: { fontSize: 11, color: Colors.textMuted, marginTop: 2, fontWeight: '500' as const },
  kpiDivider: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: Colors.cardBorder },
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
  columnTitle: { flex: 1, fontSize: 14, fontWeight: '700' as const, color: Colors.text, letterSpacing: 0.5, textTransform: 'uppercase' },
  countPill: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  countPillText: { fontSize: 12, fontWeight: '700' as const, color: Colors.textMuted },
  cardsCol: { gap: 8, paddingBottom: 12 },
  emptyColumn: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingTop: 16 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  scoreBadgeHot: { backgroundColor: Colors.primary },
  scoreBadgeText: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  scoreBadgeTextHot: { color: '#FFF' },
  cardLine: { fontSize: 13, color: Colors.text },
  cardMeta: { flexDirection: 'row', gap: 10 },
  cardMetaText: { fontSize: 12, color: Colors.textMuted },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: Colors.warning + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 2,
  },
  waitingPillOverdue: { backgroundColor: Colors.error },
  waitingText: { fontSize: 11, fontWeight: '600' as const, color: Colors.warning },
  waitingTextOverdue: { color: '#FFF' },
  cardContactRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cardContactText: { fontSize: 12, color: Colors.textMuted },
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
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  fabPrimaryText: { color: '#FFF', fontSize: 14, fontWeight: '700' as const },
  fabSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  fabSecondaryText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
});
