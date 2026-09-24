// utils/prequalToken.ts — the prequal magic-link token, from a CSPRNG.
//
// The I/O half of the token: expo-crypto's getRandomBytes (the platform
// CSPRNG on iOS/Android, crypto.getRandomValues on web). The character
// mapping is pure and lives in prequalEngine.prequalTokenFromBytes, where the
// validator executes it. Same split as utils/bidInvites.ts, and for the same
// reason: generateId's Math.random fallback is fine for a row id and not for
// the only credential between a stranger and a sub's insurance answers.
//
// Tokens minted before this (24 characters, Math.random) keep working — the
// lookup RPC matches on equality and has no length floor.

import * as Crypto from 'expo-crypto';
import { prequalTokenFromBytes } from '@/utils/prequalEngine';

export function generatePrequalToken(): string {
  // 64 bytes give ~54 usable characters after rejection sampling; 32 are
  // needed. Running short is astronomically rare — draw again, never pad.
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = prequalTokenFromBytes(Crypto.getRandomBytes(64));
    if (token) return token;
  }
  throw new Error('Could not generate a secure prequal link token.');
}
