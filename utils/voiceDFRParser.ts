import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { DailyFieldReport } from '@/types';

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

export async function parseDFRFromTranscript(
  transcript: string,
  _projectId: string,
): Promise<Partial<DailyFieldReport>> {
  console.log('[VoiceDFR] Parsing transcript into DFR fields');

  try {
    const aiResult = await mageAI({
      prompt: `You are a construction daily field report parser. Extract structured data from this voice transcript of a field worker describing their day on a construction site. Extract: weather conditions, manpower headcount by trade, work performed description, materials delivered, and any issues or delays mentioned. Be thorough but only extract what was actually said.\n\nTranscript:\n${transcript}`,
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
