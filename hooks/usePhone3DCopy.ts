// hooks/usePhone3DCopy.ts — the strings of the phone's 3D view (the Living
// Model, lane PHONE3D). Every string goes through t('office.livingModelPhone.*',
// english), so the i18n registry stays in one file (surface
// 'office.living-model-phone', Spanish in i18n/catalog/es/office/livingModelPhone.ts).
// The rest of the Living Model's words stay in hooks/useLivingModelCopy.ts.
//
// WORDING (docs/VOICE.md): `Body` is one or more whole sentences in sentence
// case; `Sub` is a caption with a capital first letter and no period. No em
// dashes, no "and" sign, no arrows. The model is a schematic: nothing here says
// how right it is (scripts/validate-phone-3d.ts reads both languages).
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';

export interface Phone3DCopy {
  /** The installed build has no 3D engine: the flat replay is drawn, with this one quiet line. */
  needsNewVersionBody: string;
  /** The engine is in the build and would not start, or stopped. */
  couldNotStartBody: string;
  touchHelpSub: string;
  modelA11yBody: string;
}

export function usePhone3DCopy(): Phone3DCopy {
  const { t } = useT();
  return useMemo<Phone3DCopy>(() => ({
    needsNewVersionBody: t('office.livingModelPhone.needsNewVersionBody', '3D needs the newest version of the app.'),
    couldNotStartBody: t('office.livingModelPhone.couldNotStartBody', 'The 3D view could not start on this phone. The same replay is drawn flat below.'),
    touchHelpSub: t('office.livingModelPhone.touchHelpSub', 'Drag to turn. Use two fingers to move. Pinch to zoom. Tap a room to pick it'),
    modelA11yBody: t('office.livingModelPhone.modelA11yBody', 'Schematic 3D model of the job. The room list below reads each room.'),
  }), [t]);
}
