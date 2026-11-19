#!/usr/bin/env python3
"""Compile actual private reader/controller with finite external IO adapters only."""
import difflib, hashlib, json, pathlib, subprocess, sys, tempfile
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) >= 2 else pathlib.Path(tempfile.mkdtemp(prefix="djl-history-inert-"))
out.mkdir(parents=True, exist_ok=True)
source_root = pathlib.Path(sys.argv[sys.argv.index("--source-native") + 1]) if "--source-native" in sys.argv else root
source = (source_root / "Sources/InteractionHistory.swift").read_text()
start = source.index("private enum HistorySecureInput {")
end = source.index("\nprivate struct HistoryInput", start)
adapted = source[:start] + "private enum HistorySecureInput {\n    static var available: Bool { InertAX.secureAvailable }\n    static func enabled() -> Bool? { InertAX.secure }\n}\n" + source[end:]
# Every test-only source substitution is reversible to the exact production bytes.
secure_adapter = adapted[start:adapted.index("\nprivate struct HistoryInput", start)]
replacements = [(source[start:end], secure_adapter, 1)]
transforms = {}
requested = "let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)"
assert adapted.count(requested) == 1
adapted = adapted.replace(requested, requested.replace("AXUIElementCopyAttributeValue", "InertRequestedAttributeValue"))
transforms[requested] = 1
replacements.append((requested, requested.replace("AXUIElementCopyAttributeValue", "InertRequestedAttributeValue"), 1))
metadata_requested = "let status = AXUIElementCopyAttributeValue(element, name as CFString, &value)"
has_metadata_reader = "private func readMetadata(" in source
assert adapted.count(metadata_requested) == (1 if has_metadata_reader else 0)
if has_metadata_reader:
    metadata_adapted = metadata_requested.replace("AXUIElementCopyAttributeValue", "InertRequestedAttributeValue")
    adapted = adapted.replace(metadata_requested, metadata_adapted)
    replacements.append((metadata_requested, metadata_adapted, 1))
transforms[metadata_requested] = 1 if has_metadata_reader else 0
paired = "private func ownershipPair(" in source
comparison = "let reference = element(value), CFEqual(reference, expected)"
assert adapted.count(comparison) == (1 if paired else 0)
if paired:
    adapted = adapted.replace(comparison, comparison.replace("CFEqual", "InertOwnershipEqual"))
    replacements.append((comparison, comparison.replace("CFEqual", "InertOwnershipEqual"), 1))
transforms[comparison] = 1 if paired else 0
external_calls = {'AXUIElementCreateApplication': 4, 'AXUIElementGetTypeID': 1, 'AXIsProcessTrusted': 2, 'CGSessionCopyCurrentDictionary': 1, 'AXUIElementSetMessagingTimeout': (5 if has_metadata_reader else 4) if paired else 3, 'AXUIElementGetPid': 4, 'AXUIElementCopyAttributeValue': 1, 'AXUIElementCopyMultipleAttributeValues': 2 if paired else 1, 'AXUIElementGetAttributeValueCount': 1, 'AXUIElementCopyAttributeValues': 1, 'AXObserverCreate': 1, 'AXObserverAddNotification': 2, 'AXObserverGetRunLoopSource': 1, 'CGWindowListCopyWindowInfo': 1}
extra_calls = {'CFMachPortInvalidate': 2, 'CFRunLoopWakeUp': 1, 'CFMachPortCreateRunLoopSource': 1, 'CFRunLoopGetCurrent': 1, 'CFRunLoopAddSource': 2, 'CFRunLoopRunInMode': 1, 'CFRunLoopRemoveSource': 2}
for old, new, count in [("Thread { [self] in", "InertThread { [self] in", 1), ("Date()", "InertAX.date", 6)] + [(name+"(", "Inert"+name+"(", count) for name,count in extra_calls.items()] + [("DispatchTime.now().uptimeNanoseconds", "InertAX.clock", 8), ("CGEvent.tapCreateForPid(", "InertAX.forbiddenTap(", 1), ("CGEvent.tapEnable(", "InertAX.forbiddenTapEnable(", 1)] + [(name + "(", "Inert" + name + "(", count) for name, count in external_calls.items()]:
    actual = adapted.count(old)
    if actual != count: raise SystemExit(f"external adapter anchor changed: {old}: {actual} != {count}")
    transforms[old] = actual
    adapted = adapted.replace(old, new)
    replacements.append((old, new, actual))
origin = "let deadline = InertAX.clock + 750_000_000"
assert adapted.count(origin) == 1
adapted = adapted.replace(origin, "let deadline = InertAX.readerOrigin() + 750_000_000")
replacements.append((origin, "let deadline = InertAX.readerOrigin() + 750_000_000", 1))
restored = adapted
for old, new, count in reversed(replacements):
    assert restored.count(new) == count, (new, count)
    restored = restored.replace(new, old)
assert restored == source, "external adapters must invert to exact production source"
(out / "source-inverse-audit.json").write_text(json.dumps({"exactProductionBytesRestored": True, "sourceSHA256": hashlib.sha256(restored.encode()).hexdigest(), "replacements": replacements}, indent=2) + "\n")
(out / "external-adapters.patch").write_text("".join(difflib.unified_diff(source.splitlines(True), adapted.splitlines(True), fromfile="Sources/InteractionHistory.swift", tofile="inert/InteractionHistory.swift")))
transport = (source_root / "Sources/InteractionHistoryTransport.swift").read_text()
assert transport.count("DispatchTime.now().uptimeNanoseconds") == 1
assert transport.count("JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])") == 1
adapted_transport = transport.replace("Date().timeIntervalSince1970", "InertAX.date.timeIntervalSince1970").replace("DispatchTime.now().uptimeNanoseconds", "InertAX.clock").replace("JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])", "InertAX.encode(object)")
(out / "InteractionHistoryTransport.swift").write_text(adapted_transport)
(out / "transport-external-adapters.patch").write_text("".join(difflib.unified_diff(transport.splitlines(True), adapted_transport.splitlines(True), fromfile="Sources/InteractionHistoryTransport.swift", tofile="inert/InteractionHistoryTransport.swift")))
generated = adapted + "\n" + (root / "Tests/HistoryReaderInertTests.swift").read_text()
(out / "InteractionHistory.swift").write_text(generated)
sources = [root / ("Sources/" + name + ".swift") for name in ["InteractionHistoryCore", "InteractionHistoryFocus", "InteractionHistoryMetadata"]] + [out / "InteractionHistoryTransport.swift"] + [root / "Tests/HistoryReaderInertShims.swift", out / "InteractionHistory.swift"]
command = ["xcrun", "swiftc", "-swift-version", "5", "-O", "-module-cache-path", tempfile.mkdtemp(prefix="djl-metadata-proof-module-cache-"), *map(str, sources), "-framework", "AppKit", "-framework", "ApplicationServices", "-framework", "CoreGraphics", "-o", str(out / "HistoryReaderInertTests")]
manifest = {"sourceSHA256": hashlib.sha256(source.encode()).hexdigest(), "adaptedSHA256": hashlib.sha256(adapted.encode()).hexdigest(), "generatedSHA256": hashlib.sha256(generated.encode()).hexdigest(), "externalTransforms": transforms, "inputs": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources + [source_root / "Sources/InteractionHistory.swift", root / "Sources/InteractionHistoryTransport.swift", root / "Tests/HistoryReaderInertTests.swift", pathlib.Path(__file__).resolve()]}, "command": command}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
build = subprocess.run(command, capture_output=True, text=True)
(out / "build.txt").write_text(build.stdout + build.stderr)
(out / "build-result.json").write_text(json.dumps({"exitCode": build.returncode}) + "\n")
if build.returncode: print(build.stdout + build.stderr); sys.exit(build.returncode)
symbols = subprocess.check_output(["nm", "-u", str(out / "HistoryReaderInertTests")], text=True)
(out / "undefined-symbols.txt").write_text(symbols)
# These would perform real app/AX/session discovery; synthetic build must not link them.
for name in list(external_calls) + list(extra_calls):
    if "_" + name + "\n" in symbols: raise SystemExit("unexpected real external query: " + name)
for name in ["CGEventCreateKeyboardEvent", "CGEventCreateMouseEvent", "CGEventGetIntegerValueField", "CGEventGetLocation", "CGEventGetFlags", "CGEventGetDoubleValueField", "CGEventPost", "CGEventPostToPid", "CGEventTapCreateForPid", "proc_pidinfo", "proc_pidpath"]:
    if "_" + name + "\n" in symbols: raise SystemExit("unexpected live input/process API: " + name)
result = subprocess.run([str(out / "HistoryReaderInertTests"), str(out / "read-attempts.json")] + [a for a in sys.argv[2:] if a in ["--ownership-only", "--baseline-contract", "--original-only", "--service-only", "--metadata-only", "--poll-model"]], capture_output=True, text=True)
(out / "result.txt").write_text(result.stdout + result.stderr)
(out / "run-result.json").write_text(json.dumps({"exitCode": result.returncode, "command": result.args}) + "\n")
print(result.stdout + result.stderr, end="")
print("inert evidence:", out)
sys.exit(result.returncode)
