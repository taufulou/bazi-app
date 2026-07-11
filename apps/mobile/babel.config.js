module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo auto-configures the react-native-worklets/reanimated
    // plugin when those packages are installed (SDK 50+). Do NOT add the
    // reanimated plugin manually — on reanimated v4 it lives in
    // react-native-worklets and the preset wires it up correctly.
    presets: ['babel-preset-expo'],
  };
};
