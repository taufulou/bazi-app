/* eslint-disable @typescript-eslint/no-require-imports -- the plugin is CommonJS (runs in Node at prebuild) */
/**
 * Xcode 27.2 rejects pod targets below iOS 15.0. The plugin appends a floor to
 * the Podfile's post_install, right after react_native_post_install(...), and
 * only raises targets that set a lower value.
 */
const { addPodDeploymentTargetFloor, MARKER } = require('../with-pod-deployment-target');

// The post_install block exactly as Expo SDK 57 generates it.
const PODFILE = `  use_react_native!(
    :path => config[:reactNativePath],
    :privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false',
  )

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

describe('addPodDeploymentTargetFloor', () => {
  it('adds the floor after react_native_post_install, inside post_install', () => {
    const out: string = addPodDeploymentTargetFloor(PODFILE);
    const rnEnd = out.indexOf(':ccache_enabled => ccache_enabled?(podfile_properties),\n    )');
    const marker = out.indexOf(MARKER);
    const blockEnd = out.lastIndexOf('  end\nend');
    expect(rnEnd).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(rnEnd);
    expect(marker).toBeLessThan(blockEnd);
    expect(out).toContain("if v && v.to_f < 15.1");
    expect(out).toContain("c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'");
  });

  it('only touches targets that set a value (never lowers an inherited one)', () => {
    const out: string = addPodDeploymentTargetFloor(PODFILE);
    expect(out).toContain("v = c.build_settings['IPHONEOS_DEPLOYMENT_TARGET']");
    expect(out).toMatch(/if v && v\.to_f < 15\.1/);
  });

  it('matches the indentation of the surrounding block', () => {
    const out: string = addPodDeploymentTargetFloor(PODFILE);
    expect(out).toContain(`\n    ${MARKER}\n    installer.pods_project.targets.each do |t|`);
  });

  it('is idempotent', () => {
    const once: string = addPodDeploymentTargetFloor(PODFILE);
    expect(addPodDeploymentTargetFloor(once)).toBe(once);
    expect(once.split(MARKER).length - 1).toBe(1);
  });

  it('leaves everything else unchanged', () => {
    const out: string = addPodDeploymentTargetFloor(PODFILE);
    const snippetStart = out.indexOf(`\n    ${MARKER}`);
    const snippetEnd = out.indexOf('    end', out.indexOf('t.build_configurations'));
    expect(snippetStart).toBeGreaterThan(-1);
    expect(snippetEnd).toBeGreaterThan(snippetStart);
    // Remove the inserted lines and the original comes back byte for byte.
    const removed = out.replace(/\n {4}# @tianming\/pod-deployment-target[\s\S]*?\n {4}end(?=\n {2}end\nend)/, '');
    expect(removed).toBe(PODFILE);
  });

  it('accepts a custom floor', () => {
    expect(addPodDeploymentTargetFloor(PODFILE, '16.0')).toContain("v.to_f < 16.0");
  });

  it('fails loudly when the Podfile template no longer has the anchor', () => {
    expect(() => addPodDeploymentTargetFloor('post_install do |installer|\nend\n')).toThrow(
      /no react_native_post_install/,
    );
  });
});
