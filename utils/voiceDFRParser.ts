import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { DailyFieldReport, ProjectPhoto } from '@/types';

const DFRSchema = z.object({
  weather: z.object({
    temperature: z.string().optional(),
    conditions: z.string().optional(),
    wind: z.string().optional(),
  }).optional(),
  manpower: z.array(z.object({
    trade: z.string(),
    company: z.string().optional(),
    headcount: z.number().optional(),
    hoursWorked: z.number().optional(),
  })).optional(),
  workPerformed: z.string().optional(),
  materialsDelivered: z.array(z.string()).optional(),
  issuesAndDelays: z.string().optional(),
});

// Build a photo-context block — captions, timestamps, GPS labels — so the AI
// can fold what it sees in the photos into the DFR alongside the voice
// transcript. We don't (yet) send the actual image bytes; mageAI is
// text-only. Captions + GPS go a long way: the user typically tags photos
// like "framing 2nd floor north", "window install rough opening", etc.
function buildPhotoContext(photos: ProjectPhoto[] | undefined): string {
  if (!photos || photos.length === 0) return '';
  const lines = photos.slice(0, 30).map((p, i) => {
    const time = p.timestamp
      ? new Date(p.timestamp).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
      : null;
    const parts = [
      `[${i + 1}]`,
      p.tag ? `tag: ${p.tag}` : null,
      p.location ? `location: ${p.location}` : null,
      p.locationLabel ? `gps: ${p.locationLabel}` : null,
      time ? `at ${time}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });
  return `\n\nSITE PHOTOS TAKEN TODAY (use as additional context — describe what was actually photographed if relevant):\n${lines.join('\n')}\n`;
}

export async function parseDFRFromTranscript(
  transcript: string,
  _projectId: string,
  photos?: ProjectPhoto[],
): Promise<Partial<DailyFieldReport>> {
  console.log('[VoiceDFR] Parsing transcript into DFR fields' + (photos?.length ? ` with ${photos.length} photo(s)` : ''));

  try {
    const photoCtx = buildPhotoContext(photos);
    const aiResult = await mageAI({
      prompt: `You are a construction daily field report parser. Extract structured data from this voice transcript of a field worker describing their day on a construction site. Extract: weather conditions, manpower headcount by trade, work performed description, materials delivered, and any issues or delays mentioned. Be thorough but only extract what was actually said.${photoCtx}\n\nTranscript:\n${transcript}`,
      schema: DFRSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceDFR] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'AI unavailable');
    }

    const result = aiResult.data;
    console.log('[VoiceDFR] Parsed DFR fields successfully');

    const partial: Partial<DailyFieldReport> = {};

    if (result.weather) {
      partial.weather = {
        temperature: result.weather.temperature ?? '',
        conditions: result.weather.conditions ?? '',
        wind: result.weather.wind ?? '',
        isManual: false,
      };
    }

    if (result.manpower && result.manpower.length > 0) {
      partial.manpower = result.manpower.map((m: any, i: number) => ({
        id: `mp-voice-${Date.now()}-${i}`,
        trade: m.trade ?? '',
        company: m.company ?? '',
        headcount: m.headcount ?? 1,
        hoursWorked: m.hoursWorked ?? 8,
      }));
    }

    if (result.workPerformed) {
      partial.workPerformed = result.workPerformed;
    }

    if (result.materialsDelivered && result.materialsDelivered.length > 0) {
      partial.materialsDelivered = result.materialsDelivered;
    }

    if (result.issuesAndDelays) {
      partial.issuesAndDelays = result.issuesAndDelays;
    }

    return partial;
  } catch (err) {
    console.log('[VoiceDFR] Parse failed:', err);
    throw err;
  }
}

// Photos-only DFR draft. The user took photos through the day with
// captions / GPS tags; we use those as the narrative source. Pairs nicely
// with the schedule-based generator and the voice generator — every
// possible source of context can drive the same draft.
export async function generateDFRFromPhotos(
  photos: ProjectPhoto[],
  weatherStr: string,
  projectName: string,
): Promise<Partial<DailyFieldReport>> {
  if (!photos || photos.length === 0) {
    throw new Error('No photos provided');
  }
  console.log('[VoiceDFR] Generating DFR draft from', photos.length, 'photo(s)');
  const photoCtx = buildPhotoContext(photos);

  const aiResult = await mageAI({
    prompt: `You are a construction superintendent writing today's daily field report for ${projectName}. The only context you have is the photos taken on site today (with captions and GPS tags) plus the weather. Infer what work was performed and what trades were on site based ONLY on the photo metadata. Be specific but DON'T invent things you can't reasonably infer from the photos.

WEATHER: ${weatherStr || 'Not specified'}
${photoCtx}

Produce a draft DFR. The "workPerformed" field should read like a professional super's narrative ("North wall framing complete on 2nd floor; window subcontractor staged Marvin units in the garage"). For manpower, only include trades you can clearly infer were on site from the photos.`,
    schema: DFRSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI unavailable');
  }
  const result = aiResult.data;
  const partial: Partial<DailyFieldReport> = {};
  if (result.weather) {
    partial.weather = {
      temperature: result.weather.temperature ?? '',
      conditions: result.weather.conditions ?? '',
      wind: result.weather.wind ?? '',
      isManual: false,
    };
  }
  if (result.manpower && result.manpower.length > 0) {
    partial.manpower = result.manpower.map((m: any, i: number) => ({
      id: `mp-photo-${Date.now()}-${i}`,
      trade: m.trade ?? '',
      company: m.company ?? '',
      headcount: m.headcount ?? 1,
      hoursWorked: m.hoursWorked ?? 8,
    }));
  }
  if (result.workPerformed) partial.workPerformed = result.workPerformed;
  if (result.materialsDelivered && result.materialsDelivered.length > 0) {
    partial.materialsDelivered = result.materialsDelivered;
  }
  if (result.issuesAndDelays) partial.issuesAndDelays = result.issuesAndDelays;
  return partial;
}
