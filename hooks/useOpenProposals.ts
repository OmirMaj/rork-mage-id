// hooks/useOpenProposals.ts — the sent-but-unsigned proposals Waiting On chases.
//
// One read on mount, no polling. A failed read is kept apart from "none sent":
// Waiting On says it couldn't check rather than showing an empty list that
// reads as "nobody owes you an answer".
import { useEffect, useState } from 'react';
import { fetchOpenProposals } from '@/utils/contractEngine';
import type { ProposalChaseInput } from '@/utils/systemOfAction';

export type OpenProposalsState =
  | { status: 'loading' }
  | { status: 'ok'; rows: ProposalChaseInput[] }
  | { status: 'failed'; error: string };

export function useOpenProposals(): OpenProposalsState {
  const [state, setState] = useState<OpenProposalsState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    fetchOpenProposals()
      .then(res => {
        if (!alive) return;
        setState(res.ok ? { status: 'ok', rows: res.rows } : { status: 'failed', error: res.error });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      });
    return () => { alive = false; };
  }, []);
  return state;
}
