import type { CrewMember, TradeCategory, WorkerProfile } from '@/types';

// Marketplace surfacing guard. A CrewMember surfaces as a Hire WorkerProfile
// ONLY when it is public, claimed by a worker, AND the launch flag is on.
// HIRE_ENABLED stays false for now, so this returns false in production —
// flipping the flag lights up verified listings with no rebuild.
export function shouldSurfaceToMarketplace(
  member: { isPublic: boolean; claimedByUserId?: string },
  hireEnabled: boolean,
): boolean {
  return member.isPublic && !!member.claimedByUserId && hireEnabled;
}

const TRADE_CATEGORY_MAP: Record<string, TradeCategory> = {
  laborer: 'general_laborer', 'general laborer': 'general_laborer',
  carpenter: 'carpenter', electrician: 'electrician', plumber: 'plumber',
  hvac: 'hvac_tech', 'hvac tech': 'hvac_tech', welder: 'welder', mason: 'mason',
  painter: 'painter', roofer: 'roofer', drywall: 'drywall', flooring: 'flooring',
  concrete: 'concrete_worker', demolition: 'demolition', glazier: 'glazier',
};

function mapTradeToCategory(trade: string): TradeCategory {
  return TRADE_CATEGORY_MAP[trade.trim().toLowerCase()] ?? 'general_laborer';
}

/** Pure mapper: a claimed/public CrewMember → a marketplace WorkerProfile.
 *  Called only when shouldSurfaceToMarketplace(...) is true (i.e. gated). */
export function crewMemberToWorkerProfile(cm: CrewMember): WorkerProfile {
  return {
    id: cm.marketplaceProfileId ?? cm.id,
    name: cm.fullName,
    tradeCategory: mapTradeToCategory(cm.trades[0] ?? ''),
    yearsExperience: 0,
    licenses: cm.idVerified ? ['ID Verified'] : [],
    city: '',
    state: '',
    availability: 'available',
    hourlyRate: 0,
    bio: '',
    pastProjects: [],
    contactEmail: cm.email ?? '',
    phone: cm.phone ?? '',
    createdAt: cm.createdAt,
  };
}
