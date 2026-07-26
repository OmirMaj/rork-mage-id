#!/usr/bin/env bun
// scripts/validate-portfolio-pipeline.ts
// Pinned validator for buildPipelineHorizon.
// Covers: pipeline$, CRM win rate, outbound rate, expected inflow,
// backlog, load windows, null-under-threshold win rate, never throws.

import { buildPipelineHorizon } from '../utils/portfolio/pipelineHorizon';
import type { Lead, Project, Invoice, ChangeOrder, Commitment } from '../types';
import type { HomeownerBidResponse } from '../types';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

const NOW = new Date('2026-07-25T12:00:00Z');

const baseLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: 'l1',
  name: 'Alice',
  source: 'referral',
  stage: 'proposal',
  receivedAt: NOW.toISOString(),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  budgetMin: 100_000,
  budgetMax: 150_000,
  ...overrides,
} as Lead);

const baseBidResponse = (overrides: Partial<HomeownerBidResponse> = {}): HomeownerBidResponse => ({
  id: 'br1',
  bidId: 'bid1',
  proposerUserId: 'u1',
  proposerName: 'GC',
  estimateAmount: 80_000,
  viewSiteRequested: false,
  status: 'submitted',
  submittedAt: NOW.toISOString(),
  ...overrides,
});

// ── Test 1: CRM win rate and pipeline value ────────────────────────────────

console.log('\nTest 1: CRM win rate + pipeline$');
{
  const leads: Lead[] = [
    baseLead({ id: 'l1', stage: 'proposal', budgetMin: 100_000, budgetMax: 100_000 }),
    baseLead({ id: 'l2', stage: 'won' }),
    baseLead({ id: 'l3', stage: 'won' }),
    baseLead({ id: 'l4', stage: 'lost' }),
  ];
  const result = buildPipelineHorizon({
    leads, projects: [], invoices: [], changeOrders: [], commitments: [],
    bidResponses: [], now: NOW,
  });
  assert('leadPipeline$ = 100K (1 pipeline lead at midpoint)', result.leadPipeline$ === 100_000);
  assert('leadCount = 1', result.leadCount === 1);
  // CRM: 3 decided (2 won, 1 lost) → win rate = 2/3 ≈ 66.7%
  assert('crmWinRate ≈ 66.7%', result.winRates.crm !== null && Math.abs(result.winRates.crm - 2/3) < 0.001, `got ${result.winRates.crm}`);
  // Expected inflow = 100K × 2/3 ≈ 66.7K
  assert('expectedInflow$ ≈ 66.7K', result.expectedInflow$ > 60_000 && result.expectedInflow$ < 70_000);
}

// ── Test 2: CRM win rate null when < 3 decided ────────────────────────────

console.log('\nTest 2: CRM win rate null under threshold');
{
  const leads: Lead[] = [
    baseLead({ id: 'l1', stage: 'won' }),
    baseLead({ id: 'l2', stage: 'lost' }),
  ];
  const result = buildPipelineHorizon({
    leads, projects: [], invoices: [], changeOrders: [], commitments: [],
    bidResponses: [], now: NOW,
  });
  assert('crmWinRate null when 2 decided', result.winRates.crm === null);
}

// ── Test 3: Outbound win rate from bid_responses ──────────────────────────

console.log('\nTest 3: Outbound win rate from bid_responses');
{
  const brs: HomeownerBidResponse[] = [
    baseBidResponse({ id: 'br1', status: 'awarded', estimateAmount: 100_000 }),
    baseBidResponse({ id: 'br2', status: 'awarded', estimateAmount: 100_000 }),
    baseBidResponse({ id: 'br3', status: 'declined', estimateAmount: 100_000 }),
  ];
  const result = buildPipelineHorizon({
    leads: [], projects: [], invoices: [], changeOrders: [], commitments: [],
    bidResponses: brs, now: NOW,
  });
  assert('outbound win rate = 2/3', result.winRates.outbound !== null && Math.abs(result.winRates.outbound - 2/3) < 0.001);
}

// ── Test 4: pendingBids$ from submitted responses ─────────────────────────

console.log('\nTest 4: pendingBids$ counted from submitted bids');
{
  const brs: HomeownerBidResponse[] = [
    baseBidResponse({ id: 'br1', status: 'submitted', estimateAmount: 50_000 }),
    baseBidResponse({ id: 'br2', status: 'shortlisted', estimateAmount: 60_000 }),
    baseBidResponse({ id: 'br3', status: 'awarded', estimateAmount: 70_000 }), // decided
  ];
  const result = buildPipelineHorizon({
    leads: [], projects: [], invoices: [], changeOrders: [], commitments: [],
    bidResponses: brs, now: NOW,
  });
  assert('pendingBids$ = 110K (submitted + shortlisted)', result.pendingBids$ === 110_000);
  assert('pendingBidsCount = 2', result.pendingBidsCount === 2);
}

// ── Test 5: load windows are 3 ────────────────────────────────────────────

console.log('\nTest 5: Three load windows returned');
{
  const result = buildPipelineHorizon({
    leads: [], projects: [], invoices: [], changeOrders: [], commitments: [],
    bidResponses: [], now: NOW,
  });
  assert('3 load windows', result.loadWindows.length === 3);
  assert('first window starts at now', result.loadWindows[0]!.startISO === NOW.toISOString().slice(0, 10));
  assert('loadCaveat present', result.loadCaveat.length > 0);
}

// ── Test 6: never throws on empty input ───────────────────────────────────

console.log('\nTest 6: Empty input — never throws');
{
  let threw = false;
  try {
    buildPipelineHorizon({
      leads: [], projects: [], invoices: [], changeOrders: [], commitments: [],
      bidResponses: [], now: NOW,
    });
  } catch {
    threw = true;
  }
  assert('did not throw', !threw);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nportfolio-pipeline: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
