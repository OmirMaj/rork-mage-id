// One definition of "the request never reached the server" (CONTRACT 15),
// shared by offlineQueue's isNetworkError, the root react-query retry
// predicate and useProjectRole/resolveRoleState, so the three cannot drift.
//
// Deliberately NOT matched: a bare 'timeout' or 'abort' inside a server
// message. Postgres 57014 ("canceling statement due to statement timeout")
// is the server answering — retrying it as transient would hammer a query
// that will time out again.
export const TRANSPORT_ERROR_RE = /network request (failed|timed out)|failed to fetch|network ?error|load failed|the network connection was lost|internet connection appears to be offline|timed out/i;

function textOf(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** True when `err` is a transport failure (offline, DNS, dropped socket,
 *  fetch aborted) rather than an answer from the server. */
export function isTransportError(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof TypeError) return true;
  if (typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return true;
  if (typeof err === 'string') return TRANSPORT_ERROR_RE.test(err);
  if (typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown };
    const message = textOf(o.message);
    if (message != null && TRANSPORT_ERROR_RE.test(message)) return true;
    const inner = textOf(o.error);
    if (inner != null && TRANSPORT_ERROR_RE.test(inner)) return true;
  }
  return TRANSPORT_ERROR_RE.test(String(err));
}
