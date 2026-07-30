// components/subs — the sub-facing surface of the network loop.
//
// Everything in here renders a SubNetworkProfile from utils/subNetwork and
// nothing else. Keep it that way: these components are the only ones in the app
// that a subcontractor is allowed to see, so they must never reach into
// ProjectContext, commitments, estimates, or any GC-side cost data.

export { SubCredentialCard } from './SubCredentialCard';
export { SubWorkHistoryList } from './SubWorkHistoryList';
export { SubReferralCard } from './SubReferralCard';
export { SubNetworkProfileView } from './SubNetworkProfileView';
