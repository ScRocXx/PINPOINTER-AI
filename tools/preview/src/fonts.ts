// Load the app's Mukta TTFs under the same family names Android uses.
import regular from '../../../android/app/src/main/assets/fonts/Mukta-Regular.ttf?url';
import semibold from '../../../android/app/src/main/assets/fonts/Mukta-SemiBold.ttf?url';
import bold from '../../../android/app/src/main/assets/fonts/Mukta-Bold.ttf?url';
import extrabold from '../../../android/app/src/main/assets/fonts/Mukta-ExtraBold.ttf?url';

const faces: Array<[string, string]> = [
  ['Mukta-Regular', regular],
  ['Mukta-SemiBold', semibold],
  ['Mukta-Bold', bold],
  ['Mukta-ExtraBold', extrabold],
];

export const loadFonts = async (): Promise<void> => {
  const style = document.createElement('style');
  style.textContent = faces.map(([name, url]) => `@font-face{font-family:'${name}';src:url('${url}') format('truetype');}`).join('\n');
  document.head.appendChild(style);
  await Promise.all(faces.map(([name]) => document.fonts.load(`16px '${name}'`)));
  await Promise.all(faces.map(([name]) => document.fonts.load(`16px '${name}'`, 'आधार')));
};
