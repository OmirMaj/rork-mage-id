// utils/learn/certificateClient.ts — the app side of an app-skill certificate:
// ask the server to issue one, list his own, and build the public verify link.
//
// NOT ROUTED THROUGH utils/offlineQueue.ts, ON PURPOSE. CLAUDE.md sends every
// Supabase WRITE through the offline queue so an airplane-mode edit lands
// later. Issuing a certificate is not a table write: the client has no insert
// on app_skill_certificates (RLS), and the skill-certificate-award function
// re-grades the answers against its own key (SKILL_QUIZ_KEY) before it writes
// anything. Queuing it would replay a grading call blind. Instead a pass that
// cannot reach the server is kept as a PENDING award on this device
// (utils/learn/skillsProgress.ts) and the screen says "passed, not issued
// yet" until the server answers.
//
// The answer → AwardResult mapping is pure and lives in quizEngine
// (awardResultFrom, certificateFromRow), where the validator drives it.
//
// Contract (implemented by LEARNCERT): POST /skill-certificate-award, JWT
// required, body { topic, quizVersion, answers, holderName };
//   200 { passed: false, correct, total }
//   200 { passed: true, certificate: { id, topic, quiz_version, correct, total,
//         holder_name, verify_code, issued_at, revoked_at } }
//   400 bad_request | bad_name · 409 quiz_changed · 410 revoked · 429 rate_limited.
// A 400's own `error` code is read (utils/edgeError, the one body reader) so
// only bad_name gets the name copy; any other 400 says the attempt itself was
// refused and is not re-sent unchanged.
// A name the server would refuse (cleanHolderName → '') is not sent at all:
// it answers 'rejected' here without spending one of the hourly tries.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';
import { edgeErrorStatus, readEdgeError } from '@/utils/edgeError';
import { useAuth } from '@/contexts/AuthContext';
import type { SkillCertificate, SkillTopicId } from './types';
import { AWARD_MESSAGES, awardResultFrom, certificateFromRow, cleanHolderName, type AwardOutcome } from './quizEngine';

/** How long an award may take before it is treated as unreachable (and kept
 *  as a pending award to send again). */
const AWARD_TIMEOUT_MS = 20_000;

export interface AwardInput {
  topic: SkillTopicId;
  quizVersion: number;
  answers: Record<string, string>;
  holderName: string;
}

export async function awardSkillCertificate(input: AwardInput): Promise<AwardOutcome> {
  const holderName = cleanHolderName(input.holderName);
  if (!holderName) return { ok: false, reason: 'rejected', message: AWARD_MESSAGES.rejected };
  const body = {
    topic: input.topic,
    quizVersion: input.quizVersion,
    answers: input.answers,
    holderName,
  };
  try {
    const { data, error } = await invokeWithTimeout<unknown>('skill-certificate-award', { body, timeoutMs: AWARD_TIMEOUT_MS });
    // The function answers { error: '<code>' }: readEdgeError hands that back
    // as `message` (its `code` is '' then), or `http_400` for a body that is
    // not JSON — which is not a name code, so it reads as bad_request.
    let errorCode: string | null = null;
    if (error && edgeErrorStatus(error) === 400) {
      const info = await readEdgeError(error, 'skill-certificate-award');
      errorCode = info.code || info.message;
    }
    const result = awardResultFrom(data, error, input.topic, errorCode);
    if (result.ok && result.passed) rememberCertificate(result.certificate);
    return result;
  } catch {
    // A thrown fetch (no signal) — nothing reached the function.
    return awardResultFrom(null, { message: 'network' }, input.topic);
  }
}

const COLUMNS = 'id, topic, quiz_version, correct, total, holder_name, verify_code, issued_at, revoked_at';

let lastKnown: { userId: string | null; certs: SkillCertificate[] } | null = null;

/** The newest list this session read for `userId` (the tutorial finale reads
 *  it so the skills-check door does not wait on the network), or null. */
export function lastKnownCertificates(userId: string | null): SkillCertificate[] | null {
  return lastKnown && lastKnown.userId === userId ? lastKnown.certs : null;
}

function rememberCertificate(cert: SkillCertificate): void {
  if (!lastKnown) return;
  lastKnown = { ...lastKnown, certs: [cert, ...lastKnown.certs.filter(c => c.id !== cert.id)] };
}

/** His own certificates, newest first (RLS limits the rows to the caller).
 *  Throws on a failed read so React Query keeps the last good list instead of
 *  showing an empty one. Rows that do not parse are dropped. */
export async function listMyCertificates(userId: string | null = null): Promise<SkillCertificate[]> {
  const { data, error } = await supabase
    .from('app_skill_certificates')
    .select(COLUMNS)
    .order('issued_at', { ascending: false });
  if (error) throw new Error(error.message || 'Could not load certificates');
  const certs = (Array.isArray(data) ? data : []).map(certificateFromRow).filter((c): c is SkillCertificate => c !== null);
  lastKnown = { userId, certs };
  return certs;
}

export const SKILL_CERTIFICATES_QUERY_ROOT = 'skill-certificates';

/** His certificates through React Query, keyed by user so one account's list
 *  never shows on the next. Off while signed out. */
export function useMyCertificates() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return useQuery({
    queryKey: [SKILL_CERTIFICATES_QUERY_ROOT, userId],
    queryFn: () => listMyCertificates(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/** The public verify page for a certificate (noindex; LEARNCERT). */
export function verifyUrl(code: string): string {
  return `https://mageid.app/skills/${encodeURIComponent(code)}`;
}
