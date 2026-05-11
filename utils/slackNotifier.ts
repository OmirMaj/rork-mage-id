// slackNotifier.ts — outbound Slack notifications via incoming webhooks.
//
// Why this exists: every premium PM tool ships Slack integration. For
// MAGE ID the high-value events to pipe in are: new invoice paid,
// RFI answered, project created, daily report submitted, change order
// approved, paywall conversion. The user pastes their Slack channel's
// incoming-webhook URL in Settings → Integrations and we post Block
// Kit messages to it.
//
// Why incoming webhooks (not the full Slack App):
//   - Zero Slack app review required
//   - User self-installs in 30 seconds (Slack: Apps → Incoming Webhooks → Add to channel)
//   - No OAuth, no Slack-side app to maintain
//   - Cost: $0
//
// Storage: webhook URL persists locally in AsyncStorage (per-user-per-
// device) until we want to sync it across devices via Supabase. For
// v1, local is fine — the URL is per-channel, GCs are typically on
// one workspace.
//
// Two-sided support: GC-only for now. Homeowners don't typically have
// Slack channels for projects. If the homeowner side asks for it,
// the same module supports a separate URL key.
//
// Cost: $0. Slack incoming webhooks are free, unlimited (within
// reasonable rate limits — see https://api.slack.com/messaging/webhooks).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'slack_webhook_url';

export type SlackEventKind =
  | 'invoice_paid'
  | 'rfi_answered'
  | 'project_created'
  | 'dfr_submitted'
  | 'change_order_approved'
  | 'permit_qa_used'
  | 'subscription_started'
  | 'test';

interface SlackPayload {
  /** Channel webhook URL won't honor a manual `channel` param — it's
   *  fixed when the webhook is installed. We only set `username` +
   *  `icon_emoji` to brand the post. */
  username?: string;
  icon_emoji?: string;
  text: string;
  blocks?: SlackBlock[];
}

// Minimal Block Kit subset. Slack accepts many block types; we use
// header, section, context, divider, actions.
type SlackBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string }; fields?: { type: 'mrkdwn'; text: string }[] }
  | { type: 'context'; elements: { type: 'mrkdwn'; text: string }[] }
  | { type: 'divider' }
  | { type: 'actions'; elements: { type: 'button'; text: { type: 'plain_text'; text: string }; url: string }[] };

/** Set the user's Slack webhook URL. Validates format before saving. */
export async function setSlackWebhookUrl(url: string | null): Promise<void> {
  if (url === null || url.length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (!url.startsWith('https://hooks.slack.com/services/')) {
    throw new Error('Invalid Slack webhook URL. Must start with https://hooks.slack.com/services/');
  }
  await AsyncStorage.setItem(STORAGE_KEY, url);
}

/** Read the user's Slack webhook URL. Returns null if not set. */
export async function getSlackWebhookUrl(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Post a Block Kit message to the user's configured webhook. Returns
 * true if the post succeeded, false if no URL is configured or the
 * post failed. Never throws — Slack failures should never block the
 * primary user action.
 */
export async function notifySlack(payload: SlackPayload): Promise<boolean> {
  const url = await getSlackWebhookUrl();
  if (!url) return false;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: payload.username ?? 'MAGE ID',
        icon_emoji: payload.icon_emoji ?? ':hammer_and_wrench:',
        text: payload.text,
        blocks: payload.blocks,
      }),
    });
    return res.ok;
  } catch (err) {
    if (__DEV__) console.warn('[slack] notify failed:', err);
    return false;
  }
}

/**
 * High-level event notification helper. Builds a Block Kit message
 * appropriate to the event kind and fires it. Call from anywhere a
 * GC-relevant event happens.
 */
export async function notifySlackEvent(
  kind: SlackEventKind,
  data: {
    projectName?: string;
    amount?: string;
    title?: string;
    link?: string;
    extra?: string;
  } = {},
): Promise<boolean> {
  const blocks: SlackBlock[] = [];

  const header: Record<SlackEventKind, string> = {
    invoice_paid: '💰 Invoice paid',
    rfi_answered: '✅ RFI answered',
    project_created: '🏗️ New project created',
    dfr_submitted: '📋 Daily field report submitted',
    change_order_approved: '🟢 Change order approved',
    permit_qa_used: '⚖️ Permit Q&A used',
    subscription_started: '🎉 New subscription',
    test: '🧪 Test message from MAGE ID',
  };

  blocks.push({ type: 'header', text: { type: 'plain_text', text: header[kind] } });

  const fields: { type: 'mrkdwn'; text: string }[] = [];
  if (data.projectName) fields.push({ type: 'mrkdwn', text: `*Project*\n${data.projectName}` });
  if (data.title) fields.push({ type: 'mrkdwn', text: `*Item*\n${data.title}` });
  if (data.amount) fields.push({ type: 'mrkdwn', text: `*Amount*\n${data.amount}` });
  if (fields.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ' ' }, fields });
  }
  if (data.extra) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: data.extra }] });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Sent from MAGE ID · ${new Date().toLocaleString()}` }],
  });
  if (data.link) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in MAGE ID' }, url: data.link }],
    });
  }

  return notifySlack({
    text: header[kind],
    blocks,
  });
}

/** Convenience: ping the webhook with a "test" message. Wire into
 *  Settings → Integrations → Slack so users can verify their URL
 *  before trusting it for real events. */
export async function sendSlackTest(): Promise<{ ok: boolean; message: string }> {
  const url = await getSlackWebhookUrl();
  if (!url) return { ok: false, message: 'No Slack webhook URL configured.' };
  const ok = await notifySlackEvent('test', {
    extra: `Test from MAGE ID on ${Platform.OS} — if you see this, your webhook is wired correctly.`,
  });
  return { ok, message: ok ? 'Test message sent to Slack.' : 'Slack rejected the post. Check the URL.' };
}
