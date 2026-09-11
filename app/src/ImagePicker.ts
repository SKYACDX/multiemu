import {NativeModules} from 'react-native';

export interface PickedImage {
  base64: string;
  name: string;
  mimeType: string;
  size: number;
}

interface ImagePickerNativeModule {
  pickImage(): Promise<PickedImage>;
}

const {ImagePicker} = NativeModules as {ImagePicker: ImagePickerNativeModule};

export class ImagePickerCancelledError extends Error {}
export class ImageTooLargeError extends Error {}

/** Opens Android's document picker restricted to image/*, for attaching a screenshot to feedback (see FeedbackScreen). */
export async function pickImage(): Promise<PickedImage> {
  try {
    return await ImagePicker.pickImage();
  } catch (e) {
    const code = (e as {code?: string} | null)?.code;
    if (code === 'CANCELLED') throw new ImagePickerCancelledError();
    if (code === 'TOO_LARGE') throw new ImageTooLargeError(e instanceof Error ? e.message : String(e));
    throw e;
  }
}
