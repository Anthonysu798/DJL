"""Verify the separate SDK UI runner without relaxing ordinary app identity checks."""
import argparse
from pathlib import Path
import plistlib
import subprocess


def verify(products):
    apps = list(Path(products).rglob('*.app'))
    if len(apps) != 1:
        raise ValueError('Expected exactly one isolated UI runner')
    app = apps[0]
    expected = 'app.djl.qa.NativeInputGesture47.xctrunner'
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != expected:
        raise ValueError('Unexpected UI runner bundle identifier')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)],
                   check=True, capture_output=True, timeout=15)
    signed = subprocess.run(['codesign', '-d', '--verbose=4', str(app)],
                            check=True, capture_output=True, text=True, timeout=15)
    if 'Identifier=' + expected not in signed.stderr.splitlines():
        raise ValueError('Unexpected signed UI runner identifier')
    entitlements = subprocess.run(['codesign', '-d', '--entitlements', '-', str(app)],
                                  check=True, capture_output=True, timeout=15)
    values = plistlib.loads(entitlements.stdout) if entitlements.stdout else {}
    if values.get('keychain-access-groups') or values.get('com.apple.security.application-groups'):
        raise ValueError('UI runner must not share credential or app-group storage')
    architectures = subprocess.check_output(
        ['lipo', '-archs', str(app / info['CFBundleExecutable'])], text=True, timeout=15).split()
    if architectures != ['arm64']:
        raise ValueError('UI runner must contain only the dedicated simulator architecture')
    bundles = list(app.glob('PlugIns/*.xctest'))
    if len(bundles) != 1:
        raise ValueError('Expected exactly one owned UI test bundle')
    test_info = plistlib.loads((bundles[0] / 'Info.plist').read_bytes())
    if test_info['CFBundleIdentifier'] != 'app.djl.qa.NativeInputGesture47':
        raise ValueError('Unexpected UI test bundle')
    return {'runner_bundle': expected, 'test_bundle': test_info['CFBundleIdentifier'],
            'strict_signature': True, 'architecture': 'arm64',
            'shares_app_data_or_credentials': False, 'separate_from_djl_app': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('products', type=Path)
    print(verify(parser.parse_args().products))
