"""Check the simulator's embedded identity before installing over saved QA data."""
import argparse
from pathlib import Path
import plistlib
import struct


def application_identifier(blob):
    if len(blob) < 32 or struct.unpack_from('<I', blob)[0] != 0xfeedfacf:
        raise ValueError('Expected an architecture-specific 64-bit Mach-O executable')
    commands, command_bytes = struct.unpack_from('<II', blob, 16)
    end = 32 + command_bytes
    if end > len(blob) or commands > command_bytes // 8:
        raise ValueError('Truncated Mach-O load commands')
    cursor, identities = 32, []
    for _ in range(commands):
        if cursor + 8 > end:
            raise ValueError('Truncated Mach-O load command')
        command, size = struct.unpack_from('<II', blob, cursor)
        if size < 8 or cursor + size > end:
            raise ValueError('Invalid Mach-O load command size')
        if command == 0x19:
            if size < 72:
                raise ValueError('Truncated Mach-O segment')
            sections = struct.unpack_from('<I', blob, cursor + 64)[0]
            if 72 + sections * 80 > size:
                raise ValueError('Truncated Mach-O section table')
            for index in range(sections):
                section = cursor + 72 + index * 80
                if (blob[section:section + 16].rstrip(b'\0') != b'__entitlements'
                        or blob[section + 16:section + 32].rstrip(b'\0') != b'__TEXT'):
                    continue
                length = struct.unpack_from('<Q', blob, section + 40)[0]
                offset = struct.unpack_from('<I', blob, section + 48)[0]
                if offset < end or offset + length > len(blob):
                    raise ValueError('Invalid simulated-entitlements section bounds')
                try:
                    value = plistlib.loads(blob[offset:offset + length])['application-identifier']
                except Exception as error:
                    raise ValueError('Invalid simulated-entitlements plist') from error
                if not isinstance(value, str) or not value:
                    raise ValueError('Missing simulated application identifier')
                identities.append(value)
        cursor += size
    if len(identities) != 1:
        raise ValueError('Expected exactly one simulated application identifier')
    return identities[0]


def verify(executable, expected):
    actual = application_identifier(Path(executable).read_bytes())
    if actual != expected:
        raise ValueError(f'Simulator identity mismatch: expected {expected}, got {actual}')
    return actual


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    parser.add_argument('--expected', required=True)
    args = parser.parse_args()
    try:
        print(verify(args.executable, args.expected))
    except (ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')
