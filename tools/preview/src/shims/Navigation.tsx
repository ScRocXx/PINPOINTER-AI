// @react-navigation/native for the browser preview: no navigator. Moving to
// another screen changes the story in the address bar instead.
import { createContext } from 'react';

export const NavigationContext = createContext<undefined>(undefined);

const STORY_OF: Record<string, string> = {
  PdfFolders: 'folders',
  SmartClipboard: 'scan',
  DocumentVault: 'papers',
  Gallery: 'photos',
  Pinpointer: 'kit',
  Main: 'kit',
};

let routeParams: Record<string, unknown> | undefined;
/** Stories call this before rendering a screen that reads route params. */
export const setPreviewRouteParams = (params?: Record<string, unknown>) => {
  routeParams = params;
};

const navigation = {
  navigate: (name: string) => {
    window.location.hash = STORY_OF[name] ?? 'kit';
  },
  goBack: () => window.history.back(),
  canGoBack: () => true,
  setParams: (params: Record<string, unknown>) => {
    routeParams = { ...routeParams, ...params };
  },
  setOptions: () => {},
  isFocused: () => true,
  addListener: () => () => {},
};

export const useNavigation = () => navigation;
export const useRoute = () => ({ key: 'preview', name: 'preview', params: routeParams });
export const useIsFocused = () => true;
export const useFocusEffect = () => {};
