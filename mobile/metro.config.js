const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      crypto: require.resolve('react-native-quick-crypto'),
      stream: require.resolve('readable-stream'),
      buffer: require.resolve('buffer'),
    },
    unstable_enablePackageExports: true,
    unstable_conditionNames: ['require', 'react-native', 'browser', 'import'],
    unstable_conditionsByPlatform: {
      ios: ['ios', 'react-native'],
      android: ['android', 'react-native'],
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
