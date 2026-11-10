import { useCallback, useEffect, useState } from 'react';
import {
  PinnedItem,
  getPinnedItems,
  subscribePinned,
  togglePinned,
} from '../utils/PinnedItems';

/**
 * Starred ("Important") items, kept in sync across screens: starring a photo
 * in the viewer updates the Home shelf at once.
 */
export const usePinnedItems = () => {
  const [items, setItems] = useState<PinnedItem[]>([]);

  useEffect(() => {
    let alive = true;
    getPinnedItems().then(list => {
      if (alive) setItems(list);
    });
    const unsubscribe = subscribePinned(list => setItems(list));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const isPinned = useCallback((uri: string) => items.some(p => p.uri === uri), [items]);
  const toggle = useCallback((item: Omit<PinnedItem, 'pinnedAt'>) => togglePinned(item), []);

  return { items, isPinned, toggle };
};
