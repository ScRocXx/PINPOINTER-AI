import { createContext, useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

// Screen tests often mock @react-navigation/native wholesale, which leaves
// NavigationContext undefined; fall back to an empty context then.
const NoNavigation = createContext<undefined>(undefined);
const NavCtx = (NavigationContext ?? NoNavigation) as typeof NavigationContext;

/**
 * True while the screen this component sits in is the one on show. Unlike
 * `useIsFocused`, it also works outside a navigator (tests, previews), where
 * it is always true. Tabs stay mounted when you leave them, so anything that
 * changes the whole app (the status bar) must check this first.
 */
export const useScreenFocus = (): boolean => {
  const navigation = useContext(NavCtx);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (!navigation) {
      return;
    }
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  return focused;
};
