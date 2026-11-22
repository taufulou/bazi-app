/**
 * Config plugin: raise every CocoaPods target below iOS 15.1 to 15.1.
 *
 * Xcode 27.2 refuses to build a target whose IPHONEOS_DEPLOYMENT_TARGET is below
 * 15.0 ("supported range is 15.0 to 27.2.x"). Several pods still declare 9–13:
 * RevenueCat, PurchasesHybridCommon, Sentry, RNSVG, react-native-view-shot,
 * AsyncStorage, ReachabilitySwift. The app itself targets 16.4, so no device we
 * support is lost. 15.1 is React Native's own minimum.
 *
 * Only targets that SET a lower value are touched. Targets that inherit the
 * project-level value (the Podfile `platform`, 16.4) are left alone, so this can
 * never lower anything.
 *
 * The edit goes right after `react_native_post_install(...)`, so it is the last
 * word on the setting. If that call is missing (a template change), prebuild
 * fails here with a clear message rather than leaving a project Xcode rejects.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# @tianming/pod-deployment-target';
const ANCHOR = /react_native_post_install\([\s\S]*?\n[ \t]*\)/;

function addPodDeploymentTargetFloor(contents, floor = '15.1') {
  if (contents.includes(MARKER)) return contents;
  const match = contents.match(ANCHOR);
  if (!match) {
    throw new Error(
      'with-pod-deployment-target: no react_native_post_install(...) call in the Podfile; ' +
        'cannot raise pod deployment targets. Update the plugin for the new Podfile template.',
    );
  }
  const indent = (match[0].match(/\n([ \t]*)\)$/) || [])[1] ?? '    ';
  const snippet = [
    '',
    `${indent}${MARKER}`,
    `${indent}installer.pods_project.targets.each do |t|`,
    `${indent}  t.build_configurations.each do |c|`,
    `${indent}    v = c.build_settings['IPHONEOS_DEPLOYMENT_TARGET']`,
    `${indent}    if v && v.to_f < ${floor}`,
    `${indent}      c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${floor}'`,
    `${indent}    end`,
    `${indent}  end`,
    `${indent}end`,
  ].join('\n');
  const end = match.index + match[0].length;
  return contents.slice(0, end) + snippet + contents.slice(end);
}

function withPodDeploymentTarget(config, options = {}) {
  return withPodfile(config, (cfg) => {
    cfg.modResults.contents = addPodDeploymentTargetFloor(cfg.modResults.contents, options.floor);
    return cfg;
  });
}

module.exports = withPodDeploymentTarget;
module.exports.addPodDeploymentTargetFloor = addPodDeploymentTargetFloor;
module.exports.MARKER = MARKER;
