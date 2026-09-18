// utils/pickFloorPlanImage.ts — get a floor-plan image from the camera or the
// photo library, shaped for utils/addFloorPlan.
//
// Shared by app/plans.tsx and the punch walk's "add a floor plan" step so both
// ask for the same thing: a JPEG/PNG (planSheetImageCore refuses anything else,
// because web and the plan analyzers cannot decode HEIC).
//
// HEIC ON iOS. An ordinary camera-roll photo is HEIC. Quality alone does NOT
// turn it into a JPEG: in expo-image-picker 17 the native default for
// preferredAssetRepresentationMode is `.current` (ImagePickerOptions.swift),
// whatever the TS doc says, so PHPicker hands over the HEIC representation and
// ImageUtils.readDataAndFileExtension returns it as-is (".heic") at ANY
// quality. The founder picking his plan from Photos got "Plans have to be a
// JPG or PNG (this one is image/heic)". `.compatible` makes PHPicker transcode
// to JPEG before we see it. The option is in the shipped native module, so
// this is JS-only (OTA-safe). The camera already captures JPEG.

import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { FloorPlanImage } from '@/utils/planSheetImageCore';

export type PickFloorPlanResult =
  | { status: 'picked'; image: FloorPlanImage }
  | { status: 'canceled' }
  | { status: 'blocked'; reason: string };

export async function pickFloorPlanImage(source: 'camera' | 'library'): Promise<PickFloorPlanResult> {
  // The web has no camera intent worth using for a plan; its file picker also
  // offers the camera on phones.
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  try {
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        return { status: 'blocked', reason: 'Camera access is off for MAGE ID. Turn it on in Settings to photograph a plan, or pick one from your photos.' };
      }
    } else if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        return { status: 'blocked', reason: 'Photo library access is off for MAGE ID. Turn it on in Settings to pick a plan, or photograph it instead.' };
      }
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
      exif: false,
      // iOS library only (ignored elsewhere): see the HEIC note at the top.
      ...(useCamera ? {} : { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible }),
    };
    const result = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { status: 'canceled' };
    const a = result.assets[0];
    return {
      status: 'picked',
      image: {
        uri: a.uri,
        width: a.width,
        height: a.height,
        mimeType: a.mimeType ?? null,
        fileName: a.fileName ?? null,
        fileSize: a.fileSize ?? null,
      },
    };
  } catch (err) {
    return { status: 'blocked', reason: `Could not open the ${useCamera ? 'camera' : 'photo library'}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
