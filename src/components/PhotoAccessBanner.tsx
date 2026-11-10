import React, { useEffect, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { usePhotoAccess } from '../hooks/useStorageAccess';
import { PhotoAccess, isLimitedAccessKept, keepLimitedAccess } from '../utils/StoragePermissions';
import { PhotoAccessBannerView } from './PhotoAccessBannerView';

export { PhotoAccessBannerView } from './PhotoAccessBannerView';
export type { PhotoAccessBannerViewProps } from './PhotoAccessBannerView';

export interface PhotoAccessBannerProps {
  inline?: boolean;
  /** Told whenever the banner changes the photo access. */
  onAccessChange?: (access: PhotoAccess) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Shown only while Pinpointer can see some photos but not all ("Select
 * photos" on Android 14+). The first tap brings back Android's photo dialog,
 * where "Allow all" is one tap; if that doesn't do it, the next tap opens
 * Settings with the steps written out. "Keep my choice" hides it for good,
 * and also stops the sync from asking.
 */
export const PhotoAccessBanner: React.FC<PhotoAccessBannerProps> = ({
  inline,
  onAccessChange,
  style,
  testID = 'photo-access-banner',
}) => {
  const { access, request, openSettings } = usePhotoAccess();
  const [kept, setKept] = useState<boolean | null>(null);
  const [askedOnce, setAskedOnce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    isLimitedAccessKept()
      .then(value => {
        if (alive) setKept(value);
      })
      .catch(() => {
        if (alive) setKept(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (access !== 'limited' || kept !== false) {
    return null;
  }

  const allow = async () => {
    setBusy(true);
    let next: PhotoAccess;
    try {
      next = askedOnce ? await openSettings() : await request();
    } finally {
      setBusy(false);
    }
    setAskedOnce(true);
    onAccessChange?.(next);
  };

  const keep = () => {
    setKept(true);
    keepLimitedAccess();
  };

  return (
    <PhotoAccessBannerView
      settingsNext={askedOnce}
      busy={busy}
      inline={inline}
      onAllow={allow}
      onKeep={keep}
      style={style}
      testID={testID}
    />
  );
};
