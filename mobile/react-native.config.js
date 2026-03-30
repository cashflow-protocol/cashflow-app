module.exports = {
  assets: ['./assets/fonts'],
  dependencies: {
    // Exclude expo from native auto-linking — only JS modules needed
    'expo': { platforms: { android: null, ios: null } },
  },
};