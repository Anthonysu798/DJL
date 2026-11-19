"""Keep generated private test defines out of native build transcripts."""
import sys
for line in sys.stdin:
    if 'DartDefines' in line or 'DART_DEFINES' in line:
        sys.stdout.write('[Build arguments containing private test defines omitted]\n')
    else:
        sys.stdout.write(line)
