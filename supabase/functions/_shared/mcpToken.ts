// _shared/mcpToken.ts — token minting + hashing shared by the `mcp` server
// (which verifies an incoming token) and `mcp-token` (which issues them).
//
// The raw token is a high-entropy random string prefixed so it's recognizable
// in logs/UI. We persist only its SHA-256 hash; the raw value is returned to
// the user exactly once. Both functions run on Deno, so we use Web Crypto
// (crypto.getRandomValues + crypto.subtle.digest) — no npm deps.

export const TOKEN_PREFIX = "mage_mcp_";

/** Generate a fresh raw token: prefix + 32 bytes of base64url randomness. */
export function generateMcpToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64url = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return TOKEN_PREFIX + b64url;
}

/** SHA-256 of the raw token, lowercase hex. This is what we store + match on. */
export async function hashMcpToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw.trim());
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** First 13 chars (prefix + 4) for display — never enough to reconstruct. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, TOKEN_PREFIX.length + 4);
}
