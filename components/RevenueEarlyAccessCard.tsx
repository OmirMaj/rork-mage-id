// components/RevenueEarlyAccessCard.tsx
//
// Inline value-prop card for revenue products that are architecturally
// committed but not yet partner-signed. Three current callers (May 2026):
//
//   - "Offer financing to your client" on the estimate/invoice screen
//      → routes to Wisetack-style consumer financing once the partner
//      LOI lands. Today: captures GC interest.
//   - "Same-day payout on this pay app" on AIA pay-app + invoice
//      → routes to altLINE / eCapital factoring once the partner LOI
//      lands. Today: captures GC interest.
//   - "Compare renewal quotes from 3 brokers" on the COI watcher
//      → routes to Coterie / Next Insurance API once the broker
//      partner is in place. Today: captures GC interest.
//
// Why ship the CTA before the partner: every tap proves demand, and the
// resulting feature_interest row count is exactly the slide we walk into
// the partner pitch with ("we have 312 GCs waiting for this — give us
// rev-share"). The strategy doc calls this out: capture intent in the
// surface area now, monetize it once the partner is live.
//
// The same table/component pattern powers the schedule "Coming soon"
// tabs; see TabComingSoon.tsx for the original pattern.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CheckCircle2, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { supabase } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export interface RevenueEarlyAccessCardProps {
  /**
   * Stable key written to feature_interest.event_key. Used to dedupe and
   * to count opt-ins per product. Use one of the canonical keys below.
   */
  eventKey:
    | 'revenue.financing.wisetack'
    | 'revenue.factoring.altline'
    | 'revenue.insurance.coi_requote'
    | 'revenue.lien_waiver.escrow'
    | 'revenue.sub_bid_network'
    | 'revenue.inter_gc_referral'
    | 'revenue.sub_mass_payout'
    | 'revenue.equipment_financing';
  /** Icon to lead the card. Pass a Lucide icon component. */
  icon: LucideIcon;
  /** Bold value prop (e.g. "Offer monthly payments to your client"). */
  headline: string;
  /** Single sub-line. Keep it specific: numbers > adjectives. */
  body: string;
  /** Optional muted footer label (e.g. "In early access · ships Q3 2026"). */
  footer?: string;
  /** Optional testID for automation. */
  testID?: string;
}

export function RevenueEarlyAccessCard(props: RevenueEarlyAccessCardProps) {
  const { eventKey, icon: Icon, headline, body, footer, testID } = props;
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [state, setState] = useState<'idle' | 'checking' | 'saving' | 'done' | 'error'>(
    'checking',
  );

  // On mount, check if this user already opted in — keeps the button
  // honest across screens. We dedupe in the DB via the (user_id, event_key)
  // unique index, but the visual state should match without needing the
  // server round-trip on every render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setState('idle');
          return;
        }
        const { data, error } = await supabase
          .from('feature_interest')
          .select('id')
          .eq('user_id', user.id)
          .eq('event_key', eventKey)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setState('idle');
        } else {
          setState(data ? 'done' : 'idle');
        }
      } catch {
        if (!cancelled) setState('idle');
      }
    })();
    return () => { cancelled = true; };
  }, [eventKey]);

  const onPress = async () => {
    if (state === 'saving' || state === 'done' || state === 'checking') return;
    setState('saving');
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState('error');
        return;
      }
      const { error } = await supabase
        .from('feature_interest')
        .upsert(
          { user_id: user.id, event_key: eventKey },
          { onConflict: 'user_id,event_key' },
        );
      if (error) {
        console.warn('[RevenueEarlyAccessCard] insert failed', error);
        setState('error');
      } else {
        setState('done');
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (e) {
      console.warn('[RevenueEarlyAccessCard] threw', e);
      setState('error');
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.root, pressed && state === 'idle' && styles.pressed]}
      onPress={onPress}
      disabled={state === 'done' || state === 'saving' || state === 'checking'}
      accessibilityRole="button"
      accessibilityLabel={state === 'done' ? `Joined waitlist for ${headline}` : `Join waitlist for ${headline}`}
      testID={testID}
    >
      <View style={styles.iconWrap}>
        {state === 'done' ? (
          <CheckCircle2 size={20} color={colors.success} />
        ) : (
          <Icon size={20} color={colors.accent} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.headlineRow}>
          <Text style={styles.headline}>{headline}</Text>
          {state === 'idle' && (
            <View style={styles.earlyAccessPill}>
              <Text style={styles.earlyAccessPillText}>EARLY ACCESS</Text>
            </View>
          )}
          {state === 'done' && (
            <View style={[styles.earlyAccessPill, styles.earlyAccessPillDone]}>
              <Text style={[styles.earlyAccessPillText, styles.earlyAccessPillDoneText]}>ON THE LIST</Text>
            </View>
          )}
        </View>
        <Text style={styles.bodyText}>{body}</Text>
        {footer && state !== 'done' && (
          <Text style={styles.footer}>{footer}</Text>
        )}
        {state === 'done' && (
          <Text style={styles.footerDone}>We&apos;ll text you the moment this goes live.</Text>
        )}
        {state === 'error' && (
          <Text style={styles.footerError}>Tap to retry.</Text>
        )}
      </View>
      {state === 'idle' && (
        <ChevronRight size={18} color={colors.textMuted} />
      )}
      {(state === 'saving' || state === 'checking') && (
        <ActivityIndicator size="small" color={colors.accent} />
      )}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    marginVertical: 8,
  },
  pressed: {
    backgroundColor: c.accentSoft,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  body: { flex: 1, gap: 4 },
  headlineRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  headline: {
    ...Type.bodyCompactEmphasized,
    color: c.text,
    flexShrink: 1,
  },
  earlyAccessPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: c.accentSoft,
  },
  earlyAccessPillText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: c.accent,
    letterSpacing: 0.5,
  },
  earlyAccessPillDone: {
    backgroundColor: c.successSoft,
  },
  earlyAccessPillDoneText: {
    color: c.success,
  },
  bodyText: {
    ...Type.caption1,
    color: c.textSecondary,
    lineHeight: 17,
  },
  footer: {
    ...Type.caption2,
    color: c.textMuted,
    marginTop: 2,
  },
  footerDone: {
    ...Type.caption2,
    color: c.success,
    marginTop: 2,
    fontWeight: '600' as const,
  },
  footerError: {
    ...Type.caption2,
    color: Colors.warning,
    marginTop: 2,
  },
});
