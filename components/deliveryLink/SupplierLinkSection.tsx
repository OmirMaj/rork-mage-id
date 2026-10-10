// components/deliveryLink/SupplierLinkSection.tsx — the Supplier Link, on a
// delivery's sheet (lane DELIVERIES-2, Deliveries phase 2).
//
// Three states, top to bottom:
//   1. NO LINK. What the link would show, line by line, with one switch (show
//      Needed on Site By or not), and Make Link.
//   2. A LINK. The same lines as they were stored, Copy Link, Copy Link With a
//      Message, Share Link (the phone's own share sheet) and Turn Off Link.
//   3. AN ANSWER. What was typed into the link, who it says it is from and
//      when, Use This Date and Mark as Seen.
//
// DRAWS NOTHING when the gate is closed, the table has not answered, or the
// delivery has arrived or been cancelled.
//
// WHAT IT NEVER DOES. It sends nothing: Copy puts text on the clipboard and
// Share opens the phone's own sheet, where the person picks who gets it. It
// never changes a supplier date by itself: Use This Date is a button a person
// presses, and it goes through the delivery's own writer (`onUpdate`, the
// offline queue), recorded as the supplier's word with a note that it came
// through the link. It moves no task.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, Share, Platform, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useProjects } from '@/contexts/ProjectContext';
import { showAlert } from '@/utils/alert';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import type { Delivery } from '@/utils/deliverySchedule';
import { isSettled } from '@/utils/deliveries/flags';
import { useDeliverySupplierLinks, type LinkActionResult } from '@/hooks/useDeliverySupplierLinks';
import { useSupplierLinkCopy } from '@/hooks/useSupplierLinkCopy';
import { buildShown, linkMessage, replyDateDiffers, replyDatePatch, replyIsNew, supplierLinkUrl, tripStop, type SupplierLinkShown } from '@/utils/deliveryLink/core';
import { DateRow } from '@/components/deliveries/DeliveryDatesCard';
import type { DeliveriesFollowStyles } from '@/components/deliveries/styles';
import { TruckRouteStrip } from './TruckRouteStrip';
import { TruckRouteMap } from './TruckRouteMap';
import { useDeliveryYardPlace } from '@/hooks/useDeliveryYardPlace';
import { isPlace } from '@/utils/deliveryLink/mapMath';

/** The card's own spacing: the sheet's shared card has none between its rows and buttons. */
const local = StyleSheet.create({ stack: { gap: 10 } });

export function SupplierLinkSection({
  delivery, projectId, neededBy, me, styles, onUpdate,
}: {
  delivery: Delivery;
  projectId: string;
  /** Needed on Site By as worked out right now ('' when there is none). */
  neededBy: string;
  me: { id: string; name: string };
  styles: DeliveriesFollowStyles;
  /** The delivery's own writer (ProjectContext.updateDelivery: the offline queue). */
  onUpdate: (id: string, updates: Partial<Delivery>) => void;
}) {
  const { colors: t } = useTheme();
  const { lang } = useT();
  const copy = useSupplierLinkCopy();
  const { settings, projects } = useProjects();
  const links = useDeliverySupplierLinks(projectId);
  const [showNeededBy, setShowNeededBy] = useState(true);

  const company = settings?.branding?.companyName ?? '';
  const draft = useMemo<SupplierLinkShown>(() => buildShown({ delivery, company, neededBy, showNeededBy }), [delivery, company, neededBy, showNeededBy]);

  // The map's two ends. The yard is looked up from the words typed on the link; the job is the job's own address.
  const link = links.on ? links.linkFor(delivery.id) : null;
  const comingFrom = link?.trip?.from ?? '';
  const yard = useDeliveryYardPlace(comingFrom, links.on && !isSettled(delivery));
  const job = useMemo(() => {
    const p = projects.find((x) => x.id === projectId);
    const place = { latitude: p?.locationLatitude ?? NaN, longitude: p?.locationLongitude ?? NaN };
    return isPlace(place) ? place : null;
  }, [projects, projectId]);

  if (!links.on || isSettled(delivery)) return null;
  const day = (d: string) => formatCalendarDay(d, { weekday: 'short', month: 'short', day: 'numeric' }, lang);
  /** An instant as a day and a time of day, in the phone's own zone: "Oct 8, 8:15 AM". */
  const whenLine = (at: string) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '' : `${formatCalendarDay(calendarDayOf(at) ?? at, { month: 'short', day: 'numeric' }, lang)}, ${d.toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' })}`;
  };
  const stamp = (at: string) => formatCalendarDay(calendarDayOf(at) ?? at, { month: 'short', day: 'numeric' }, lang);
  /** Says what an action came to, when it was not 'ok'. */
  const say = (r: LinkActionResult) => { if (r !== 'ok') showAlert(copy.sectionLabel, r === 'offline' ? copy.failBody : copy.refusedBody); };
  const failed = () => showAlert(copy.sectionLabel, copy.failBody);

  const shownRows = (s: SupplierLinkShown, made: boolean) => (
    <>
      <DateRow label={copy.whatLabel} value={s.description} basis={`${copy.supplierLabel}: ${s.supplier}`} styles={styles} testID="dsl-shown-what" />
      <DateRow label={copy.askedByLabel} value={s.company || copy.theContractorSub} basis={s.company ? copy.companyFromSub : copy.noCompanyBody} styles={styles} testID="dsl-shown-company" />
      <DateRow label={copy.neededByLabel} value={s.neededBy ? day(s.neededBy) : copy.notShownSub} basis={s.neededBy ? (made ? copy.neededAsMadeSub : copy.neededTodaySub) : copy.neededOffSub} styles={styles} testID="dsl-shown-needed" />
      <Text style={styles.note}>{copy.showsNothingElseBody}</Text>
    </>
  );

  if (!link) {
    return (
      <View style={[styles.card, local.stack]} testID="dsl-section">
        <View style={styles.headRow}>
          <Text style={styles.sectionLabel}>{copy.sectionLabel}</Text>
          {links.ownerPreview ? <View style={styles.chip}><Text style={styles.chipText}>{copy.ownerPreviewLabel}</Text></View> : null}
        </View>
        <Text style={styles.body}>{copy.introBody}</Text>
        <Text style={styles.sectionLabel}>{copy.showsLabel}</Text>
        {shownRows(draft, false)}
        {neededBy ? (
          <View style={styles.headRow}>
            <Text style={styles.body}>{copy.showNeededLabel}</Text>
            <Switch value={showNeededBy} onValueChange={setShowNeededBy} trackColor={{ true: t.accentFill, false: t.line }} accessibilityLabel={copy.showNeededLabel} testID="dsl-show-needed" />
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, links.busy && styles.btnOff]}
          disabled={links.busy}
          onPress={() => { void links.make(delivery.id, draft).then(say); }}
          accessibilityRole="button"
          testID="dsl-make"
        >
          <Text style={styles.btnPrimaryText}>{copy.makeLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.note}>{copy.anyoneBody}</Text>
      </View>
    );
  }

  const url = supplierLinkUrl(link.token);
  const reply = link.reply;
  const fresh = replyIsNew(link);
  const differs = replyDateDiffers(delivery, reply);

  const copyText = async (text: string, said: string) => {
    try { await Clipboard.setStringAsync(text); showAlert(copy.sectionLabel, said); } catch { failed(); }
  };
  const message = linkMessage({ ask: copy.messageAsk, sign: copy.messageSign }, link.shown, url);
  const share = async () => {
    // The phone's own share sheet: the person picks the app and the person. Nothing is sent from here.
    try { await Share.share({ message }); } catch { /* the person closed the sheet */ }
  };
  const turnOff = () => showAlert(copy.turnOffLabel, copy.turnOffBody, [
    { text: copy.cancelLabel, style: 'cancel' },
    { text: copy.turnOffLabel, style: 'destructive', onPress: () => { void links.turnOff(delivery.id).then(say); } },
  ]);
  const useDate = () => {
    if (!reply) return;
    const patch = replyDatePatch(delivery, reply, { now: new Date(), by: me.id, byName: me.name, noteFor: copy.noteFor });
    if (patch) onUpdate(delivery.id, patch);
    // The date is saved by the line above (through the offline queue) whether or not this reaches the server.
    // With no signal the answer simply stays marked New until Mark as Seen goes through.
    void links.markSeen(delivery.id, link.replyAt);
  };

  return (
    <View style={[styles.card, local.stack]} testID="dsl-section">
      <View style={styles.headRow}>
        <Text style={styles.sectionLabel}>{copy.sectionLabel}</Text>
        {fresh ? <View style={[styles.chip, styles.chipWarn]} testID="dsl-new"><Text style={[styles.chipText, styles.chipWarnText]}>{copy.newSub}</Text></View> : null}
        {links.ownerPreview ? <View style={styles.chip}><Text style={styles.chipText}>{copy.ownerPreviewLabel}</Text></View> : null}
      </View>

      {reply ? (
        <View style={local.stack} testID="dsl-answer">
          <Text style={styles.sectionLabel}>{copy.answerLabel}</Text>
          <DateRow
            label={copy.dateLabel}
            value={reply.date ? day(reply.date) : copy.noDateGivenSub}
            basis={copy.answerSourceBody(reply.name, stamp(reply.at))}
            extra={[reply.window, reply.note].filter(Boolean).join('. ') || undefined}
            styles={styles}
            testID="dsl-answer-date"
          />
          {reply.tracking ? (
            <DateRow label={copy.trackingLabel} value={reply.tracking} basis={reply.carrier || copy.typedByLabel + ': ' + reply.name} styles={styles} testID="dsl-answer-tracking" />
          ) : null}
          {reply.date ? (
            differs ? (
              <>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary, links.busy && styles.btnOff]} disabled={links.busy} onPress={useDate} accessibilityRole="button" testID="dsl-use-date">
                  <Text style={styles.btnPrimaryText}>{copy.useDateLabel}</Text>
                </TouchableOpacity>
                <Text style={styles.note}>{copy.useDateBody(day(reply.date))}</Text>
              </>
            ) : <Text style={styles.note} testID="dsl-same-date">{copy.sameDateBody}</Text>
          ) : null}
          {reply.tracking ? (
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => { void copyText(reply.tracking, copy.trackingCopiedBody); }} accessibilityRole="button" testID="dsl-copy-tracking">
              <Text style={styles.btnOutlineText}>{copy.copyTrackingLabel}</Text>
            </TouchableOpacity>
          ) : null}
          {fresh ? (
            <TouchableOpacity style={[styles.btn, styles.btnQuiet, links.busy && styles.btnOff]} disabled={links.busy} onPress={() => { void links.markSeen(delivery.id, link.replyAt).then(say); }} accessibilityRole="button" testID="dsl-mark-seen">
              <Text style={styles.btnQuietText}>{copy.markSeenLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Text style={styles.body} testID="dsl-no-answer">{copy.noAnswerBody}</Text>
      )}

      {yard.place && job ? (
        <TruckRouteMap from={yard.place} to={job} stop={tripStop(link.trip)} fromLabel={comingFrom} toLabel={copy.yourJobLabel} matched={yard.place.matched} copy={copy} styles={styles} />
      ) : comingFrom && (yard.looked || !job) ? (
        <Text style={styles.note} testID="dsl-map-none">{copy.mapNoPlaceBody(comingFrom)}</Text>
      ) : null}
      <TruckRouteStrip trip={link.trip} copy={copy} styles={styles} formatWhen={whenLine} />

      <Text style={styles.sectionLabel}>{copy.showsLabel}</Text>
      {shownRows(link.shown, true)}
      <Text style={styles.note} selectable testID="dsl-url">{url}</Text>
      <Text style={styles.note}>{copy.madeSub(stamp(link.madeAt))}</Text>

      <TouchableOpacity style={[styles.btn, reply ? styles.btnOutline : styles.btnPrimary]} onPress={() => { void copyText(url, copy.copiedBody); }} accessibilityRole="button" testID="dsl-copy">
        <Text style={reply ? styles.btnOutlineText : styles.btnPrimaryText}>{copy.copyLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => { void copyText(message, copy.copiedBody); }} accessibilityRole="button" testID="dsl-copy-message">
        <Text style={styles.btnOutlineText}>{copy.copyMessageLabel}</Text>
      </TouchableOpacity>
      {Platform.OS !== 'web' ? (
        <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => { void share(); }} accessibilityRole="button" testID="dsl-share">
          <Text style={styles.btnOutlineText}>{copy.shareLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={[styles.btn, styles.btnQuiet, links.busy && styles.btnOff]} disabled={links.busy} onPress={() => { void links.refresh().then((ok) => { if (!ok) failed(); }); }} accessibilityRole="button" testID="dsl-check">
        <Text style={styles.btnQuietText}>{copy.checkLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnQuiet, links.busy && styles.btnOff]} disabled={links.busy} onPress={turnOff} accessibilityRole="button" testID="dsl-turn-off">
        <Text style={styles.btnQuietText}>{copy.turnOffLabel}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>{copy.anyoneBody}</Text>
    </View>
  );
}

export default SupplierLinkSection;
