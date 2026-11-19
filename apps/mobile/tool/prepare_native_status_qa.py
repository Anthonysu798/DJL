"""Create an isolated TEST-ONLY native status adapter copy; never build or install."""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat

TARGET = 'integration_test/status_native_adapter_test.dart'
PIN_PATH = 'integration_test/native/status_source_hashes.json'
ANDROID_DEADLINE = 'integration_test/native/android/NativeStatusDeadline.kt'
IOS_ANCHOR = '    GeneratedPluginRegistrant.register(with: registry)'
ANDROID_ANCHOR = '        super.configureFlutterEngine(flutterEngine)'
IOS_APP = 'ios/Runner/AppDelegate.swift'
ANDROID_APP = 'android/app/src/main/kotlin/app/djl/djl_mobile/MainActivity.kt'
EXCLUDED = {'build', 'Pods', '.gradle', '.dart_tool', '.git', '.symlinks', 'ephemeral',
            'local.properties', 'Generated.xcconfig', 'flutter_export_environment.sh',
            'GeneratedPluginRegistrant.h', 'GeneratedPluginRegistrant.m', '__pycache__', 'xcuserdata', 'DerivedData'}
ROOT_FILES = {'pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml'}
FOLDERS = {'lib', 'assets', 'ios', 'android', 'integration_test', 'test_driver'}

class Refused(RuntimeError):
    def __init__(self): super().__init__('Native status QA preparation refused.')

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def private_json(path, value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream: json.dump(value,stream,indent=2);stream.write('\n')

def safe_files(source):
    result=[]
    def visit(path):
        if str(path.relative_to(source)) == PIN_PATH: return
        if path.suffix.lower() in {'.p8', '.pem', '.key'}: raise Refused()
        if path.name in EXCLUDED or path.name.startswith('.') or path.suffix.lower() in {'.env','.jks','.keystore','.p12','.mobileprovision','.xcuserstate'}: return
        if path.name.lower() in {'credentials.json','native-config.json','google-services.json','googleservice-info.plist','key.properties','id_rsa','id_ed25519'}: raise Refused()
        info=path.lstat()
        if stat.S_ISLNK(info.st_mode): raise Refused()
        if stat.S_ISDIR(info.st_mode):
            for child in sorted(path.iterdir()): visit(child)
        elif stat.S_ISREG(info.st_mode): result.append(path)
        else: raise Refused()
    for child in sorted(source.iterdir()):
        if child.name in FOLDERS or child.name in ROOT_FILES: visit(child)
    return result

def ios_diagnostic_observer(original):
    # Generated QA overlay only. Keep the pinned observer and native sources
    # untouched; refuse drift instead of silently omitting the measurement.
    reads = """                let state = activity.content.state
                let rows = state.rows
                let expectedDeadline = (call.arguments as? [String: Any])?["deadline"] as? Int64"""
    replacement = """                let expectedDeadline = (call.arguments as? [String: Any])?["deadline"] as? Int64
                let observedAt = expectedDeadline.map { _ in Int64((Date().timeIntervalSince1970 * 1000).rounded()) }
                let content = activity.content
                let activityState = activity.activityState
                let state = content.state
                let rows = state.rows
                if let observedAt {
                    let code: Int
                    switch activityState {
                    case .active: code = 0
                    case .stale: code = 1
                    case .ended: code = 2
                    case .dismissed: code = 3
                    @unknown default: code = 4
                    }
                    output["nativeObservedAtEpochMs"] = observedAt
                    output["nativeStaleDateEpochMs"] = content.staleDate.map { Int64(($0.timeIntervalSince1970 * 1000).rounded()) } ?? 0
                    output["nativeActivityStateCode"] = code
                }"""
    stale = '"stale": activity.activityState == .stale'
    if original.count(reads)!=1 or original.count(stale)!=1: raise Refused()
    return original.replace(reads,replacement).replace(stale,'"stale": activityState == .stale')

def prepare(source, destination, platform, expected, target=TARGET):
    source=Path(source);destination=Path(destination)
    if platform not in {'ios','android'} or target != TARGET: raise Refused()
    if source.absolute()!=source.resolve() or not source.is_dir(): raise Refused()
    if destination.parent != Path('/private/tmp') or not re.fullmatch(r'djl-mobile-status-native-[a-z0-9-]{8,80}',destination.name): raise Refused()
    if destination.exists() or destination.is_symlink(): raise Refused()
    if not isinstance(expected,dict) or not expected: raise Refused()
    files=safe_files(source)
    # Metadata-only discovery must match the approved path set BEFORE any file
    # content is read/hashed/copied. New public files need explicit approval too.
    names={str(path.relative_to(source)) for path in files}
    if names != set(expected): raise Refused()
    for name,sha in expected.items():
        if not isinstance(name,str) or not isinstance(sha,str) or not re.fullmatch(r'[0-9a-f]{64}',sha): raise Refused()
    copied={str(p.relative_to(source)):digest(p) for p in files}
    if copied != expected: raise Refused()
    for name,anchor in [(IOS_APP,IOS_ANCHOR),(ANDROID_APP,ANDROID_ANCHOR)]:
        text=(source/name).read_text()
        if text.count(anchor)!=1 or 'NativeStatusQAObserver' in text: raise Refused()
    if TARGET not in copied: raise Refused()
    observers={'ios':'integration_test/native/ios/NativeStatusQAObserver.swift','android':'integration_test/native/android/NativeStatusQAObserver.kt'}
    if any(path not in copied for path in [*observers.values(), ANDROID_DEADLINE]): raise Refused()
    ios_observer=ios_diagnostic_observer((source/observers['ios']).read_text()) if platform=='ios' else None
    destination.mkdir(mode=0o700)
    for file in files:
        name=file.relative_to(source);output=destination/name;output.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(file,output)
        if digest(output)!=copied[str(name)]: raise Refused()
    changed=[]
    if platform=='ios':
        app=destination/IOS_APP
        original=app.read_text()
        registration='''    if let qaRegistrar = registry.registrar(forPlugin: "NativeStatusQAObserver") {
      NativeStatusQAObserver.install(messenger: qaRegistrar.messenger())
    }'''
        app.write_text(original.replace(IOS_ANCHOR,IOS_ANCHOR+'\n'+registration)+'\n'+ios_observer)
        changed.append(IOS_APP)
    else:
        app=destination/ANDROID_APP
        original=app.read_text()
        app.write_text(original.replace(ANDROID_ANCHOR,ANDROID_ANCHOR+'\n        NativeStatusQAObserver.install(this, flutterEngine.dartExecutor.binaryMessenger)'))
        observer='android/app/src/main/kotlin/app/djl/djl_mobile/NativeStatusQAObserver.kt'
        if (destination/observer).exists(): raise Refused()
        deadline='android/app/src/main/kotlin/app/djl/djl_mobile/NativeStatusDeadline.kt'
        if (destination/deadline).exists(): raise Refused()
        shutil.copy2(source/observers['android'],destination/observer)
        shutil.copy2(source/ANDROID_DEADLINE,destination/deadline)
        changed.extend([ANDROID_APP,observer,deadline])
    # Verify every shipping byte, permitting only the separate observer registration.
    records=[];diff=''
    for name,before in copied.items():
        after=digest(destination/name)
        if before!=after and name not in changed: raise Refused()
        records.append({'path':name,'before':before,'after':after})
    for name in changed:
        before=(source/name).read_text() if (source/name).exists() else ''
        diff+=''.join(difflib.unified_diff(before.splitlines(keepends=True),(destination/name).read_text().splitlines(keepends=True),fromfile='a/'+name if before else '/dev/null',tofile='b/'+name))
    (destination/'native-status-observer-only.patch').write_text(diff)
    token=secrets.token_hex(32)
    private_json(destination/'native-status-control.json',{'token':token,'port':8857,'platform':platform,'target':TARGET})
    private_json(destination/'native-status-defines.json',{'DJL_STATUS_QA_ENABLED':True,'DJL_STATUS_QA_TOKEN':token,'DJL_STATUS_QA_HOST':'10.0.2.2' if platform=='android' else '127.0.0.1'})
    manifest={'testOnly':True,'platform':platform,'target':TARGET,'sourceRoot':str(source),'changed':changed,
              'files':records,'observerSha256':digest(source/observers[platform]),'observerPatchSha256':digest(destination/'native-status-observer-only.patch'),
              'nonceSha256':hashlib.sha256(token.encode()).hexdigest()}
    if platform=='android':
        manifest['addedObserverSha256']=digest(destination/changed[-2])
        manifest['addedDeadlineSha256']=digest(destination/changed[-1])
    private_json(destination/'native-status-manifest.json',manifest)
    return manifest

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform',choices=['ios','android']);parser.add_argument('destination',type=Path)
    parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--target',default=TARGET)
    args=parser.parse_args();os.umask(0o077)
    try:
        pinned=json.loads((Path(__file__).resolve().parents[1]/'integration_test/native/status_source_hashes.json').read_text())
        prepare(args.source,args.destination,args.platform,pinned,args.target)
    except (Refused,OSError,ValueError,KeyError): raise SystemExit('Native status QA preparation refused.')
    print('Prepared TEST-ONLY isolated status adapter; no build or install performed.')

if __name__=='__main__': main()
