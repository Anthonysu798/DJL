# Performance Scripts

The performance guard scripts in `DJL/scripts` compare fresh XCTest metrics against a JSON baseline file. Baselines are machine- and simulator-sensitive, so they are supplied explicitly instead of checked in as universal truth.

## Sidebar Run Badge

Show the required baseline shape:

```bash
DJL/scripts/check-sidebar-badge-performance.sh --print-baseline-template
```

Run with an explicit baseline:

```bash
BASELINE_PATH=/path/to/Sidebar-RunBadge-Performance-Baseline.json \
  DJL/scripts/check-sidebar-badge-performance.sh
```

## Turn View

Show the required baseline shape:

```bash
DJL/scripts/check-turnview-performance.sh --print-baseline-template
```

Run with an explicit baseline:

```bash
BASELINE_PATH=/path/to/TurnView-Performance-Baseline.json \
  DJL/scripts/check-turnview-performance.sh
```

Both scripts also accept `SCHEME`, `DESTINATION`, and `MAX_REGRESSION_PERCENT` environment overrides.

## Usage Checks

The preflight/help paths can be checked without running Xcode:

```bash
DJL/scripts/test-performance-script-usage.sh
```
