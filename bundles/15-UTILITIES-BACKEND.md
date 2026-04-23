# Utilities, Offline Sync & Backend (tRPC + Supabase)


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Everything under `backend/`, `lib/`, and the remaining `utils/`.

- **Offline-first sync**: every Supabase write goes through
  `utils/offlineQueue.ts::supabaseWrite`. `components/ErrorBoundary.tsx` +
  `OfflineSyncManager` (mounted in `_layout.tsx`) flush when connectivity
  returns. UI code must NEVER call `supabase.from(...)` directly —
  always go through the queue.
- **Backend**: Hono app at `backend/hono.ts` mounting tRPC at `/trpc` via
  `@hono/trpc-server`. Routers under `backend/routes/`. Client in
  `lib/supabase.ts` (anon key, RLS-protected).
- **Notifications**, **PDF generation**, **location**, **analytics**,
  **weather**, **email**, **storage wrapper**.


## Files in this bundle

- `backend/hono.ts`
- `backend/routes/send-email.ts`
- `lib/supabase.ts`
- `utils/offlineQueue.ts`
- `utils/storage.ts`
- `utils/pdfGenerator.ts`
- `utils/generateId.ts`
- `utils/formatters.ts`
- `utils/analytics.ts`
- `utils/notifications.ts`
- `utils/location.ts`
- `utils/weatherService.ts`
- `components/ErrorBoundary.tsx`


---

### `backend/hono.ts`

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

import emailRoute from "./routes/send-email";

const app = new Hono();

app.use("*", cors());

app.route("/email", emailRoute);

app.get("/", (c) => {
  return c.json({ status: "ok", message: "MAGE ID API is running" });
});

export default app;

```


---

### `backend/routes/send-email.ts`

```ts
import { Hono } from "hono";

const emailRoute = new Hono();

interface SendEmailBody {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
}

emailRoute.post("/send", async (c) => {
  try {
    const body = await c.req.json<SendEmailBody>();

    if (!body.to || !body.subject || !body.html) {
      return c.json({ success: false, error: "Missing required fields: to, subject, html" }, 400);
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("[Email] RESEND_API_KEY is not configured");
      return c.json({ success: false, error: "Email service not configured" }, 500);
    }

    const fromAddress = body.from || process.env.RESEND_FROM_EMAIL || "MAGE ID <onboarding@resend.dev>";

    console.log(`[Email] Sending email to ${body.to} with subject: ${body.subject}`);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [body.to],
        subject: body.subject,
        html: body.html,
        reply_to: body.replyTo || undefined,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Email] Resend API error:", result);
      return c.json({ success: false, error: result?.message || "Failed to send email" }, 502);
    }

    console.log("[Email] Email sent successfully:", result);
    return c.json({ success: true, id: result.id });
  } catch (err) {
    console.error("[Email] Error sending email:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export default emailRoute;

```


---

### `lib/supabase.ts`

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

console.log('[Supabase] URL configured:', supabaseUrl.substring(0, 30) + '...');
console.log('[Supabase] Key configured:', supabaseAnonKey.substring(0, 20) + '...');

export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

let _supabase: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
  console.log('[Supabase] Client initialized successfully.');
} else {
  console.error('[Supabase] CRITICAL: EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY is missing. Supabase features will NOT work.');
}

export function supabaseGuard(): SupabaseClient {
  if (!isSupabaseConfigured || !_supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY environment variables.');
  }
  return _supabase;
}

export const supabase: SupabaseClient = isSupabaseConfigured
  ? _supabase!
  : new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        if (prop === 'auth') {
          return new Proxy({} as SupabaseClient['auth'], {
            get(_t, authProp) {
              if (authProp === 'onAuthStateChange') {
                return (_cb: unknown) => ({ data: { subscription: { unsubscribe: () => {} } } });
              }
              if (authProp === 'getSession') {
                return async () => ({ data: { session: null }, error: null });
              }
              return async () => ({ data: null, error: new Error('Supabase not configured') });
            },
          });
        }
        if (prop === 'from') {
          return () => new Proxy({} as Record<string, unknown>, {
            get() {
              return () => new Proxy({} as Record<string, unknown>, {
                get() {
                  return async () => ({ data: null, error: { message: 'Supabase not configured' } });
                },
              });
            },
          });
        }
        if (prop === 'channel') {
          return () => ({
            on: function () { return this; },
            subscribe: () => 'closed',
          });
        }
        if (prop === 'removeChannel') {
          return async () => {};
        }
        return undefined;
      },
    });

```


---

### `utils/offlineQueue.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;

export interface OfflineMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
}

export async function getOfflineQueue(): Promise<OfflineMutation[]> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return stored ? JSON.parse(stored) as OfflineMutation[] : [];
  } catch {
    return [];
  }
}

export async function addToOfflineQueue(mutation: Omit<OfflineMutation, 'id' | 'timestamp' | 'retryCount'>): Promise<void> {
  try {
    const queue = await getOfflineQueue();
    const entry: OfflineMutation = {
      ...mutation,
      id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      retryCount: 0,
    };
    queue.push(entry);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[OfflineQueue] Queued mutation:', mutation.table, mutation.operation);
  } catch (err) {
    console.log('[OfflineQueue] Failed to queue mutation:', err);
  }
}

export async function processOfflineQueue(): Promise<{ processed: number; failed: number }> {
  if (!isSupabaseConfigured) return { processed: 0, failed: 0 };

  const queue = await getOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };

  console.log('[OfflineQueue] Processing', queue.length, 'queued mutations');

  const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp);
  const remaining: OfflineMutation[] = [];
  let processed = 0;
  let failed = 0;

  for (const mutation of sorted) {
    try {
      let error: { message: string } | null = null;

      if (mutation.operation === 'insert') {
        const result = await supabase.from(mutation.table).upsert(mutation.data);
        error = result.error;
      } else if (mutation.operation === 'update') {
        const { id, ...rest } = mutation.data;
        const result = await supabase.from(mutation.table).update(rest).eq('id', id as string);
        error = result.error;
      } else if (mutation.operation === 'delete') {
        const result = await supabase.from(mutation.table).delete().eq('id', mutation.data.id as string);
        error = result.error;
      }

      if (error) {
        throw new Error(error.message);
      }

      processed++;
      console.log('[OfflineQueue] Processed:', mutation.table, mutation.operation);
    } catch (err) {
      mutation.retryCount++;
      if (mutation.retryCount >= MAX_RETRIES) {
        console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
        failed++;
      } else {
        remaining.push(mutation);
        failed++;
      }
    }
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  console.log('[OfflineQueue] Done. Processed:', processed, 'Remaining:', remaining.length);
  return { processed, failed };
}

export async function supabaseWrite(
  table: string,
  operation: 'insert' | 'update' | 'delete',
  data: Record<string, unknown>,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    let error: { message: string } | null = null;

    if (operation === 'insert') {
      const result = await supabase.from(table).upsert(data);
      error = result.error;
    } else if (operation === 'update') {
      const { id, ...rest } = data;
      const result = await supabase.from(table).update(rest).eq('id', id as string);
      error = result.error;
    } else if (operation === 'delete') {
      const result = await supabase.from(table).delete().eq('id', data.id as string);
      error = result.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    const isNetworkError = err instanceof TypeError ||
      (err instanceof Error && (
        err.message.includes('Network request failed') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('network')
      ));

    if (isNetworkError) {
      console.log('[OfflineQueue] Network error, queuing mutation:', table, operation);
      await addToOfflineQueue({ table, operation, data });
    } else {
      console.log('[OfflineQueue] Non-network Supabase error:', err);
    }

    return false;
  }
}

```


---

### `utils/storage.ts`

```ts
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export async function uploadProjectPhoto(
  userId: string,
  projectId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const fileName = `${userId}/${projectId}/${Date.now()}.jpg`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('project-photos')
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.log('[Storage] Photo upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('project-photos')
      .createSignedUrl(fileName, 60 * 60 * 24 * 7);
    console.log('[Storage] Photo uploaded:', fileName);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Photo upload failed:', err);
    return null;
  }
}

export async function uploadDocument(
  userId: string,
  fileName: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/${Date.now()}_${fileName}`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('documents')
      .upload(path, blob, { contentType: 'application/pdf', upsert: false });
    if (error) {
      console.log('[Storage] Document upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Document uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Document upload failed:', err);
    return null;
  }
}

export async function uploadBrandingAsset(
  userId: string,
  type: 'logo' | 'signature',
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const ext = type === 'logo' ? 'png' : 'png';
    const path = `${userId}/${type}_${Date.now()}.${ext}`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('branding')
      .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
    if (error) {
      console.log('[Storage] Branding upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('branding')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Branding asset uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Branding upload failed:', err);
    return null;
  }
}

export async function uploadProfileImage(
  userId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/avatar_${Date.now()}.jpg`;
    const response = await fetch(fileUri);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from('profiles')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log('[Storage] Profile image upload error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('profiles').getPublicUrl(path);
    console.log('[Storage] Profile image uploaded:', path);
    return urlData.publicUrl;
  } catch (err) {
    console.log('[Storage] Profile image upload failed:', err);
    return null;
  }
}

export async function deleteStorageFile(
  bucket: string,
  path: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      console.log('[Storage] Delete error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Storage] Delete failed:', err);
    return false;
  }
}

```


---

### `utils/pdfGenerator.ts`

```ts
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CompanyBranding, Project, ChangeOrder, Invoice, DailyFieldReport } from '@/types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildSignatureSvg(paths: string[]): string {
  if (!paths || paths.length === 0) return '';
  const pathElements = paths.map(d =>
    `<path d="${escapeHtml(d)}" stroke="#1a1a1a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('');
  return `<svg width="200" height="80" viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg" style="border-bottom:1px solid #ccc">${pathElements}</svg>`;
}

function buildEstimateHtml(
  project: Project,
  branding: CompanyBranding,
): string {
  const est = project.linkedEstimate;
  const legacyEst = project.estimate;
  const schedule = project.schedule;
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Company Logo" /></div>`
    : '';

  const companyBlock = branding.companyName
    ? `<div class="company-header">
        ${logoBlock}
        <div class="company-name">${escapeHtml(branding.companyName)}</div>
        ${branding.tagline ? `<div class="tagline">${escapeHtml(branding.tagline)}</div>` : ''}
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.address ? `<div class="info-item"><span class="info-label">Address</span><span>${escapeHtml(branding.address)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div>
      </div>`
    : `<div class="company-header"><div class="company-name">MAGE ID Estimate</div></div>`;

  let itemsHtml = '';

  if (est && est.items.length > 0) {
    itemsHtml = `
      <h2>Materials & Items</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:30%">Item</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th>Markup</th>
            <th style="text-align:right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${est.items.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${item.quantity} ${escapeHtml(item.unit)}</td>
              <td>${formatCurrency(item.unitPrice)}</td>
              <td>${item.markup}%</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.lineTotal)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="summary-box">
        <div class="summary-row"><span>Base Cost</span><span>${formatCurrency(est.baseTotal)}</span></div>
        <div class="summary-row"><span>Markup (${est.globalMarkup}%)</span><span>+${formatCurrency(est.markupTotal)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-row total"><span>Estimate Total</span><span>${formatCurrency(est.grandTotal)}</span></div>
      </div>`;
  } else if (legacyEst) {
    itemsHtml = `
      <h2>Materials</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:35%">Item</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Unit Price</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${legacyEst.materials.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.category)}</td>
              <td>${item.quantity} ${escapeHtml(item.unit)}</td>
              <td>${formatCurrency(item.unitPrice)}</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.totalPrice)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h2>Labor</h2>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:40%">Role</th>
            <th>Rate/hr</th>
            <th>Hours</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${legacyEst.labor.map((item, i) => `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(item.role)}</td>
              <td>${formatCurrency(item.hourlyRate)}</td>
              <td>${item.hours}h</td>
              <td style="text-align:right;font-weight:600">${formatCurrency(item.totalCost)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="summary-box">
        <div class="summary-row"><span>Materials</span><span>${formatCurrency(legacyEst.materialTotal)}</span></div>
        <div class="summary-row"><span>Labor</span><span>${formatCurrency(legacyEst.laborTotal)}</span></div>
        <div class="summary-row"><span>Permits & Fees</span><span>${formatCurrency(legacyEst.permits)}</span></div>
        <div class="summary-row"><span>Overhead</span><span>${formatCurrency(legacyEst.overhead)}</span></div>
        <div class="summary-divider"></div>
        <div class="summary-row"><span>Subtotal</span><span>${formatCurrency(legacyEst.subtotal)}</span></div>
        <div class="summary-row"><span>Tax</span><span>${formatCurrency(legacyEst.tax)}</span></div>
        <div class="summary-row"><span>Contingency</span><span>${formatCurrency(legacyEst.contingency)}</span></div>
        <div class="summary-row savings"><span>Bulk Savings</span><span>-${formatCurrency(legacyEst.bulkSavingsTotal)}</span></div>
        <div class="summary-divider thick"></div>
        <div class="summary-row total"><span>Grand Total</span><span>${formatCurrency(legacyEst.grandTotal)}</span></div>
        ${legacyEst.pricePerSqFt > 0 ? `<div class="summary-row sub"><span>Price per Sq Ft</span><span>${formatCurrency(legacyEst.pricePerSqFt)}</span></div>` : ''}
        ${legacyEst.estimatedDuration ? `<div class="summary-row sub"><span>Est. Duration</span><span>${escapeHtml(legacyEst.estimatedDuration)}</span></div>` : ''}
      </div>`;
  }

  let scheduleHtml = '';
  if (schedule && schedule.tasks.length > 0) {
    const milestones = schedule.tasks.filter(t => t.isMilestone);
    const criticalTasks = schedule.tasks.filter(t => t.isCriticalPath);

    scheduleHtml = `
      <div class="page-break"></div>
      <h2>Project Schedule</h2>
      <div class="schedule-stats">
        <div class="schedule-stat"><strong>${schedule.totalDurationDays}</strong> days total</div>
        <div class="schedule-stat"><strong>${schedule.criticalPathDays}</strong> critical path</div>
        <div class="schedule-stat"><strong>${schedule.tasks.length}</strong> tasks</div>
        ${milestones.length > 0 ? `<div class="schedule-stat"><strong>${milestones.length}</strong> milestones</div>` : ''}
      </div>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:25%">Task</th>
            <th>Phase</th>
            ${schedule.tasks.some(t => t.wbsCode) ? '<th>WBS</th>' : ''}
            <th>Start Day</th>
            <th>Duration</th>
            <th>Crew</th>
            <th>Status</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          ${schedule.tasks.map((task, i) => {
            const flags: string[] = [];
            if (task.isMilestone) flags.push('<span class="flag milestone">Milestone</span>');
            if (task.isCriticalPath) flags.push('<span class="flag critical">Critical</span>');
            return `
            <tr class="${i % 2 === 0 ? 'alt' : ''}">
              <td style="text-align:left;font-weight:500">${escapeHtml(task.title)}</td>
              <td>${escapeHtml(task.phase)}</td>
              ${schedule.tasks.some(t => t.wbsCode) ? `<td>${task.wbsCode ? escapeHtml(task.wbsCode) : '-'}</td>` : ''}
              <td>Day ${task.startDay}</td>
              <td>${task.durationDays}d</td>
              <td>${escapeHtml(task.crew)}</td>
              <td>${task.progress}%</td>
              <td>${flags.join(' ') || '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${criticalTasks.length > 0 ? `
        <h3>Critical Path</h3>
        <div class="critical-path-chain">
          ${criticalTasks.map((t, i) => `
            <span class="critical-node">${escapeHtml(t.title)} (${t.durationDays}d)</span>
            ${i < criticalTasks.length - 1 ? '<span class="critical-arrow">→</span>' : ''}
          `).join('')}
        </div>
      ` : ''}
      ${milestones.length > 0 ? `
        <h3>Milestones</h3>
        <div class="milestones-list">
          ${milestones.map(m => `
            <div class="milestone-item">
              <span class="milestone-flag">◆</span>
              <span class="milestone-name">${escapeHtml(m.title)}</span>
              <span class="milestone-day">Day ${m.startDay}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}`;
  }

  const signatureBlock = branding.signatureData && branding.signatureData.length > 0
    ? `<div class="signature-section">
        <div class="signature-label">Authorized Signature</div>
        <div class="signature-drawing">${buildSignatureSvg(branding.signatureData)}</div>
        ${branding.contactName ? `<div class="signature-name">${escapeHtml(branding.contactName)}</div>` : ''}
        ${branding.companyName ? `<div class="signature-company">${escapeHtml(branding.companyName)}</div>` : ''}
        <div class="signature-date">Date: ${now}</div>
      </div>`
    : `<div class="signature-section">
        <div class="signature-label">Authorized Signature</div>
        <div class="signature-line"></div>
        ${branding.contactName ? `<div class="signature-name">${escapeHtml(branding.contactName)}</div>` : ''}
        <div class="signature-date">Date: _______________</div>
      </div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; font-size: 12px; line-height: 1.5; }
  .company-header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 3px solid #1A6B3C; }
  .logo-wrap { margin-bottom: 12px; }
  .company-logo { max-height: 60px; max-width: 240px; object-fit: contain; }
  .company-name { font-size: 28px; font-weight: 800; color: #1A6B3C; letter-spacing: -0.5px; }
  .tagline { font-size: 13px; color: #666; margin-top: 4px; font-style: italic; }
  .company-info-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 20px; margin-top: 10px; }
  .info-item { font-size: 11px; color: #555; }
  .info-label { font-weight: 600; color: #333; margin-right: 4px; }
  .project-info { background: linear-gradient(135deg, #f8f9fa, #eef2f0); border-radius: 8px; padding: 18px; margin-bottom: 24px; border-left: 4px solid #1A6B3C; }
  .project-name { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #1a1a1a; }
  .project-meta { font-size: 11px; color: #666; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  h2 { font-size: 16px; font-weight: 700; color: #1A6B3C; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #1A6B3C20; }
  h3 { font-size: 14px; font-weight: 600; color: #333; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  th { background: #1A6B3C08; padding: 8px 10px; text-align: center; font-weight: 600; color: #555; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; border-bottom: 2px solid #1A6B3C20; }
  td { padding: 7px 10px; text-align: center; border-bottom: 1px solid #eee; }
  tr.alt { background: #fafbfa; }
  .summary-box { background: #f8f9fa; border-radius: 8px; padding: 16px; margin-top: 12px; border: 1px solid #e8e8e8; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; }
  .summary-row.total { font-size: 18px; font-weight: 800; color: #1A6B3C; padding: 10px 0 0; }
  .summary-row.savings { color: #34C759; font-weight: 500; }
  .summary-row.sub { font-size: 11px; color: #888; padding: 2px 0; }
  .summary-divider { height: 1px; background: #ddd; margin: 8px 0; }
  .summary-divider.thick { height: 2px; background: #1A6B3C; }
  .schedule-stats { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .schedule-stat { background: #f0f4f2; border-radius: 6px; padding: 8px 14px; font-size: 12px; border: 1px solid #e0e8e4; }
  .schedule-stat strong { color: #1A6B3C; }
  .flag { font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
  .flag.milestone { background: #FFF3E0; color: #FF9500; }
  .flag.critical { background: #FFF0EF; color: #FF3B30; }
  .critical-path-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 16px; }
  .critical-node { background: #FFF0EF; color: #FF3B30; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 500; }
  .critical-arrow { color: #FF3B30; font-weight: 700; }
  .milestones-list { margin-bottom: 16px; }
  .milestone-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
  .milestone-flag { color: #FF9500; }
  .milestone-name { font-weight: 500; flex: 1; }
  .milestone-day { color: #888; font-size: 11px; }
  .signature-section { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; }
  .signature-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  .signature-drawing { margin-bottom: 8px; }
  .signature-line { width: 200px; height: 1px; background: #333; margin-bottom: 8px; margin-top: 40px; }
  .signature-name { font-size: 13px; font-weight: 600; color: #333; }
  .signature-company { font-size: 11px; color: #666; }
  .signature-date { font-size: 11px; color: #888; margin-top: 4px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; font-size: 10px; color: #999; }
  .page-break { page-break-before: always; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  ${companyBlock}
  <div class="project-info">
    <div class="project-name">${escapeHtml(project.name)}</div>
    <div class="project-meta">
      <span>Date: ${now}</span>
      <span>Location: ${escapeHtml(project.location)}</span>
      ${project.squareFootage > 0 ? `<span>Area: ${project.squareFootage.toLocaleString()} sq ft</span>` : ''}
      <span>Type: ${escapeHtml(project.type.replace(/_/g, ' '))}</span>
    </div>
    ${project.description ? `<p style="margin-top:8px;font-size:12px;color:#555">${escapeHtml(project.description)}</p>` : ''}
  </div>
  ${itemsHtml}
  ${scheduleHtml}
  ${signatureBlock}
  <div class="footer">
    ${branding.companyName ? `Generated by ${escapeHtml(branding.companyName)}` : 'Generated by MAGE ID'} · ${now}
    ${branding.phone ? ` · ${escapeHtml(branding.phone)}` : ''}
    ${branding.email ? ` · ${escapeHtml(branding.email)}` : ''}
  </div>
</body>
</html>`;
}

export async function generateEstimatePDFUri(
  project: Project,
  branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildEstimateHtml(project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Estimate PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating estimate PDF URI:', error);
    return null;
  }
}

export async function generateAndSharePDF(
  project: Project,
  branding: CompanyBranding,
  method: 'email' | 'share',
): Promise<void> {
  console.log('[PDF] Generating PDF for project:', project.name, 'method:', method);
  const html = buildEstimateHtml(project, branding);

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }

  try {
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });
    console.log('[PDF] File created at:', uri);

    if (method === 'share') {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${project.name} Estimate`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        console.log('[PDF] Sharing not available, printing instead');
        await Print.printAsync({ uri });
      }
    } else {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${project.name} Estimate`,
        UTI: 'com.adobe.pdf',
      });
    }
  } catch (error) {
    console.error('[PDF] Error generating PDF:', error);
    throw error;
  }
}

function buildChangeOrderHtml(co: ChangeOrder, project: Project, branding: CompanyBranding): string {
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div>
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div></div>`
    : `<div class="company-header"><div class="company-name">Change Order</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:28px; font-weight:800; color:#1A6B3C; }
    .company-info-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 20px; margin-top:10px; }
    .info-item { font-size:11px; color:#555; } .info-label { font-weight:600; color:#333; margin-right:4px; }
    .co-header { background:#f8f9fa; border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #FF9500; }
    .co-title { font-size:20px; font-weight:700; color:#1a1a1a; } .co-meta { font-size:11px; color:#666; margin-top:4px; }
    .status-badge { display:inline-block; padding:4px 12px; border-radius:6px; font-size:11px; font-weight:700; text-transform:uppercase; }
    .status-draft { background:#f0f0f0; color:#666; } .status-sent { background:#EBF3FF; color:#007AFF; }
    .status-approved { background:#E8FAF0; color:#34C759; } .status-rejected { background:#FFF0EF; color:#FF3B30; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    th { background:#1A6B3C08; padding:8px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; letter-spacing:0.5px; border-bottom:2px solid #1A6B3C20; }
    td { padding:7px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .summary-box { background:#f8f9fa; border-radius:8px; padding:16px; border:1px solid #e8e8e8; }
    .summary-row { display:flex; justify-content:space-between; padding:5px 0; font-size:13px; }
    .summary-row.total { font-size:18px; font-weight:800; color:#1A6B3C; padding:10px 0 0; }
    .summary-divider { height:2px; background:#1A6B3C; margin:8px 0; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="co-header">
    <div class="co-title">Change Order #${co.number}</div>
    <div class="co-meta">Project: ${escapeHtml(project.name)} &middot; Date: ${now} &middot; <span class="status-badge status-${co.status}">${co.status}</span></div>
    ${co.description ? `<p style="margin-top:8px;font-size:12px;color:#333">${escapeHtml(co.description)}</p>` : ''}
    ${co.reason ? `<p style="margin-top:4px;font-size:11px;color:#666">Reason: ${escapeHtml(co.reason)}</p>` : ''}
  </div>
  <h2 style="font-size:16px;font-weight:700;color:#1A6B3C;margin:20px 0 12px;border-bottom:2px solid #1A6B3C20;padding-bottom:6px;">Line Items</h2>
  <table><thead><tr>
    <th style="text-align:left;width:35%">Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th style="text-align:right">Total</th>
  </tr></thead><tbody>
    ${co.lineItems.map((item, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(item.name)}${item.isNew ? ' <span style="color:#FF9500;font-size:9px">[NEW]</span>' : ''}</td><td>${item.quantity}</td><td>${escapeHtml(item.unit)}</td><td>${formatCurrency(item.unitPrice)}</td><td style="text-align:right;font-weight:600">${formatCurrency(item.total)}</td></tr>`).join('')}
  </tbody></table>
  <div class="summary-box">
    <div class="summary-row"><span>Original Contract Value</span><span>${formatCurrency(co.originalContractValue)}</span></div>
    <div class="summary-row" style="color:${co.changeAmount >= 0 ? '#FF9500' : '#34C759'}"><span>This Change Order</span><span>${co.changeAmount >= 0 ? '+' : ''}${formatCurrency(co.changeAmount)}</span></div>
    <div class="summary-divider"></div>
    <div class="summary-row total"><span>New Contract Total</span><span>${formatCurrency(co.newContractTotal)}</span></div>
  </div>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e5e5">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:20px">Client Approval</div>
    <div style="display:flex;gap:40px">
      <div><div style="width:200px;height:1px;background:#333;margin-bottom:8px;margin-top:30px"></div><div style="font-size:11px;color:#888">Client Signature</div></div>
      <div><div style="width:120px;height:1px;background:#333;margin-bottom:8px;margin-top:30px"></div><div style="font-size:11px;color:#888">Date</div></div>
    </div>
  </div>
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Change Order #${co.number} &middot; ${now}</div>
</body></html>`;
}

function buildInvoiceHtml(inv: Invoice, project: Project, branding: CompanyBranding): string {
  const now = new Date(inv.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dueDate = new Date(inv.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div>
        ${branding.tagline ? `<div style="font-size:13px;color:#666;margin-top:4px;font-style:italic">${escapeHtml(branding.tagline)}</div>` : ''}
        <div class="company-info-grid">
          ${branding.contactName ? `<div class="info-item"><span class="info-label">Contact</span><span>${escapeHtml(branding.contactName)}</span></div>` : ''}
          ${branding.phone ? `<div class="info-item"><span class="info-label">Phone</span><span>${escapeHtml(branding.phone)}</span></div>` : ''}
          ${branding.email ? `<div class="info-item"><span class="info-label">Email</span><span>${escapeHtml(branding.email)}</span></div>` : ''}
          ${branding.address ? `<div class="info-item"><span class="info-label">Address</span><span>${escapeHtml(branding.address)}</span></div>` : ''}
          ${branding.licenseNumber ? `<div class="info-item"><span class="info-label">License</span><span>${escapeHtml(branding.licenseNumber)}</span></div>` : ''}
        </div></div>`
    : `<div class="company-header"><div class="company-name">Invoice</div></div>`;

  const termsLabel = inv.paymentTerms.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:32px; padding-bottom:24px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:28px; font-weight:800; color:#1A6B3C; }
    .company-info-grid { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 20px; margin-top:10px; }
    .info-item { font-size:11px; color:#555; } .info-label { font-weight:600; color:#333; margin-right:4px; }
    .inv-header { background:linear-gradient(135deg,#f8f9fa,#eef2f0); border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #1A6B3C; display:flex; justify-content:space-between; }
    .inv-title { font-size:20px; font-weight:700; } .inv-meta { font-size:11px; color:#666; margin-top:4px; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    th { background:#1A6B3C08; padding:8px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; letter-spacing:0.5px; border-bottom:2px solid #1A6B3C20; }
    td { padding:7px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .summary-box { background:#f8f9fa; border-radius:8px; padding:16px; border:1px solid #e8e8e8; }
    .summary-row { display:flex; justify-content:space-between; padding:5px 0; font-size:13px; }
    .summary-row.total { font-size:18px; font-weight:800; color:#1A6B3C; padding:10px 0 0; }
    .summary-divider { height:2px; background:#1A6B3C; margin:8px 0; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="inv-header">
    <div>
      <div class="inv-title">${inv.type === 'progress' ? 'Progress Bill' : 'Invoice'} #${inv.number}</div>
      <div class="inv-meta">Project: ${escapeHtml(project.name)}</div>
      ${inv.type === 'progress' && inv.progressPercent ? `<div class="inv-meta">Progress: ${inv.progressPercent}% of contract</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="inv-meta">Issue Date: ${now}</div>
      <div class="inv-meta">Due Date: ${dueDate}</div>
      <div class="inv-meta">Terms: ${termsLabel}</div>
    </div>
  </div>
  <table><thead><tr>
    <th style="text-align:left;width:35%">Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th style="text-align:right">Total</th>
  </tr></thead><tbody>
    ${inv.lineItems.map((item, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${escapeHtml(item.unit)}</td><td>${formatCurrency(item.unitPrice)}</td><td style="text-align:right;font-weight:600">${formatCurrency(item.total)}</td></tr>`).join('')}
  </tbody></table>
  <div class="summary-box">
    <div class="summary-row"><span>Subtotal</span><span>${formatCurrency(inv.subtotal)}</span></div>
    <div class="summary-row"><span>Tax (${inv.taxRate}%)</span><span>${formatCurrency(inv.taxAmount)}</span></div>
    <div class="summary-divider"></div>
    <div class="summary-row total"><span>Total Due</span><span>${formatCurrency(inv.totalDue)}</span></div>
    ${inv.amountPaid > 0 ? `<div class="summary-row" style="color:#34C759"><span>Amount Paid</span><span>-${formatCurrency(inv.amountPaid)}</span></div><div class="summary-row" style="font-weight:700;font-size:14px"><span>Balance Due</span><span>${formatCurrency(inv.totalDue - inv.amountPaid)}</span></div>` : ''}
  </div>
  ${inv.notes ? `<div style="margin-top:20px;padding:14px;background:#f8f9fa;border-radius:8px;border:1px solid #e8e8e8"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:6px">Notes</div><p style="font-size:12px;color:#555">${escapeHtml(inv.notes)}</p></div>` : ''}
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Invoice #${inv.number} &middot; ${now}</div>
</body></html>`;
}

function buildDFRHtml(dfr: DailyFieldReport, project: Project, branding: CompanyBranding): string {
  const reportDate = new Date(dfr.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const logoBlock = branding.logoUri
    ? `<div class="logo-wrap"><img src="${escapeHtml(branding.logoUri)}" class="company-logo" alt="Logo" /></div>` : '';
  const companyBlock = branding.companyName
    ? `<div class="company-header">${logoBlock}<div class="company-name">${escapeHtml(branding.companyName)}</div></div>`
    : `<div class="company-header"><div class="company-name">Daily Field Report</div></div>`;

  const totalWorkers = dfr.manpower.reduce((s, m) => s + m.headcount, 0);
  const totalHours = dfr.manpower.reduce((s, m) => s + (m.headcount * m.hoursWorked), 0);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:#1a1a1a; padding:40px; font-size:12px; line-height:1.5; }
    .company-header { text-align:center; margin-bottom:24px; padding-bottom:20px; border-bottom:3px solid #1A6B3C; }
    .logo-wrap { margin-bottom:12px; } .company-logo { max-height:60px; max-width:240px; object-fit:contain; }
    .company-name { font-size:24px; font-weight:800; color:#1A6B3C; }
    .dfr-header { background:#f8f9fa; border-radius:8px; padding:18px; margin-bottom:24px; border-left:4px solid #1A6B3C; }
    .dfr-title { font-size:18px; font-weight:700; } .dfr-meta { font-size:11px; color:#666; margin-top:4px; }
    h2 { font-size:14px; font-weight:700; color:#1A6B3C; margin:20px 0 10px; padding-bottom:6px; border-bottom:2px solid #1A6B3C20; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:11px; }
    th { background:#1A6B3C08; padding:6px 10px; text-align:center; font-weight:600; color:#555; text-transform:uppercase; font-size:9px; border-bottom:2px solid #1A6B3C20; }
    td { padding:6px 10px; text-align:center; border-bottom:1px solid #eee; }
    tr.alt { background:#fafbfa; }
    .section-content { background:#f8f9fa; border-radius:6px; padding:12px; margin-bottom:12px; font-size:12px; color:#333; }
    .weather-grid { display:flex; gap:12px; margin-bottom:16px; }
    .weather-item { flex:1; background:#f8f9fa; border-radius:6px; padding:10px; text-align:center; }
    .weather-label { font-size:9px; font-weight:600; color:#888; text-transform:uppercase; }
    .weather-value { font-size:14px; font-weight:600; color:#333; margin-top:4px; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #e5e5e5; text-align:center; font-size:10px; color:#999; }
  </style></head><body>
  ${companyBlock}
  <div class="dfr-header">
    <div class="dfr-title">Daily Field Report</div>
    <div class="dfr-meta">Project: ${escapeHtml(project.name)} &middot; ${reportDate}</div>
    <div class="dfr-meta">Location: ${escapeHtml(project.location)}</div>
  </div>
  <h2>Weather</h2>
  <div class="weather-grid">
    <div class="weather-item"><div class="weather-label">Temperature</div><div class="weather-value">${escapeHtml(dfr.weather.temperature || 'N/A')}</div></div>
    <div class="weather-item"><div class="weather-label">Conditions</div><div class="weather-value">${escapeHtml(dfr.weather.conditions || 'N/A')}</div></div>
    <div class="weather-item"><div class="weather-label">Wind</div><div class="weather-value">${escapeHtml(dfr.weather.wind || 'N/A')}</div></div>
  </div>
  <h2>Manpower (${totalWorkers} workers &middot; ${totalHours} man-hours)</h2>
  ${dfr.manpower.length > 0 ? `<table><thead><tr><th style="text-align:left">Trade</th><th>Company</th><th>Headcount</th><th>Hours</th><th>Man-Hours</th></tr></thead><tbody>${dfr.manpower.map((m, i) => `<tr class="${i % 2 === 0 ? 'alt' : ''}"><td style="text-align:left;font-weight:500">${escapeHtml(m.trade)}</td><td>${escapeHtml(m.company || '-')}</td><td>${m.headcount}</td><td>${m.hoursWorked}</td><td>${m.headcount * m.hoursWorked}</td></tr>`).join('')}</tbody></table>` : '<div class="section-content">No manpower entries.</div>'}
  <h2>Work Performed</h2>
  <div class="section-content">${dfr.workPerformed ? escapeHtml(dfr.workPerformed).replace(/\n/g, '<br>') : 'No notes.'}</div>
  ${dfr.materialsDelivered.length > 0 ? `<h2>Materials Delivered</h2><div class="section-content"><ul>${dfr.materialsDelivered.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul></div>` : ''}
  ${dfr.issuesAndDelays ? `<h2>Issues &amp; Delays</h2><div class="section-content" style="border-left:3px solid #FF3B30;background:#FFF0EF">${escapeHtml(dfr.issuesAndDelays).replace(/\n/g, '<br>')}</div>` : ''}
  ${dfr.photos.length > 0 ? `<h2>Photos (${dfr.photos.length})</h2><div class="section-content">${dfr.photos.length} photo(s) attached. See digital copy for images.</div>` : ''}
  <div class="footer">${branding.companyName ? `${escapeHtml(branding.companyName)} &middot; ` : ''}Daily Field Report &middot; ${reportDate}</div>
</body></html>`;
}

export async function generateChangeOrderPDFUri(
  co: ChangeOrder, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildChangeOrderHtml(co, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] CO PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating CO PDF URI:', error);
    return null;
  }
}

export async function generateInvoicePDFUri(
  inv: Invoice, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildInvoiceHtml(inv, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] Invoice PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating invoice PDF URI:', error);
    return null;
  }
}

export async function generateDFRPDFUri(
  dfr: DailyFieldReport, project: Project, branding: CompanyBranding,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildDFRHtml(dfr, project, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[PDF] DFR PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[PDF] Error generating DFR PDF URI:', error);
    return null;
  }
}

export async function generateChangeOrderPDF(
  co: ChangeOrder, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating CO PDF:', co.id);
  const html = buildChangeOrderHtml(co, project, branding);
  await shareHtml(html, `${project.name} - CO #${co.number}`);
}

export async function generateInvoicePDF(
  inv: Invoice, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating Invoice PDF:', inv.id);
  const html = buildInvoiceHtml(inv, project, branding);
  await shareHtml(html, `${project.name} - Invoice #${inv.number}`);
}

export async function generateDFRPDF(
  dfr: DailyFieldReport, project: Project, branding: CompanyBranding,
): Promise<void> {
  console.log('[PDF] Generating DFR PDF:', dfr.id);
  const html = buildDFRHtml(dfr, project, branding);
  await shareHtml(html, `${project.name} - Daily Report`);
}

async function shareHtml(html: string, title: string, method?: 'share' | 'email', recipient?: string, message?: string): Promise<void> {
  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (method === 'email' && recipient) {
      const subject = encodeURIComponent(title);
      const body = encodeURIComponent(message || `Please find attached: ${title}`);
      const mailUrl = `mailto:${recipient}?subject=${subject}&body=${body}`;
      const { openURL } = await import('expo-linking');
      await openURL(mailUrl).catch(() => {});
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    } else {
      await Print.printAsync({ uri });
    }
  } catch (error) {
    console.error('[PDF] Error:', error);
    throw error;
  }
}

export function buildEstimateTextForEmail(
  project: Project,
  branding: CompanyBranding,
): string {
  let text = '';
  const divider = '━'.repeat(40);

  if (branding.companyName) {
    text += `${branding.companyName.toUpperCase()}\n`;
    if (branding.tagline) text += `${branding.tagline}\n`;
    text += `${divider}\n\n`;
  }

  text += `PROJECT ESTIMATE\n`;
  text += `${divider}\n`;
  text += `Project: ${project.name}\n`;
  text += `Location: ${project.location}\n`;
  text += `Date: ${new Date().toLocaleDateString()}\n`;
  if (project.squareFootage > 0) text += `Area: ${project.squareFootage.toLocaleString()} sq ft\n`;
  if (project.description) text += `Description: ${project.description}\n`;
  text += '\n';

  const est = project.linkedEstimate;
  if (est && est.items.length > 0) {
    text += `ITEMS\n${divider}\n`;
    est.items.forEach((item, i) => {
      text += `${i + 1}. ${item.name}\n`;
      text += `   ${item.quantity} ${item.unit} @ ${formatCurrency(item.unitPrice)} (${item.markup}% markup)\n`;
      text += `   Line Total: ${formatCurrency(item.lineTotal)}\n\n`;
    });
    text += `${divider}\n`;
    text += `Base Cost:    ${formatCurrency(est.baseTotal)}\n`;
    text += `Markup:       +${formatCurrency(est.markupTotal)}\n`;
    text += `TOTAL:        ${formatCurrency(est.grandTotal)}\n\n`;
  }

  const legacyEst = project.estimate;
  if (legacyEst && (!est || est.items.length === 0)) {
    text += `COST SUMMARY\n${divider}\n`;
    text += `Materials:     ${formatCurrency(legacyEst.materialTotal)}\n`;
    text += `Labor:         ${formatCurrency(legacyEst.laborTotal)}\n`;
    text += `Permits:       ${formatCurrency(legacyEst.permits)}\n`;
    text += `Overhead:      ${formatCurrency(legacyEst.overhead)}\n`;
    text += `${divider}\n`;
    text += `Subtotal:      ${formatCurrency(legacyEst.subtotal)}\n`;
    text += `Tax:           ${formatCurrency(legacyEst.tax)}\n`;
    text += `Contingency:   ${formatCurrency(legacyEst.contingency)}\n`;
    text += `Bulk Savings:  -${formatCurrency(legacyEst.bulkSavingsTotal)}\n`;
    text += `${divider}\n`;
    text += `GRAND TOTAL:   ${formatCurrency(legacyEst.grandTotal)}\n`;
    if (legacyEst.pricePerSqFt > 0) text += `Per Sq Ft:     ${formatCurrency(legacyEst.pricePerSqFt)}\n`;
    text += '\n';
  }

  const schedule = project.schedule;
  if (schedule && schedule.tasks.length > 0) {
    text += `SCHEDULE\n${divider}\n`;
    text += `Duration: ${schedule.totalDurationDays} days\n`;
    text += `Critical Path: ${schedule.criticalPathDays} days\n`;
    text += `Tasks: ${schedule.tasks.length}\n\n`;
    schedule.tasks.forEach((task, i) => {
      const flags: string[] = [];
      if (task.isMilestone) flags.push('[Milestone]');
      if (task.isCriticalPath) flags.push('[Critical]');
      text += `${i + 1}. ${task.title} ${flags.join(' ')}\n`;
      text += `   ${task.phase} · Day ${task.startDay} · ${task.durationDays}d · ${task.crew} · ${task.progress}%\n`;
    });
    text += '\n';
  }

  if (branding.contactName || branding.phone || branding.email) {
    text += `${divider}\nCONTACT\n`;
    if (branding.contactName) text += `${branding.contactName}\n`;
    if (branding.phone) text += `${branding.phone}\n`;
    if (branding.email) text += `${branding.email}\n`;
    if (branding.address) text += `${branding.address}\n`;
    if (branding.licenseNumber) text += `License: ${branding.licenseNumber}\n`;
  }

  return text;
}

```


---

### `utils/generateId.ts`

```ts
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

```


---

### `utils/formatters.ts`

```ts
export function formatMoney(n: number, decimals = 0): string {
  const abs = Math.abs(n);
  const formatted = '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 ? '-' + formatted : formatted;
}

export function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1000000) formatted = `$${(abs / 1000000).toFixed(1)}M`;
  else if (abs >= 10000) formatted = `$${(abs / 1000).toFixed(0)}K`;
  else formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? '-' + formatted : formatted;
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

```


---

### `utils/analytics.ts`

```ts
type EventProperties = Record<string, string | number | boolean | undefined>;

interface AnalyticsProvider {
  track: (eventName: string, properties?: EventProperties) => void;
}

const consoleProvider: AnalyticsProvider = {
  track: (eventName: string, properties?: EventProperties) => {
    console.log(`[Analytics] ${eventName}`, properties ?? '');
  },
};

let provider: AnalyticsProvider = consoleProvider;

export function setAnalyticsProvider(newProvider: AnalyticsProvider): void {
  provider = newProvider;
}

export function track(eventName: string, properties?: EventProperties): void {
  try {
    provider.track(eventName, properties);
  } catch (err) {
    console.log('[Analytics] Failed to track event:', eventName, err);
  }
}

export const AnalyticsEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_LOGGED_IN: 'user_logged_in',
  USER_LOGGED_OUT: 'user_logged_out',
  PROJECT_CREATED: 'project_created',
  ESTIMATE_GENERATED: 'estimate_generated',
  INVOICE_CREATED: 'invoice_created',
  CHANGE_ORDER_CREATED: 'change_order_created',
  BID_POSTED: 'bid_posted',
  MESSAGE_SENT: 'message_sent',
  SUBSCRIPTION_PURCHASED: 'subscription_purchased',
  DAILY_REPORT_CREATED: 'daily_report_created',
  PUNCH_ITEM_CREATED: 'punch_item_created',
  RFI_CREATED: 'rfi_created',
  SUBMITTAL_CREATED: 'submittal_created',
  EQUIPMENT_ADDED: 'equipment_added',
  CONTACT_ADDED: 'contact_added',
  PDF_GENERATED: 'pdf_generated',
  PHOTO_ADDED: 'photo_added',
} as const;

```


---

### `utils/notifications.ts`

```ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') {
    console.log('[Notifications] Web platform — skipping push registration');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ??
      process.env.EXPO_PUBLIC_PROJECT_ID;

    if (!projectId) {
      console.log('[Notifications] No project ID found for push token');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Notifications] Push token:', tokenData.data);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1A6B3C',
      });
    }

    return tokenData.data;
  } catch (err) {
    console.log('[Notifications] Registration error:', err);
    return null;
  }
}

export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
    console.log('[Notifications] Local notification sent:', title);
  } catch (err) {
    console.log('[Notifications] Failed to send local notification:', err);
  }
}

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
) {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

```


---

### `utils/location.ts`

```ts
import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';

export interface UserLocation {
  latitude: number;
  longitude: number;
}

export function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (Platform.OS === 'web') {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              timeout: 10000,
            });
          });
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          console.log('[Location] Web location obtained:', pos.coords.latitude, pos.coords.longitude);
        } else {
          setError('Geolocation not supported on this browser');
          console.log('[Location] Geolocation not supported on web');
        }
      } else {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission denied');
          console.log('[Location] Permission denied');
          setLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        console.log('[Location] Native location obtained:', loc.coords.latitude, loc.coords.longitude);
      }
    } catch (err: any) {
      console.log('[Location] Error getting location:', err?.message);
      setError(err?.message ?? 'Failed to get location');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void requestLocation();
  }, [requestLocation]);

  return { location, loading, error, refresh: requestLocation };
}

```


---

### `utils/weatherService.ts`

```ts
export interface DayForecast {
  date: string;
  condition: 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'wind';
  tempHigh: number;
  tempLow: number;
  precipChance: number;
  windSpeed: number;
  isWorkable: boolean;
  icon: string;
}

const CONDITION_ICONS: Record<DayForecast['condition'], string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '🌨️',
  wind: '💨',
};

export function getConditionIcon(condition: DayForecast['condition']): string {
  return CONDITION_ICONS[condition] ?? '☀️';
}

export function getSimulatedForecast(startDate: Date, days: number, _region?: string): DayForecast[] {
  const forecasts: DayForecast[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const month = date.getMonth();
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

    const seed = (dayOfYear * 13 + date.getFullYear() * 7) % 100;
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;
    const isSpring = month >= 3 && month <= 4;

    let condition: DayForecast['condition'] = 'clear';
    let precipChance = 10;
    let tempHigh = 75;
    let tempLow = 55;
    let windSpeed = 8;

    if (isWinter) {
      tempHigh = 38 + (seed % 20);
      tempLow = tempHigh - 15;
      precipChance = 25 + (seed % 30);
      condition = seed < 20 ? 'snow' : seed < 45 ? 'cloudy' : seed < 60 ? 'rain' : 'clear';
    } else if (isSummer) {
      tempHigh = 78 + (seed % 20);
      tempLow = tempHigh - 18;
      precipChance = 15 + (seed % 25);
      condition = seed < 10 ? 'storm' : seed < 25 ? 'rain' : seed < 40 ? 'cloudy' : 'clear';
    } else if (isSpring) {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 30 + (seed % 25);
      condition = seed < 15 ? 'storm' : seed < 35 ? 'rain' : seed < 50 ? 'cloudy' : 'clear';
    } else {
      tempHigh = 55 + (seed % 25);
      tempLow = tempHigh - 15;
      precipChance = 20 + (seed % 20);
      condition = seed < 10 ? 'rain' : seed < 30 ? 'cloudy' : 'clear';
    }

    windSpeed = 5 + (seed % 20);
    const isWorkable = condition !== 'storm' && condition !== 'snow' && precipChance < 70 && windSpeed < 30;

    forecasts.push({
      date: date.toISOString().split('T')[0],
      condition,
      tempHigh: Math.round(tempHigh),
      tempLow: Math.round(tempLow),
      precipChance,
      windSpeed: Math.round(windSpeed),
      isWorkable,
      icon: getConditionIcon(condition),
    });
  }
  return forecasts;
}

export function getWeatherRiskForDate(date: string, forecasts: DayForecast[]): DayForecast | null {
  return forecasts.find(f => f.date === date) ?? null;
}

/**
 * Given a project start date and a task's `startDay`/`durationDays` (1-indexed
 * from project start), find the first forecast day that intersects the task
 * and is un-workable. Returns null if the task doesn't overlap any bad-weather
 * day within the known forecast window.
 *
 * Used by the Gantt chart to decide whether a weather-sensitive task gets
 * a yellow warning badge. We only flag the FIRST offending day — otherwise
 * long tasks would get noisy multi-badge displays.
 */
export function findWeatherRisk(
  projectStartDate: Date,
  startDay: number,
  durationDays: number,
  forecasts: DayForecast[],
): DayForecast | null {
  if (forecasts.length === 0) return null;
  for (let offset = 0; offset < Math.max(1, durationDays); offset++) {
    const taskDate = new Date(projectStartDate);
    taskDate.setDate(taskDate.getDate() + (startDay - 1) + offset);
    const iso = taskDate.toISOString().split('T')[0];
    const day = forecasts.find((f) => f.date === iso);
    if (day && !day.isWorkable) return day;
  }
  return null;
}

// ============================================
// OpenWeather integration
// ============================================
// Rate-limit discipline per OpenWeather's guidance:
//   "API calls no more than once in 10 minutes for each location."
// We key a module-level cache by the location identifier and hold the
// resolved forecast for 10 minutes. Subsequent calls for the same location
// inside that window return the cached payload instantly without a fetch.
//
// Endpoint: ALWAYS api.openweathermap.org (not the server IP). Hardcoded
// below — do not parameterize without reading their care notes first.
//
// Free-tier endpoint returns 5 days at 3-hour steps. We condense to one
// entry per day by picking the midday slot (12:00 local). If the caller
// asks for more days than the free tier returns, we pad the tail with
// simulated data so the Gantt keeps rendering warnings for far-future
// tasks. Swap to the paid endpoint later if longer real horizons matter.

const OPENWEATHER_ENDPOINT = 'https://api.openweathermap.org/data/2.5/forecast';
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const weatherCache = new Map<string, { fetchedAt: number; forecast: DayForecast[] }>();

function getApiKey(): string | null {
  // EXPO_PUBLIC_* is inlined into the bundle at build time by Metro.
  // If the key is missing we return null and fall back to simulated data.
  const key = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;
  if (!key || key.trim() === '') return null;
  return key.trim();
}

/** Map OpenWeather "main" + conditions to our internal `DayForecast` bucket. */
function mapOpenWeatherMain(main: string, windMph: number): DayForecast['condition'] {
  const m = main.toLowerCase();
  if (m.includes('thunder')) return 'storm';
  if (m.includes('snow')) return 'snow';
  if (m.includes('rain') || m.includes('drizzle')) return 'rain';
  if (windMph >= 25) return 'wind';
  if (m.includes('cloud')) return 'cloudy';
  return 'clear';
}

interface OpenWeatherListEntry {
  dt: number;
  dt_txt: string;
  main: { temp_max: number; temp_min: number };
  weather: { main: string; description: string }[];
  wind: { speed: number };
  pop?: number; // probability of precipitation, 0..1
}

interface OpenWeatherResponse {
  cod: string | number;
  message?: string | number;
  list?: OpenWeatherListEntry[];
}

/**
 * Collapse the 3-hour forecast list into one entry per day. We pick the
 * slot closest to midday (12:00) as the representative reading — it's
 * the most relevant window for jobsite work and avoids overnight noise.
 * High/low across the whole day are taken from the 24h window, not just
 * the midday slot, so the temp range reflects actual daily extremes.
 */
function condenseToDaily(list: OpenWeatherListEntry[], days: number): DayForecast[] {
  const byDate = new Map<string, OpenWeatherListEntry[]>();
  for (const e of list) {
    const iso = new Date(e.dt * 1000).toISOString().split('T')[0];
    const bucket = byDate.get(iso) ?? [];
    bucket.push(e);
    byDate.set(iso, bucket);
  }
  const out: DayForecast[] = [];
  const sortedDates = Array.from(byDate.keys()).sort();
  for (const iso of sortedDates.slice(0, days)) {
    const entries = byDate.get(iso) ?? [];
    if (entries.length === 0) continue;
    const midday = entries.reduce((best, cur) => {
      const bestDist = Math.abs(new Date(best.dt * 1000).getUTCHours() - 12);
      const curDist = Math.abs(new Date(cur.dt * 1000).getUTCHours() - 12);
      return curDist < bestDist ? cur : best;
    }, entries[0]);
    const tempHigh = Math.max(...entries.map((e) => e.main.temp_max));
    const tempLow = Math.min(...entries.map((e) => e.main.temp_min));
    const windSpeedMph = (midday.wind?.speed ?? 0);
    const precipChance = Math.max(...entries.map((e) => (e.pop ?? 0) * 100));
    const condition = mapOpenWeatherMain(midday.weather?.[0]?.main ?? '', windSpeedMph);
    const isWorkable =
      condition !== 'storm' && condition !== 'snow' && precipChance < 70 && windSpeedMph < 30;
    out.push({
      date: iso,
      condition,
      tempHigh: Math.round(tempHigh),
      tempLow: Math.round(tempLow),
      precipChance: Math.round(precipChance),
      windSpeed: Math.round(windSpeedMph),
      isWorkable,
      icon: getConditionIcon(condition),
    });
  }
  return out;
}

/**
 * Fetch a real forecast from OpenWeather's 5-day/3-hour endpoint.
 * Locate by either a city string (`q=...`) or lat/lng.
 *
 * @param location `{ city }` OR `{ latitude, longitude }`. The cache key
 *   normalizes both forms so e.g. "Austin, TX" vs "Austin,TX" hit the
 *   same cache entry.
 * @param startDate Used to trim the response — days before startDate are
 *   dropped, which matters if the caller's schedule begins in the future.
 * @param days How many days of forecast the caller wants. The free tier
 *   returns up to 5; anything beyond is padded with simulated data.
 * @returns An array of `DayForecast` of length `days`, or null if no API
 *   key is configured / the request failed. Callers should fall back to
 *   `getSimulatedForecast` on null.
 */
export async function getOpenWeatherForecast(
  location: { city: string } | { latitude: number; longitude: number },
  startDate: Date,
  days: number,
): Promise<DayForecast[] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const cacheKey =
    'city' in location
      ? `city:${location.city.trim().toLowerCase().replace(/\s+/g, '')}`
      : `ll:${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;

  const cached = weatherCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < WEATHER_CACHE_TTL_MS) {
    return padWithSimulated(cached.forecast, startDate, days);
  }

  const params = new URLSearchParams({ appid: apiKey, units: 'imperial' });
  if ('city' in location) params.set('q', location.city);
  else {
    params.set('lat', String(location.latitude));
    params.set('lon', String(location.longitude));
  }

  try {
    const res = await fetch(`${OPENWEATHER_ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      console.log('[OpenWeather] non-OK response', res.status);
      return null;
    }
    const data = (await res.json()) as OpenWeatherResponse;
    // OpenWeather signals errors via `cod` not the HTTP status in some cases.
    if (String(data.cod) !== '200' || !data.list) {
      console.log('[OpenWeather] payload error', data.cod, data.message);
      return null;
    }
    const daily = condenseToDaily(data.list, 5);
    weatherCache.set(cacheKey, { fetchedAt: now, forecast: daily });
    return padWithSimulated(daily, startDate, days);
  } catch (err) {
    console.log('[OpenWeather] fetch failed', err);
    return null;
  }
}

/**
 * When the caller asks for more days than OpenWeather returned, fill the
 * tail with simulated data so the Gantt doesn't drop weather badges for
 * far-future weather-sensitive tasks. The real days come first (since
 * they're the most actionable); simulated days are appended contiguously.
 */
function padWithSimulated(
  real: DayForecast[],
  startDate: Date,
  days: number,
): DayForecast[] {
  if (real.length >= days) return real.slice(0, days);
  const lastDate =
    real.length > 0
      ? new Date(real[real.length - 1].date + 'T12:00:00')
      : startDate;
  const simStart = new Date(lastDate);
  simStart.setDate(simStart.getDate() + 1);
  const simDays = days - real.length;
  const sim = getSimulatedForecast(simStart, simDays);
  return [...real, ...sim];
}

/**
 * Convenience wrapper used by the schedule screen: try OpenWeather first,
 * fall back to simulated data. This is the single entry point callers
 * should use so the swap is transparent and the rate-limit cache stays
 * centralized.
 */
export async function getForecastWithFallback(
  location: { city?: string; latitude?: number; longitude?: number },
  startDate: Date,
  days: number,
): Promise<DayForecast[]> {
  const locArg =
    location.latitude != null && location.longitude != null
      ? { latitude: location.latitude, longitude: location.longitude }
      : location.city && location.city.trim() !== ''
      ? { city: location.city }
      : null;
  if (locArg) {
    const real = await getOpenWeatherForecast(locArg, startDate, days);
    if (real) return real;
  }
  return getSimulatedForecast(startDate, days);
}

```


---

### `components/ErrorBoundary.tsx`

```tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    console.log('[ErrorBoundary] Caught error:', error.message);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log('[ErrorBoundary] Error details:', error.message);
    console.log('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleReset = () => {
    console.log('[ErrorBoundary] Resetting error state');
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <AlertTriangle size={32} color="#FF3B30" strokeWidth={1.8} />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              {this.props.fallbackMessage || 'The app encountered an unexpected error. Please try again.'}
            </Text>
            {this.state.error && (
              <ScrollView style={styles.errorBox} horizontal={false}>
                <Text style={styles.errorText}>{this.state.error.message}</Text>
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.retryButton}
              onPress={this.handleReset}
              activeOpacity={0.8}
              testID="error-boundary-retry"
            >
              <RefreshCw size={16} color="#FFFFFF" strokeWidth={2} />
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFF0EF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#000000',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: 'rgba(60,60,67,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 12,
    width: '100%',
    maxHeight: 80,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    fontFamily: 'monospace',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A6B3C',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
});

```
