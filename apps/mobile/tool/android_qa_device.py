"""Fixed emulator-5556 QA profiles. Callers retain their own artifact/process guards."""
import re

PIXEL9 = 'DJLFlutterPixel9QA'
PIXEL9_PROFILES = {PIXEL9: 36, 'DJLFlutterPixel9AOSP35QA': 35, 'DJLFlutterPixel9Google35QA': 35}
LEGACY = frozenset({'DJLFlutterQA', 'DJLFlutterAOSP35QA'})


def validate_owned_profile(value, legacy_names=LEGACY):
    if not set(legacy_names) <= LEGACY:
        raise RuntimeError('Unexpected QA profile policy')
    name = value.get('avd')
    if name in legacy_names:
        return {'avd': name}
    if (name not in PIXEL9_PROFILES or type(value.get('sdk')) is not int or
            value['sdk'] != PIXEL9_PROFILES[name] or
            type(value.get('physicalSize')) is not tuple or
            any(type(n) is not int for n in value['physicalSize']) or
            value['physicalSize'] != (1080, 2424) or value.get('sizeOverride') is not False):
        raise RuntimeError('Owned Android QA profile is unavailable or changed')
    return {'avd': name, 'sdk': PIXEL9_PROFILES[name], 'physicalSize': (1080, 2424), 'sizeOverride': False}


def read_owned_profile(read, legacy_names=LEGACY):
    # Unknown names stop here, before even metadata reads, let alone app access.
    if not set(legacy_names) <= LEGACY:
        raise RuntimeError('Unexpected QA profile policy')
    def text(args):
        value = read(args)
        return value.decode('utf8', 'strict') if isinstance(value, bytes) else value
    names = [line.strip() for line in text(['emu', 'avd', 'name']).splitlines()
             if line.strip() and line.strip() != 'OK']
    if len(names) != 1 or names[0] not in set(legacy_names) | set(PIXEL9_PROFILES):
        raise RuntimeError('Use an explicitly owned Android QA emulator')
    if names[0] not in PIXEL9_PROFILES:
        return {'avd': names[0]}
    sdk = PIXEL9_PROFILES[names[0]]
    if text(['shell', 'getprop', 'ro.build.version.sdk']).strip() != str(sdk):
        raise RuntimeError('Pixel9 QA requires its exact configured API')
    size = text(['shell', 'wm', 'size']).strip()
    if re.fullmatch(r'Physical size:[ \t]*1080x2424', size) is None:
        raise RuntimeError('Pixel9 QA requires physical 1080x2424 without override')
    return validate_owned_profile({'avd': names[0], 'sdk': sdk,
                                   'physicalSize': (1080, 2424), 'sizeOverride': False}, legacy_names)
