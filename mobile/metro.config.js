const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const path = require('path');

const config = {
  resolver: {
    extraNodeModules: {
      crypto: require.resolve('react-native-quick-crypto'),
      stream: require.resolve('readable-stream'),
      buffer: require.resolve('buffer'),
    },
    resolveRequest: (context, moduleName, platform) => {
      // jose ships Node and browser builds — force the browser build in RN
      if (moduleName === 'jose' || moduleName.startsWith('jose/')) {
        const joseDir = path.dirname(require.resolve('jose/package.json'));
        const browserEntry = path.join(joseDir, 'dist', 'browser', 'index.js');
        return { filePath: browserEntry, type: 'sourceFile' };
      }
      // @privy-io/expo uses package exports — resolve to CJS entry without enablePackageExports
      if (moduleName === '@privy-io/expo') {
        const pkgDir = path.join(__dirname, 'node_modules', '@privy-io', 'expo');
        return { filePath: path.join(pkgDir, 'dist', 'index.js'), type: 'sourceFile' };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
