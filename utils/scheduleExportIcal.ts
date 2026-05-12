// utils/scheduleExportIcal.ts — Phase 27.
//
// Client-side iCal export for the Pro Scheduler.
//
// Two paths, offered to the user via a choice alert:
//
//   1. One-shot download / share: builds a static .ics snapshot of the
//      schedule tasks and opens the native share sheet via Sharing.shareAsync.
//      Good for one-off delivery (email to client, save to Files).
//
//   2. Live subscription URL: copies the webcal:// + https:// URLs for the
//      existing `ics-feed` Supabase edge function (token-gated, auto-updates
//      when the schedule changes). Only available when the project has a
//      `calendarToken`; falls back to one-shot if the token is missing.
//
// Reuses the existing `icsGenerator.ts` infrastructure — no duplicate ICS
// builder logic.

import { Alert, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  exportProjectIcs,
  getCalendarSubscribeUrls,
} from '@/utils/icsGenerator';
import type { Project } from '@/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/**
 * Offer the user a one-shot .ics download OR a live subscription URL
 * (if the project has a `calendarToken`). Called from ExportSheet.
 *
 * Pass `project` — the full project object. Invoices and warranties are
 * left empty here to keep the export focused on the schedule; those
 * extras are included when the user exports via the project-detail
 * Calendar tile (which provides them).
 */
export async function exportScheduleIcal(opts: { project: Project }): Promise<void> {
  const { project } = opts;
  const subscribeUrls = getCalendarSubscribeUrls({
    supabaseUrl: SUPABASE_URL,
    calendarToken: project.calendarToken,
  });

  // If a live feed is available, offer the choice between snapshot and
  // subscribe. Otherwise go straight to one-shot download.
  if (subscribeUrls) {
    const message = Platform.OS === 'web'
      ? 'Export options:\n\nOK → Copy live subscription URL (auto-updates)\nCancel → Download .ics snapshot'
      : undefined;

    if (Platform.OS === 'web') {
      const copy = window.confirm?.(message ?? '');
      if (copy) {
        await handleCopySubscribeUrl(subscribeUrls.webcal, subscribeUrls.https, project.name ?? 'Schedule');
      } else {
        await handleOneShot(project);
      }
      return;
    }

    // Native: Alert with three buttons.
    await new Promise<void>((resolve) => {
      Alert.alert(
        'Export to calendar',
        'Choose how to add this schedule to your calendar app.',
        [
          {
            text: 'Subscribe (live updates)',
            onPress: () => {
              void handleCopySubscribeUrl(subscribeUrls.webcal, subscribeUrls.https, project.name ?? 'Schedule').then(resolve);
            },
          },
          {
            text: 'Download .ics snapshot',
            onPress: () => { void handleOneShot(project).then(resolve); },
          },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
        ],
        { cancelable: true, onDismiss: resolve },
      );
    });
    return;
  }

  // No calendar token → fall back to one-shot download.
  await handleOneShot(project);
}

// ---------------------------------------------------------------------------
// Subscribe URL path
// ---------------------------------------------------------------------------

async function handleCopySubscribeUrl(
  webcalUrl: string,
  httpsUrl: string,
  projectName: string,
): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      try { await navigator.clipboard?.writeText(httpsUrl); } catch { /* ignore */ }
      window.alert?.(`Live calendar URL copied!\n\nPaste into Google Calendar → "Other calendars → From URL":\n\n${httpsUrl}`);
      return;
    }
    // On iOS, copy the webcal:// URL — tapping it opens Calendar.app's
    // native "Subscribe" dialog. Show the https:// URL alongside for
    // Google Calendar users.
    await Clipboard.setStringAsync(webcalUrl);
    Alert.alert(
      'Calendar link copied',
      [
        `Paste into Apple Calendar:  webcal:// URL is in your clipboard — just tap "Paste" in Calendar › File › New Calendar Subscription.`,
        '',
        `For Google Calendar, use this URL instead:\n${httpsUrl}`,
        '',
        `"${projectName}" will auto-sync when the schedule changes.`,
      ].join('\n'),
    );
  } catch (e) {
    Alert.alert('Export failed', String(e));
  }
}

// ---------------------------------------------------------------------------
// One-shot download path
// ---------------------------------------------------------------------------

async function handleOneShot(project: Project): Promise<void> {
  try {
    const result = await exportProjectIcs({
      project,
      invoices: [],
      warranties: [],
    });
    // exportProjectIcs opens the share sheet on native and triggers a
    // Blob download on web — nothing more to do on success.
    if (result.eventCount === 0) {
      Alert.alert('Nothing to export', 'This schedule has no tasks yet.');
    }
  } catch (e) {
    Alert.alert('Export failed', String(e));
  }
}
