/**
 * React Native configuration for Pinpointer
 */
module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    // CRITICAL: react-native-screens crashes with New Architecture in RN 0.83
    // Error: -[RCTView setColor:] and -[RCTView setSheetExpandsWhenScrolledToEdge:]
    'react-native-screens': {
      platforms: {
        ios: null,
      },
    },
  },
};
