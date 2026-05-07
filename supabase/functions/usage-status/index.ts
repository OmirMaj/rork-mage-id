// usage-status — read the authenticated user's monthly AI quota usage
// without incrementing anything.
//
// Powers the "X of Y pages remaining this month" badge in the upload UI
// (Plans + Takeoff screens). The client polls this when the user first
// reaches an upload surface so they see their headroom BEFORE they pick
// a file — and we can render a "this 80-page PDF won't fit, you have
// 30 left" guardrail with an Upgrade CTA when the math doesn't work.
//
// Pre-fix the only way for a user to learn they were over-cap was to
// upload, wait, and watch it fail. Surfacing usage proactively turns a
// bad surprise into a planning signal.
//
// Returns:
//   {
//     tier: 'free' | 'pro' | 'business' | 'enterprise',
//     features: {
//       takeoff_pages:  { used, cap, remaining },
//       ai_text:        { used, cap, remaining },
//       analyze_drawings: { used, cap, remaining },
//       analyze_photos: { used, cap, remaining },
//     }
//   }
//
// Cheap call: ~80ms, no AI work, no Cloudconvert. Read-only Postgres
// RPC. Free for any tier (no cap consumed by checking your own caps).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireTier, MONTHLY_CAPS, aiUsageGet } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const TRACKED_FEATURES = ['takeoff_pages', 'ai_text', 'analyze_drawings', 'analyze_photos', 'convert_pdf'] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    // Any signed-in tier can read their own usage — including free, since
    // the upload UI on lower tiers should still show "0 of 0 pages" so
    // the upgrade CTA renders cleanly.
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'usage_status');
    if (!auth.ok) return json(auth.body, auth.status);

    // Parallel fetch — keeps p99 under 100ms even though we call N RPC
    // round-trips. Could collapse to a single ai_usage_summary call if
    // we ever need to scale this further; for now N is small (5).
    const counts = await Promise.all(
      TRACKED_FEATURES.map(f => aiUsageGet(auth.userId, f).then(used => [f, used] as const)),
    );

    const features: Record<string, { used: number; cap: number; remaining: number }> = {};
    for (const [feature, used] of counts) {
      const cap = MONTHLY_CAPS[auth.tier][feature] ?? 0;
      features[feature] = { used, cap, remaining: Math.max(0, cap - used) };
    }

    return json({ tier: auth.tier, features });
  } catch (err) {
    console.error('[usage-status] error:', err);
    return json({ success: false, error: String(err) }, 500);
  }
});
