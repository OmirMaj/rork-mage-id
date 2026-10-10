// utils/demoJob/planSheets.ts — the Demo Job's three plan sheets (pure).
//
// The sheets are drawn by scripts/demo-job/draw-plans.ts from the same rooms
// the Living Model is made of (utils/demoJob/model.ts), and bundled as PNG
// files in assets/demo-job/. This file is only the list: which sheets there
// are, what each is called, and how large its image is. The `require` of each
// image lives in hooks/useDemoJobPorts.ts, the builder's one link to the app.
//
// Every sheet says "Sample Drawing, Not for Construction" in its title block.
// There is no seal, no signature and no licence number on any of them.

/** Every sheet image is this size, in pixels. */
export const PLAN_IMAGE = { w: 2400, h: 1600 } as const;

export const PROJECT_TITLE = 'Harbor Point Mixed-Use';
/** The street does not exist (utils/demoJob/world.ts). */
export const ADDRESS = ['1400 Example Wharf Street', 'Baltimore, Maryland'] as const;
export const ARCHITECT = 'Sample Architects';

export interface DemoPlanSheet {
  /** The file's name in assets/demo-job/, without ".png". */
  key: 'a-101' | 'a-102' | 'a-301';
  sheetNumber: string;
  /** The sheet's name in the app. Starts with "Sample", so nobody takes it for a real drawing in a list. */
  name: string;
  /** The sheet title as the title block prints it. */
  titleLines: readonly string[];
}

export const DEMO_PLAN_SHEETS: readonly [DemoPlanSheet, DemoPlanSheet, DemoPlanSheet] = [
  { key: 'a-101', sheetNumber: 'A-101', name: 'Sample Level 1 Floor Plan', titleLines: ['Level 1', 'Floor Plan'] },
  { key: 'a-102', sheetNumber: 'A-102', name: 'Sample Typical Floor Plan, Levels 2 to 7', titleLines: ['Typical Floor Plan', 'Levels 2 to 7'] },
  { key: 'a-301', sheetNumber: 'A-301', name: 'Sample Building Section', titleLines: ['Building', 'Section'] },
];

type SheetRow = { projectId?: string | null; sheetNumber?: string | null; superseded?: boolean | null };

/**
 * True when the job already has a current sheet with this sheet's NUMBER,
 * whatever it is called. The app files a new sheet over the current one with
 * the same number (utils/planSheetBatchCore `sameSheet`), so adding "A-101"
 * to a job that has an A-101 would push his aside as an old revision. A sheet
 * he renamed, or one he uploaded himself under that number, therefore counts
 * as there, and Finish Creating leaves it alone. So does the tutorial's A-101
 * on a demo job made before the builder had sheets of its own.
 */
export function hasDemoSheet(sheets: readonly SheetRow[], projectId: string, sheet: DemoPlanSheet): boolean {
  return sheets.some((s) => s.projectId === projectId && s.sheetNumber === sheet.sheetNumber && !s.superseded);
}
