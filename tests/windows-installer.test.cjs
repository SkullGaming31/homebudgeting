const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

describe('Windows installer configuration', () => {
  it('builds the app before invoking electron-builder for x64 NSIS', () => {
    assert.equal(
      packageJson.scripts['dist:win'],
      'npm run build && electron-builder --win nsis --x64'
    );
  });

  it('defines application identity and writes distributions to release', () => {
    assert.equal(packageJson.build.appId, 'com.skullgaming31.homebudgeting');
    assert.equal(packageJson.build.productName, 'Home Budgeting');
    assert.equal(packageJson.build.artifactName, 'Home-Budgeting-Setup-${version}.${ext}');
    assert.equal(packageJson.build.directories.output, 'release');
  });

  it('configures NSIS with directory selection and application shortcuts', () => {
    const nsis = packageJson.build.nsis;

    assert.ok(nsis, 'NSIS installer configuration should exist');
    assert.equal(nsis.oneClick, false);
    assert.equal(nsis.allowToChangeInstallationDirectory, true);
    assert.equal(nsis.createDesktopShortcut, true);
    assert.equal(nsis.createStartMenuShortcut, true);
  });
});
