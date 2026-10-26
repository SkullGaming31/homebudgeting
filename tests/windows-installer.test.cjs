const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const installerScript = fs.readFileSync(
  path.join(__dirname, '..', packageJson.build.nsis.include),
  'utf8'
);
const customInstall = installerScript.match(
  /!macro customInstall([\s\S]*?)!macroend/
)?.[1];

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

  it('includes the NSIS customInstall hook', () => {
    const nsis = packageJson.build.nsis;

    assert.equal(nsis.include, 'build/installer.nsh');
    assert.ok(customInstall, 'installer script should define customInstall');
  });

  it('invokes icacls for the installation directory', () => {
    assert.ok(customInstall, 'installer script should define customInstall');
    assert.match(
      customInstall,
      /ExecWait\s+'"\$SYSDIR\\icacls\.exe"\s+"\$INSTDIR"\s+\/grant/
    );
  });

  it('grants ALL APPLICATION PACKAGES inherited read and execute access', () => {
    assert.ok(customInstall, 'installer script should define customInstall');
    assert.match(
      customInstall,
      /\*S-1-15-2-1:\(OI\)\(CI\)\(RX\)/
    );
  });

  it('aborts installation with an explicit error if the ACL command fails', () => {
    assert.ok(customInstall, 'installer script should define customInstall');
    const failureBranch = customInstall.match(
      /\$\{if\}\s+\$0\s+!=\s+0([\s\S]*?)\$\{endif\}/
    )?.[1];

    assert.ok(failureBranch, 'nonzero icacls exit status should be checked');
    assert.match(failureBranch, /MessageBox\s+MB_ICONSTOP/);
    assert.match(failureBranch, /Unable to grant Windows sandbox access/);
    assert.match(failureBranch, /\bAbort\b/);
  });
});
