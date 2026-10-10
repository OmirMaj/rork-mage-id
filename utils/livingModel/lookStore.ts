// utils/livingModel/lookStore.ts — where the chosen look of the 3D view is kept
// on this device (the rules and the key are utils/livingModel/looks.ts).
//
// One small value: 'realistic' or 'game'. Nothing about a job or a person is
// in it. A read or a write that fails is not an error anyone needs to hear
// about: the view draws the default look, or keeps the choice until the app
// is closed.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL_LOOK, MODEL_LOOK_STORAGE_KEY, isModelLook, readModelLook, type ModelLook } from './looks';

/** The look last read or chosen while the app is open, so the view does not start in one look and jump to the other. */
let remembered: ModelLook | null = null;

/** The look to start with, before the device has been read: the last one known, or the default. */
export const rememberedModelLook = (): ModelLook => remembered ?? DEFAULT_MODEL_LOOK;

/** Reads the look the person last chose on this device. Never rejects. */
export async function loadModelLook(): Promise<ModelLook> {
  if (remembered) return remembered;
  try {
    const look = readModelLook(await AsyncStorage.getItem(MODEL_LOOK_STORAGE_KEY));
    // A choice made while the read was on its way wins.
    if (!remembered) remembered = look;
  } catch {
    /* the default is drawn */
  }
  return rememberedModelLook();
}

/** Keeps the person's choice. True when the device took it. */
export async function saveModelLook(look: ModelLook): Promise<boolean> {
  if (!isModelLook(look)) return false;
  remembered = look;
  try {
    await AsyncStorage.setItem(MODEL_LOOK_STORAGE_KEY, look);
    return true;
  } catch {
    return false;
  }
}

/** For tests only: forget what was read, so the next read asks the device. */
export function forgetModelLookForTests(): void { remembered = null; }
