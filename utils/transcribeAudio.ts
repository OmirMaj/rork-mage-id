// transcribeAudio — client-side wrapper for the MAGE speech-to-text proxy.
//
// The app used to POST recorded audio straight to a third-party STT host,
// which leaked that vendor's domain into the shipped bundle. Now every
// transcription goes through our own `transcribe-audio` Supabase Function
// (see supabase/functions/transcribe-audio), so the only host the client
// talks to is mageid.app's Supabase project. Callers get back the plain
// transcript string (or throw with a human-readable message).
//
// Both recording surfaces (VoiceCaptureModal, OAC meeting upload) use this
// so the upload contract stays in exactly one place.

import { supabase } from '@/lib/supabase';
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

/** The `{ uri, name, type }` file shape React Native FormData accepts. */
export interface AudioFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Upload an audio file to the STT proxy and return the transcript.
 * Throws an Error with a user-facing message on any failure so callers
 * can surface `err.message` directly.
 */
export async function transcribeAudio(file: AudioFile): Promise<string> {
  const formData = new FormData();
  // RN FormData accepts the file descriptor shape; cast for the web typings.
  formData.append('audio', file as unknown as Blob);

  // verify_jwt is on for the function, so send the signed-in user's token.
  // Fall back to the anon key (itself a valid JWT) so the gateway never
  // rejects the request outright if the session is briefly unavailable.
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token || SUPABASE_ANON_KEY;

  let resp: Response;
  try {
    resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/transcribe-audio`, {
      method: 'POST',
      headers: {
        // NOTE: do NOT set Content-Type — fetch adds it with the multipart
        // boundary automatically once the body is a FormData.
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });
  } catch (err) {
    throw new Error(`Transcription service unreachable. ${err instanceof Error ? err.message : ''}`.trim());
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    let parsed = '';
    try {
      parsed = (JSON.parse(detail)?.error as string) || '';
    } catch {
      parsed = detail.slice(0, 160);
    }
    throw new Error(`Transcription server returned ${resp.status}. ${parsed}`.trim());
  }

  const jsonBody = await resp.json().catch(() => ({}));
  return String(jsonBody?.text ?? jsonBody?.transcript ?? '').trim();
}
