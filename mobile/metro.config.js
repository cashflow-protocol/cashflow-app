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
    // Handle package exports for Privy SDK dependencies
    unstable_enablePackageExports: true,
    unstable_conditionNames: ['react-native', 'browser', 'require'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
