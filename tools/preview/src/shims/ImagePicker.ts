// Camera and gallery pickers for the browser preview: hand back a sample photo.
import { fakePhoto } from './sample';
export const launchCamera = async (_options?: unknown) => ({ assets: [{ uri: fakePhoto(0) }] });
export const launchImageLibrary = async (_options?: unknown) => ({ assets: [{ uri: fakePhoto(2) }] });
