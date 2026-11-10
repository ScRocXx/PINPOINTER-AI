/**
 * Pinpointer's icon set: 24dp grid, drawn as stroke paths (1.75 stroke,
 * round ends). One `d` string per icon so they render with a single <Path>.
 * Shapes follow the Lucide style (ISC licence); drawn fresh for this app.
 */
export const ICON_PATHS = {
  search: 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.3-4.3',
  mic: 'M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  home: 'M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z',
  photos:
    'M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM7.5 9a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M20.5 15.5l-5-5-11 10',
  papers: 'M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8zM14 3.5V8h4.5M9 12.5h6M9 16.5h6',
  scan: 'M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5M8 12h8',
  corners: 'M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z',
  share: 'M12 15V3.5M8 7.5l4-4 4 4M5.5 12v7a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-7',
  copy: 'M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4',
  back: 'M19 12H5M11 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  folder: 'M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  shield: 'M12 3.5 5 6.2v5.6c0 4.2 3 7.8 7 8.7 4-.9 7-4.5 7-8.7V6.2zM9 12l2 2 4-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M12 7.5V12l3 2',
  plus: 'M12 5v14M5 12h14',
  idCard:
    'M5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5zM7 10.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.5 15.5c.6-1.2 1.5-1.8 2.5-1.8s1.9.6 2.5 1.8M14 10h4M14 13.5h3',
  bill: 'M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8h6M9 11.5h6M9 15h3.5',
  medicine: 'M7.05 16.95a5 5 0 0 1 0-7.07l2.83-2.83a5 5 0 0 1 7.07 7.07l-2.83 2.83a5 5 0 0 1-7.07 0zM8.5 8.5l7 7',
  bank: 'M3.5 9.5h17L12 4zM6 9.5V17M10 9.5V17M14 9.5V17M18 9.5V17M3.5 20h17',
  screenshot: 'M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2',
  family:
    'M5.5 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 20c0-3.3 2.5-5.5 5.5-5.5S14 16.7 14 20M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.8c2 .7 3.5 2.6 3.5 5.2',
  camera:
    'M4.5 7.5h3l1.8-2.5h5.4l1.8 2.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1zM8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  refresh: 'M19.5 9A8 8 0 0 0 5 7.5M4.5 4v4h4M4.5 15A8 8 0 0 0 19 16.5M19.5 20v-4h-4',
  readText: 'M5 7V5.5h14V7M12 5.5v13M9 18.5h6',
  language: 'M4 5.5h9M8.5 3.5v2M6 5.5c.5 3.5 2.5 6 5.5 7.5M11 5.5c-.6 3.6-3 6.7-6.5 8M13 20.5l3.75-9 3.75 9M14.3 17.5h4.9',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
  open: 'M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  lock: 'M6.5 11h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  more: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  stop: 'M7 7h10v10H7z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  play: 'M7 4.5v15l12-7.5z',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01',
  info: 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M12 11v5.5M12 7.8h.01',
  edit: 'M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5zM13.5 7.2l3.3 3.3',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Icons drawn filled as well as stroked when `filled` is set. */
export const FILLABLE_ICONS: ReadonlySet<IconName> = new Set<IconName>(['star', 'play', 'stop']);

/** Dot-style icons that need a thicker stroke to be visible. */
export const DOT_ICONS: ReadonlySet<IconName> = new Set<IconName>(['more']);
