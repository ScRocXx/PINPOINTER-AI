import { NavigatorScreenParams } from '@react-navigation/native';

/** The four bottom tabs (inside the stack's `Main` route). */
export type MainTabParamList = {
  /** Home and search. */
  Pinpointer: { startUniversalSync?: boolean } | undefined;
  /** All photos. */
  Gallery: undefined;
  /** Papers (PDFs). */
  DocumentVault: undefined;
  Settings: undefined;
};

/** Screens that open on top of the tabs. */
export type StackParamList = {
  /** Welcome and permissions, shown once on a new install (see FirstRun.ts). */
  FirstRun: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  /** The old feature-card home. Still shown as the side menu. */
  Home: undefined;
  /** Read text from a photo (the Scan button). */
  SmartClipboard: { scanUri?: string } | undefined;
  /** Where Pinpointer looks for PDFs: add and remove folders (from Papers). */
  PdfFolders: undefined;
};

/**
 * Every route by name. Screens type their navigation with this, so moving a
 * screen between the stack and the tabs doesn't change their code. Names are
 * unique, and `navigate('Gallery')` from inside the tabs or a tab's screen
 * finds the right navigator. From a stack screen (SmartClipboard), open a
 * tab with `navigate('Main', { screen: 'Gallery' })`.
 */
export type RootStackParamList = StackParamList & MainTabParamList;
