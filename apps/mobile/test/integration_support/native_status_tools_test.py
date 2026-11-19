"""Public fixture tests: real file copy/HTTP/phase guards; only OS boundary doubled."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
import shutil
import tempfile
import unittest
from unittest.mock import patch

TOOL = Path(__file__).resolve().parents[2] / 'tool'
def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOL / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

prep = load('prepare_native_status_qa')
qa = load('native_status_harness')

class PrepareTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/private/tmp', prefix='djl-status-tools-test-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        fixtures = {
            'pubspec.yaml': 'name: djl_mobile\n', 'pubspec.lock': 'public fixture',
            'lib/main.dart': 'void main() {}\n',
            'ios/Runner/AppDelegate.swift': prep.IOS_ANCHOR + '\n',
            'android/app/src/main/kotlin/app/djl/djl_mobile/MainActivity.kt': prep.ANDROID_ANCHOR + '\n',
            'ios/Runner/RunStatusBridge.swift': 'public bridge',
            'ios/Runner/RunStatusModel.swift': 'public model',
            'ios/DJLWidgets/RunStatusLiveActivity.swift': 'public widget',
            'integration_test/status_native_adapter_test.dart': 'public test target',
            'integration_test/native/ios/NativeStatusQAObserver.swift': (TOOL.parent/'integration_test/native/ios/NativeStatusQAObserver.swift').read_text(),
            'integration_test/native/android/NativeStatusQAObserver.kt': 'public observer',
            'integration_test/native/android/NativeStatusDeadline.kt': 'public deadline calculation',
        }
        for name, text in fixtures.items():
            file = self.source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text(text)
        self.expected = {name: hashlib.sha256((self.source/name).read_bytes()).hexdigest() for name in fixtures}
        self.dest = Path('/private/tmp') / ('djl-mobile-status-native-test-' + hashlib.sha256(str(self.root).encode()).hexdigest()[:16])
    def tearDown(self):
        if self.dest.exists(): shutil.rmtree(self.dest)
        self.temp.cleanup()
    def run_prepare(self, **kwargs):
        return prep.prepare(self.source, self.dest, 'ios', self.expected, **kwargs)
    def test_diagnostic_observer_is_generated_only_in_disposable_app_and_refuses_drift(self):
        original=(self.source/'integration_test/native/ios/NativeStatusQAObserver.swift').read_text()
        manifest=self.run_prepare()
        generated=(self.dest/prep.IOS_APP).read_text()
        self.assertEqual(generated.count('activity.content'),1)
        self.assertEqual(generated.count('activity.activityState'),1)
        for field in ['nativeObservedAtEpochMs','nativeStaleDateEpochMs','nativeActivityStateCode']:
            self.assertIn('output["'+field+'"]',generated)
            self.assertNotIn(field,original)
        self.assertEqual((self.dest/'integration_test/native/ios/NativeStatusQAObserver.swift').read_text(),original)
        self.assertEqual([row['path'] for row in manifest['files'] if row['before']!=row['after']],[prep.IOS_APP])
        self.assertEqual(manifest['observerPatchSha256'],prep.digest(self.dest/'native-status-observer-only.patch'))
        shutil.rmtree(self.dest)
        name='integration_test/native/ios/NativeStatusQAObserver.swift'
        (self.source/name).write_text(original.replace('activity.content.state','activity.content.state /* drift */'))
        self.expected[name]=prep.digest(self.source/name)
        with self.assertRaises(prep.Refused):self.run_prepare()
        self.assertFalse(self.dest.exists())

    def test_private_copy_keeps_bridge_model_widget_and_never_mutates_source(self):
        (self.source/'ios/Pods').mkdir(); (self.source/'ios/Pods/private.env').write_text('DO_NOT_COPY')
        cache=self.source/'ios/Runner.xcodeproj/xcuserdata';cache.mkdir(parents=True);(cache/'private.xcuserstate').write_text('DO_NOT_COPY')
        (self.source/'.env').write_text('DO_NOT_COPY')
        manifest = self.run_prepare()
        for name in ['ios/Runner/RunStatusBridge.swift','ios/Runner/RunStatusModel.swift','ios/DJLWidgets/RunStatusLiveActivity.swift']:
            self.assertEqual((self.dest/name).read_bytes(), (self.source/name).read_bytes())
        self.assertFalse((self.dest/'ios/Pods').exists()); self.assertFalse((self.dest/'.env').exists()); self.assertFalse((self.dest/'ios/Runner.xcodeproj/xcuserdata').exists())
        for name, sha in self.expected.items(): self.assertEqual(hashlib.sha256((self.source/name).read_bytes()).hexdigest(), sha)
        self.assertEqual(manifest['target'], prep.TARGET)
        self.assertEqual((self.dest/'native-status-control.json').stat().st_mode & 0o777, 0o600)
        self.assertNotIn('token', manifest)
    def test_native_signing_credentials_refuse_before_copy(self):
        (self.source/'android/key.properties').write_text('DO_NOT_COPY')
        with self.assertRaises(prep.Refused): self.run_prepare()
        self.assertFalse(self.dest.exists())

    def test_hash_anchor_collision_symlink_and_normal_main_refuse(self):
        cases = ['hash','anchor','symlink','target','collision']
        for case in cases:
            with self.subTest(case=case):
                if case == 'hash': self.expected['lib/main.dart'] = '0'*64
                elif case == 'anchor':
                    file=self.source/'ios/Runner/AppDelegate.swift'; file.write_text('wrong anchor'); self.expected[str(file.relative_to(self.source))]=hashlib.sha256(file.read_bytes()).hexdigest()
                elif case == 'symlink': (self.source/'assets').symlink_to(self.root, target_is_directory=True)
                elif case == 'collision': self.dest.mkdir()
                with self.assertRaises(prep.Refused): self.run_prepare(target='lib/main.dart' if case=='target' else prep.TARGET)
                self.assertFalse((self.dest/'native-status-manifest.json').exists())
                if case=='hash': self.expected['lib/main.dart']=hashlib.sha256((self.source/'lib/main.dart').read_bytes()).hexdigest()
                if case=='anchor':
                    file=self.source/'ios/Runner/AppDelegate.swift';file.write_text(prep.IOS_ANCHOR+'\n');self.expected[str(file.relative_to(self.source))]=hashlib.sha256(file.read_bytes()).hexdigest()
                if case=='symlink': (self.source/'assets').unlink()
                if self.dest.exists(): shutil.rmtree(self.dest)

class AndroidPreparationTest(unittest.TestCase):
    setUp=PrepareTest.setUp
    tearDown=PrepareTest.tearDown
    def test_android_observer_is_separate_and_ios_registration_stays_original(self):
        manifest=prep.prepare(self.source,self.dest,'android',self.expected)
        observer=self.dest/'android/app/src/main/kotlin/app/djl/djl_mobile/NativeStatusQAObserver.kt'
        self.assertTrue(observer.is_file())
        self.assertEqual((self.dest/'ios/Runner/AppDelegate.swift').read_bytes(),(self.source/'ios/Runner/AppDelegate.swift').read_bytes())
        self.assertEqual(manifest['addedObserverSha256'],prep.digest(observer))
        prep_manifest,control=qa.preparation(self.dest)
        self.assertEqual(prep_manifest['platform'],'android')
        observer.write_text('unexpected observer change')
        with self.assertRaises(qa.Refused): qa.preparation(self.dest)

class PhaseTest(unittest.TestCase):
    def test_order_native_failure_and_driver_exit_are_not_visual_success(self):
        state=qa.PhaseState('android')
        with self.assertRaises(qa.Refused): state.submit('generic', {'count':1})
        state.submit('permission_discovery', {'count':0,'pid':123})
        with self.assertRaises(qa.Refused): state.ack('permission_discovery', True)
        state.frames['permission_discovery'] = 'public PNG hash'
        with self.assertRaises(qa.Refused): state.ack('permission_discovery', False)
        state.ack('permission_discovery', True)
        with self.assertRaises(qa.Refused): state.submit('permission_denied', {'count':0,'pid':123,'permissionDenied':False})
        self.assertFalse(state.complete(0)); self.assertFalse(state.complete(1))
    def test_private_fields_and_writes_while_stopped_refuse(self):
        state=qa.PhaseState('ios')
        with self.assertRaises(qa.Refused): state.submit('permission_discovery', {'count':0,'url':'DO_NOT_LOG'})
        state.stopped=True
        with self.assertRaises(qa.Refused): state.submit('permission_discovery', {'count':0,'pid':123})
    def test_wrong_device_pid_uid_hash_and_running_systemui_guard_before_signal(self):
        # The real validator consumes authoritative identity reads. No signal is
        # reachable unless the complete, matching proof has been established.
        good={'device':'emulator-5556','avd':'DJLFlutterAOSP35QA','package':'app.djl.mobile','sha256':'a'*64,'pid':123,'uid':10123,'processUid':10123,'name':'app.djl.mobile','state':'S','systemUiPid':456,'systemUiState':'S','backgrounded':True}
        for field, value in [('device','emulator-5554'),('avd','other'),('pid',456),('processUid',0),('sha256','b'*64),('name','com.android.systemui'),('systemUiState','T'),('backgrounded',False)]:
            bad=dict(good);bad[field]=value
            with self.subTest(field=field), self.assertRaises(qa.Refused): qa.validate_android_identity(bad, 'a'*64,123)
        self.assertEqual(qa.validate_android_identity(good,'a'*64,123)['pid'],123)
    def test_ios_wrong_simulator_or_executable_refuses(self):
        good={'simulator':qa.IOS_DEVICE,'runtime':'com.apple.CoreSimulator.SimRuntime.iOS-26-0','booted':True,'bundle':'app.djl.mobile','sha256':'a'*64,'pid':123,'launchPid':123,'uid':777,'expectedUid':777,'state':'S','executable':'/owned/Runner.app/Runner','containerExecutable':'/owned/Runner.app/Runner','systemUiPid':456,'systemUiState':'S'}
        for field,value in [('simulator','other'),('launchPid',456),('executable','/owned/Widget.appex/Widget'),('sha256','b'*64),('uid',0),('systemUiState','T')]:
            bad=dict(good);bad[field]=value
            with self.subTest(field=field),self.assertRaises(qa.Refused): qa.validate_ios_identity(bad,'a'*64,123)
        self.assertEqual(qa.validate_ios_identity(good,'a'*64,123)['pid'],123)


class FakeAndroidOS:
    def __init__(self, sha):
        self.sdk='36';self.size='Physical size: 1080x2424';self.queries=[]
        self.sha=sha;self.avd='DJLFlutterAOSP35QA';self.pid=123;self.uid=10123;self.process_uid=10123
        self.name='app.djl.mobile';self.state='S';self.system_state='S';self.signals=[]
    def __call__(self, command, **kwargs):
        import subprocess
        args=command[3:];out='';self.queries.append(args)
        if args==['emu','avd','name']: out=self.avd+'\nOK\n'
        elif args==['shell','getprop','ro.build.version.sdk']: out=self.sdk
        elif args==['shell','wm','size']: out=self.size
        elif args==['shell','pm','path',qa.PACKAGE]: out='package:/data/app/owned/base.apk\n'
        elif args==['shell','sha256sum','/data/app/owned/base.apk']: out=self.sha+'  /data/app/owned/base.apk\n'
        elif args==['shell','pidof',qa.PACKAGE]: out=str(self.pid)
        elif args==['shell','run-as',qa.PACKAGE,'id','-u']: out=str(self.uid)
        elif args==['shell','cat',f'/proc/{self.pid}/status']: out=f'Uid:\t{self.process_uid}\nState:\t{self.state} (public fixture)\n'
        elif args==['shell','cat',f'/proc/{self.pid}/cmdline']: out=self.name+'\x00'
        elif args==['shell','pidof','com.android.systemui']: out='456'
        elif args==['shell','cat','/proc/456/status']: out=f'Uid:\t1000\nState:\t{self.system_state} (public fixture)\n'
        elif args==['shell','dumpsys','activity','activities']: out='mResumedActivity: public.launcher/.Launcher'
        elif args[:5]==['shell','run-as',qa.PACKAGE,'kill','-STOP']:
            self.signals.append(('STOP',args[-1]));self.state='T'
        elif args[:5]==['shell','run-as',qa.PACKAGE,'kill','-CONT']:
            self.signals.append(('CONT',args[-1]));self.state='S'
        else: raise AssertionError('Unexpected OS operation in host test')
        return subprocess.CompletedProcess(command,0,out.encode(),b'')

class RealGuardBoundaryTest(unittest.TestCase):
    def test_wrong_identity_is_rejected_by_actual_signal_method_before_signal(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            artifact=Path(folder)/'public.apk';artifact.write_bytes(b'public QA artifact');sha=prep.digest(artifact)
            for field,value in [('avd','other'),('pid',124),('process_uid',0),('sha','b'*64),('name','com.android.systemui'),('system_state','T'),('system_state','t'),('system_state','Z')]:
                fake=FakeAndroidOS(sha);setattr(fake,field,value)
                device=qa.Device.android(artifact,sha,run=fake)
                with self.subTest(field=field),self.assertRaises(qa.Refused): device.signal(123,True)
                self.assertEqual(fake.signals,[])
            import time
            fake=FakeAndroidOS(sha);device=qa.Device.android(artifact,sha,run=fake);owners=[]
            stop_args={'deadline':int(time.time()*1000)+25000,'on_stop_dispatch':lambda owner,before:owners.append(owner)}
            self.assertEqual(device.signal(123,True,**stop_args)['state'],'T')
            with self.assertRaises(qa.Refused): device.signal(123,True,**stop_args)
            with self.assertRaises(qa.Refused): device.signal(123,False)
            with self.assertRaises(qa.Refused): device.signal(123,False,owned=dict(owners[-1],uid=10124))
            self.assertEqual(fake.signals,[('STOP','123')])
            self.assertEqual(device.signal(123,False,owned=owners[-1])['state'],'S')
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')])
    def test_log_sanitizer_keeps_only_fixed_markers(self):
        text='http://127.0.0.1/private-token/ private-id DJL_STATUS_ADAPTER_GENERIC secret-title'
        self.assertEqual(qa.driver_markers(text),['DJL_STATUS_ADAPTER_GENERIC'])
        self.assertEqual(qa.driver_markers('TimeoutException with private-url'),['DJL_STATUS_DRIVER_FAILED'])

class DriverDiagnosticsTest(unittest.TestCase):
    def test_plain_sdk_failure_body_keeps_only_safe_source_coordinates(self):
        body = '''Failure Details:
Failure in method: private-method-token
The following StateError was thrown running a test:
Bad state: Native status adapter acceptance failed.
When the exception was thrown, this was the stack:
#0 privateCanary (file:///private/private-path-token/integration_test/support/native_status_acceptance.dart:30:19)
#1 privateFunction (file:///private/private-path-token/integration_test/status_native_adapter_test.dart:175:9)
<asynchronous suspension>
#2 privateFunction (package:flutter_test/src/widget_tester.dart:192:15)
end of failure 1
'''
        markers = [marker for line in body.splitlines(True) for marker in qa.driver_markers(line)]
        self.assertEqual(markers, [
            'DJL_STATUS_DRIVER_FAILED',
            'DJL_STATUS_DIAG_FRAME_SUPPORT_30_19',
            'DJL_STATUS_DIAG_FRAME_TARGET_175_9',
        ])
        self.assertNotIn('private', '\n'.join(markers))
        self.assertNotIn('file:', '\n'.join(markers))
        self.assertNotIn('Canary', '\n'.join(markers))

    def test_numeric_coordinate_and_frame_index_boundaries(self):
        prefix = 'file:///private/public-fixture/integration_test/status_native_adapter_test.dart'
        for index, line, column, want in [
            ('0', '1', '1', 'DJL_STATUS_DIAG_FRAME_TARGET_1_1'),
            ('9999', '10000', '1024', 'DJL_STATUS_DIAG_FRAME_TARGET_10000_1024'),
            ('1', '00001', '0001', 'DJL_STATUS_DIAG_FRAME_TARGET_1_1'),
        ]:
            with self.subTest(index=index, line=line, column=column):
                self.assertEqual(qa.driver_markers(f'#{index} private ({prefix}:{line}:{column})\r\n'), [want])
        for index, line, column in [
            ('10000', '1', '1'), ('-1', '1', '1'),
            ('1', '0', '1'), ('1', '10001', '1'), ('1', '100000', '1'),
            ('1', '1', '0'), ('1', '1', '1025'), ('1', '1', '10000'),
            ('1', '-1', '1'), ('1', '1', '-1'), ('1', '1.0', '1'),
            ('1', '1', '+1'), ('1', '١', '1'),
        ]:
            with self.subTest(index=index, line=line, column=column):
                self.assertEqual(qa.driver_markers(f'#{index} private ({prefix}:{line}:{column})'), [])

    def test_unknown_malformed_escaped_or_private_forms_are_dropped(self):
        path = '/private/private-token/integration_test/status_native_adapter_test.dart'
        valid = f'#0 privateFunction (file://{path}:175:9)'
        rejected = [
            '', 'Bad state: private-value',
            valid.replace('.dart:', '.dart.extra:'),
            valid.replace('/integration_test/', '/other/'),
            valid.replace('status_native_adapter_test.dart', 'native_status_acceptance.dart'),
            valid.replace('status_native_adapter_test.dart', 'support/native_status_acceptance.dart.extra'),
            valid.replace('file://', 'https://private-host'),
            valid.replace('file://', 'package:private'),
            valid.replace('file://', 'file://private-host'),
            valid.replace('file://', 'file://private-user@private-host'),
            valid.replace('file://', 'file:/'),
            valid.replace('file://', 'file:///'),
            valid.replace('/private-token/', '/private-token/../'),
            valid.replace('/private-token/', '/private-token/./'),
            valid.replace('/private-token/', '/private-token//'),
            valid.replace('/private-token/', '/private%ZZtoken/'),
            valid.replace('/private-token/', '/private%2Ftoken/'),
            valid.replace('.dart:', '.dart?private-token:'),
            valid.replace('.dart:', '.dart#private-token:'),
            valid.replace('175:9', '175'), valid.replace('175:9', '175:9:3'),
            'private-prefix ' + valid, valid + ' private-suffix',
            '\x1b[31m' + valid + '\x1b[0m',
            valid.replace('privateFunction', 'private\tFunction'),
            valid.replace('privateFunction', 'private\\nFunction'),
            valid.replace('privateFunction', 'p' * 257),
            valid.replace('/private-token/', '/' + 'p' * 4096 + '/'),
            valid + '\\n', json.dumps(valid),
            'result ' + json.dumps({'failureDetails': [json.dumps({'details': valid})]}),
        ]
        for text in rejected:
            with self.subTest(text=text[:80]):
                self.assertEqual(qa.driver_markers(text), [])

    def test_replacement_stack_does_not_invent_original_locations(self):
        body = '''Bad state: Native status adapter acceptance failed.
#0 privateFunction (file:///private/private-token/integration_test/status_native_adapter_test.dart:301:9)
'''
        self.assertEqual([marker for line in body.splitlines(True) for marker in qa.driver_markers(line)], [
            'DJL_STATUS_DIAG_FRAME_TARGET_301_9',
        ])

    def test_preserved_original_frame_sequences_distinguish_existing_boundaries(self):
        for support_line, target_line, expected in [
            (30, 175, ['DJL_STATUS_DIAG_FRAME_SUPPORT_30_19', 'DJL_STATUS_DIAG_FRAME_TARGET_175_9']),
            (214, 176, ['DJL_STATUS_DIAG_FRAME_SUPPORT_214_19', 'DJL_STATUS_DIAG_FRAME_TARGET_176_9']),
            (296, 170, ['DJL_STATUS_DIAG_FRAME_SUPPORT_296_19', 'DJL_STATUS_DIAG_FRAME_TARGET_170_9']),
        ]:
            body = [
                f'#0 private (file:///private/private-token/integration_test/support/native_status_acceptance.dart:{support_line}:19)',
                f'#1 private (file:///private/private-token/integration_test/status_native_adapter_test.dart:{target_line}:9)',
            ]
            with self.subTest(support_line=support_line):
                self.assertEqual([marker for line in body for marker in qa.driver_markers(line)], expected)

    def test_existing_markers_keep_order_and_diagnostics_do_not_make_acceptance(self):
        text = ('private-token DJL_STATUS_ADAPTER_GENERIC DJL_STATUS_ADAPTER_FAILED '
                'DJL_STATUS_ADAPTER_FINISHED VMServiceFlutterDriver: Connected to Flutter application. TimeoutException private-uri')
        self.assertEqual(qa.driver_markers(text), [
            'DJL_STATUS_ADAPTER_GENERIC', 'DJL_STATUS_ADAPTER_FAILED', 'DJL_STATUS_ADAPTER_FINISHED',
            'DJL_STATUS_DRIVER_CONNECTED', 'DJL_STATUS_DRIVER_FAILED',
        ])
        markers = qa.driver_markers('#0 private (file:///private/private-token/integration_test/status_native_adapter_test.dart:175:9)')
        self.assertEqual(markers, ['DJL_STATUS_DIAG_FRAME_TARGET_175_9'])
        for reserved in ['DJL_STATUS_DRIVER_FAILED', 'DJL_STATUS_ADAPTER_FAILED', 'CONNECTED', 'FINISHED']:
            self.assertNotIn(reserved, '\n'.join(markers))
        state = qa.PhaseState('ios')
        self.assertFalse(state.complete(0))

class FakeSocket:
    def __init__(self,request):
        import io
        self.input=io.BytesIO(request);self.output=bytearray()
    def makefile(self,*args,**kwargs): return self.input
    def sendall(self,data): self.output.extend(data)

class HttpProtectionTest(unittest.TestCase):
    def test_actual_http_handler_rejects_unauthorized_origin_and_unconfirmed_ack(self):
        import threading
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session=object.__new__(qa.Session);session.state=qa.PhaseState('android');session.lock=threading.RLock()
            session.control={'token':'a'*64};session.output=Path(folder);session.proof={};session.captures=[];session.stop_owner=None
            session.state.submit('permission_discovery',{'pid':123,'count':0});session.state.frames['permission_discovery']='public-frame-hash'
            def request(token,visual,origin=False):
                body=json.dumps({'operation':'ack','phase':'permission_discovery','visualConfirmed':visual}).encode()
                headers=f'POST /control HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nAuthorization: Bearer {token}\r\n'
                if origin: headers+='Origin: https://untrusted.invalid\r\n'
                socket=FakeSocket(headers.encode()+b'\r\n'+body)
                session.handler()(socket,('127.0.0.1',1),object())
                return bytes(socket.output)
            self.assertIn(b'403',request('b'*64,True));self.assertFalse(session.state.acked)
            self.assertIn(b'403',request('a'*64,True,True));self.assertFalse(session.state.acked)
            self.assertIn(b'409',request('a'*64,False));self.assertFalse(session.state.acked)
            output=request('a'*64,True);self.assertIn(b'200',output);self.assertTrue(session.state.acked)
            self.assertNotIn(b'a'*64,output)


class CompletionTest(unittest.TestCase):
    def test_all_phases_require_driver_connection_exit_zero_and_no_failure(self):
        import time
        state=qa.PhaseState('android')
        for phase in qa.PHASES:
            count=0 if phase in {'permission_discovery','permission_denied','generic_ended','malformed_retracted','deadline_verified','end_verified','finished'} else 1
            meta={'pid':123,'count':count,**{key:True for key in qa.BOOLS}}
            if phase=='deadline': meta['deadlineEpochMs']=int(time.time()*1000)+25000
            state.submit(phase,meta)
            if phase=='deadline':
                # Pure state fixture. Session resume separately requires the
                # real owned stopped process, native capture and manual ACK.
                state.resumed=True;state.acked=True
            elif phase!='finished':
                state.frames[phase]='public-fixture-hash';state.ack(phase,True)
        self.assertFalse(state.complete(0))
        state.driver_connected=True
        self.assertFalse(state.complete(1));self.assertTrue(state.complete(0))
        state.failed=True;self.assertFalse(state.complete(0))

    def test_stop_control_requires_fresh_pause_capture_time_and_manual_confirmation(self):
        import threading,time
        class DeviceBoundary:
            def __init__(self): self.signals=[]
            def signal(self,pid,stop,**kwargs):
                if stop: kwargs['on_stop_dispatch']({'pid':pid,'uid':10123,'sha256':'a'*64},{'systemUiPid':456})
                self.signals.append((pid,stop));return {'pid':pid,'uid':10123,'systemUiPid':456,'signalVerifiedAtEpochMs':int(time.time()*1000)}
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session=object.__new__(qa.Session);session.state=qa.PhaseState('android');session.lock=threading.RLock()
            session.output=Path(folder);session.proof={};session.captures=[];session.stop_owner=None;session.device=DeviceBoundary()
            session.state.index=qa.PHASES.index('deadline');session.state.pid=123;session.state.acked=False
            session.state.deadline=int(time.time()*1000)+25000
            body={'operation':'stop','phase':'deadline','visualConfirmed':True}
            with self.assertRaises(qa.Refused): session.control_action(body)
            session.state.frames['deadline-before']='public hash'
            with self.assertRaises(qa.Refused): session.control_action(body)
            session.state.paused=True
            with self.assertRaises(qa.Refused): session.control_action(dict(body,visualConfirmed=False))
            session.state.deadline=int(time.time()*1000)+2000
            with self.assertRaises(qa.Refused): session.control_action(body)
            self.assertEqual(session.device.signals,[])
            session.state.deadline=int(time.time()*1000)+25000
            session.control_action(body);self.assertTrue(session.state.stopped)
            with self.assertRaises(qa.Refused): session.control_action({'operation':'ack','phase':'deadline','visualConfirmed':True})
            with self.assertRaises(qa.Refused): session.control_action({'operation':'resume','phase':'deadline','visualConfirmed':True})
            session.state.frames['deadline-after']='fresh stopped frame hash'
            session.control_action({'operation':'resume','phase':'deadline','visualConfirmed':True})
            self.assertEqual(session.device.signals,[(123,True),(123,False)])
            self.assertTrue(session.proof['resumedSamePid']);self.assertTrue(session.state.acked)


class CopyApprovalRegressionTest(unittest.TestCase):
    setUp=PrepareTest.setUp
    tearDown=PrepareTest.tearDown
    run_prepare=PrepareTest.run_prepare

    def test_p8_pem_key_refuse_before_any_read_or_copy_and_keep_source(self):
        for suffix in ['.p8','.pem','.key']:
            with self.subTest(suffix=suffix):
                secret=self.source/f'ios/Signing/public-synthetic-key{suffix}'
                secret.parent.mkdir(exist_ok=True);secret.write_bytes(b'PUBLIC SYNTHETIC KEY FIXTURE ONLY')
                # Even an explicitly listed hash must never approve credential
                # suffixes. This isolates suffix refusal from extra-path refusal.
                secret_name=str(secret.relative_to(self.source))
                self.expected[secret_name]=hashlib.sha256(secret.read_bytes()).hexdigest()
                try:
                    with patch.object(prep,'digest',wraps=prep.digest) as reads, patch.object(prep.shutil,'copy2',wraps=prep.shutil.copy2) as copies:
                        refused=False
                        try: self.run_prepare()
                        except prep.Refused: refused=True
                        self.assertTrue(refused)
                        self.assertEqual(reads.call_count,0)
                        self.assertEqual(copies.call_count,0)
                    self.assertFalse(self.dest.exists())
                    self.assertEqual(secret.read_bytes(),b'PUBLIC SYNTHETIC KEY FIXTURE ONLY')
                finally:
                    secret.unlink();self.expected.pop(secret_name)
                    if self.dest.exists(): shutil.rmtree(self.dest)

    def test_extra_unapproved_public_file_refuses_before_read_or_copy(self):
        extra=self.source/'ios/public-unapproved.txt';extra.write_bytes(b'PUBLIC UNAPPROVED FIXTURE')
        with patch.object(prep,'digest',wraps=prep.digest) as reads, patch.object(prep.shutil,'copy2',wraps=prep.shutil.copy2) as copies:
            refused=False
            try: self.run_prepare()
            except prep.Refused: refused=True
            self.assertTrue(refused)
            self.assertEqual(reads.call_count,0);self.assertEqual(copies.call_count,0)
        self.assertFalse(self.dest.exists())
        self.assertEqual(extra.read_bytes(),b'PUBLIC UNAPPROVED FIXTURE')

class TransactionalAndroidOS(FakeAndroidOS):
    def __init__(self,sha,clock,mode):
        super().__init__(sha);self.clock=clock;self.mode=mode;self.triggered=False
    def __call__(self,command,**kwargs):
        import subprocess
        args=command[3:]
        if not self.triggered and self.state=='T' and args==['emu','avd','name'] and self.mode in {'post-timeout','post-timeout-new-pid','post-timeout-new-uid'}:
            self.triggered=True
            if self.mode=='post-timeout-new-pid': self.pid=124
            if self.mode=='post-timeout-new-uid': self.uid=10124;self.process_uid=10124
            raise subprocess.TimeoutExpired(command,12)
        result=super().__call__(command,**kwargs)
        if not self.triggered and args==['shell','dumpsys','activity','activities']:
            if self.mode=='slow-preflight' and self.state=='S' or self.mode=='late-confirmation' and self.state=='T':
                self.triggered=True;self.clock[0]+=26000
        return result

class SignalTransactionRegressionTest(unittest.TestCase):
    def session(self,folder,clock,mode):
        import threading
        artifact=Path(folder)/'public.apk';artifact.write_bytes(b'PUBLIC QA ARTIFACT')
        fake=TransactionalAndroidOS(prep.digest(artifact),clock,mode)
        session=object.__new__(qa.Session);session.state=qa.PhaseState('android');session.lock=threading.RLock()
        session.output=Path(folder);session.proof={};session.captures=[];session.stop_owner=None
        session.device=qa.Device.android(artifact,prep.digest(artifact),run=fake)
        session.state.index=qa.PHASES.index('deadline');session.state.pid=123;session.state.acked=False
        session.state.deadline=clock[0]+25000;session.state.paused=True;session.state.frames['deadline-before']='PUBLIC FRAME HASH'
        return session,fake
    def stop(self,session): session.control_action({'operation':'stop','phase':'deadline','visualConfirmed':True})

    def test_slow_identity_preflight_refuses_before_stop_dispatch(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            clock=[1800000000000];session,fake=self.session(folder,clock,'slow-preflight')
            with patch.object(qa.time,'time',lambda:clock[0]/1000),self.assertRaises(qa.Refused): self.stop(session)
            self.assertEqual(fake.signals,[]);self.assertTrue(session.state.failed)
            self.assertFalse(session.state.stopped)

    def test_stopped_confirmation_after_deadline_fails_and_recovers_owned_process(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            clock=[1800000000000];session,fake=self.session(folder,clock,'late-confirmation')
            with patch.object(qa.time,'time',lambda:clock[0]/1000),self.assertRaises(qa.Refused): self.stop(session)
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')]);self.assertEqual(fake.state,'S')
            self.assertTrue(session.state.failed);self.assertFalse(session.state.resumed)
            self.assertTrue(session.proof['cleanupResumedOwned'])

    def test_post_stop_timeout_preserves_failure_and_fresh_guarded_cont(self):
        import subprocess
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            clock=[1800000000000];session,fake=self.session(folder,clock,'post-timeout')
            with patch.object(qa.time,'time',lambda:clock[0]/1000),self.assertRaises(subprocess.TimeoutExpired): self.stop(session)
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')]);self.assertEqual(fake.state,'S')
            self.assertTrue(session.state.failed);self.assertIsNone(session.stop_owner)
            self.assertTrue(session.proof['stopPossiblyDispatched']);self.assertTrue(session.proof['cleanupResumedOwned'])

    def test_pixel9_late_preflight_confirmation_and_uncertain_dispatch_keep_fix1_guards(self):
        import subprocess
        for name,sdk in [('DJLFlutterPixel9QA','36'),('DJLFlutterPixel9AOSP35QA','35')]:
            for mode in ['slow-preflight','late-confirmation','post-timeout']:
                with self.subTest(mode=mode),tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
                    clock=[1800000000000];session,fake=self.session(folder,clock,mode);fake.avd=name;fake.sdk=sdk
                    error=subprocess.TimeoutExpired if mode=='post-timeout' else qa.Refused
                    with patch.object(qa.time,'time',lambda:clock[0]/1000),self.assertRaises(error): self.stop(session)
                    self.assertEqual(fake.signals,[] if mode=='slow-preflight' else [('STOP','123'),('CONT','123')])
                    self.assertTrue(session.state.failed);self.assertFalse(session.state.resumed)

    def test_recovery_refuses_changed_pid_or_uid_and_keeps_original_timeout(self):
        import subprocess
        for mode in ['post-timeout-new-pid','post-timeout-new-uid']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
                clock=[1800000000000];session,fake=self.session(folder,clock,mode)
                with patch.object(qa.time,'time',lambda:clock[0]/1000),self.assertRaises(subprocess.TimeoutExpired): self.stop(session)
                self.assertEqual(fake.signals,[('STOP','123')]);self.assertTrue(session.state.failed)
                self.assertTrue(session.proof['cleanupRefused']);self.assertIsNotNone(session.stop_owner)


class Pixel9StatusTest(unittest.TestCase):
    def test_real_identity_and_signal_transaction_bind_pixel_profile(self):
        import time
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            artifact=Path(folder)/'public.apk';artifact.write_bytes(b'public');sha=prep.digest(artifact)
            fake=FakeAndroidOS(sha);fake.avd='DJLFlutterPixel9QA';device=qa.Device.android(artifact,sha,run=fake);owners=[]
            value=device.signal(123,True,deadline=int(time.time()*1000)+25000,on_stop_dispatch=lambda owner,before:owners.append(owner))
            self.assertEqual(value['physicalSize'],(1080,2424));self.assertEqual(value['sdk'],36)
            fake.avd='DJLFlutterAOSP35QA'
            with self.assertRaises(qa.Refused): device.signal(123,False,owned=owners[-1])
            self.assertEqual(fake.signals,[('STOP','123')])
            fake.avd='DJLFlutterPixel9QA'
            self.assertEqual(device.signal(123,False,owned=owners[-1])['state'],'S')
    def test_api35_pixel9_signal_acceptance_and_cross_profile_cont_refusal(self):
        import time
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            artifact=Path(folder)/'public.apk';artifact.write_bytes(b'public');sha=prep.digest(artifact)
            fake=FakeAndroidOS(sha);fake.avd='DJLFlutterPixel9QA';device=qa.Device.android(artifact,sha,run=fake);owners=[]
            args={'deadline':int(time.time()*1000)+25000,'on_stop_dispatch':lambda owner,before:owners.append(owner)}
            device.signal(123,True,**args)
            fake.avd='DJLFlutterPixel9AOSP35QA';fake.sdk='35'
            with self.assertRaises(qa.Refused):device.signal(123,False,owned=owners[-1])
            self.assertEqual(fake.signals,[('STOP','123')])
            fake.avd='DJLFlutterPixel9QA';fake.sdk='36';device.signal(123,False,owned=owners[-1])
            fake.avd='DJLFlutterPixel9AOSP35QA';fake.sdk='35'
            value=device.signal(123,True,**args);self.assertEqual(value['sdk'],35);self.assertEqual(value['physicalSize'],(1080,2424))
            self.assertEqual(device.signal(123,False,owned=owners[-1])['state'],'S')
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123'),('STOP','123'),('CONT','123')])
            for field,value in [('sdk','36'),('size','Physical size: 1080x2400'),('size','Physical size: 1080x2424\nOverride size: 1080x2424')]:
                fake=FakeAndroidOS(sha);fake.avd='DJLFlutterPixel9AOSP35QA';fake.sdk='35';setattr(fake,field,value)
                with self.subTest(field=field),self.assertRaises(qa.Refused):qa.Device.android(artifact,sha,run=fake).signal(123,True,**args)
                self.assertEqual(fake.signals,[]);self.assertFalse(any(a[:3]==['shell','pm','path'] for a in fake.queries))

    def test_bad_pixel_metadata_refuses_before_app_reads_or_signals(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            artifact=Path(folder)/'public.apk';artifact.write_bytes(b'public');sha=prep.digest(artifact)
            for field,value in [('sdk','35'),('size','Physical size: 1080x2400'),('size','Physical size: 1080x2424\nOverride size: 1080x2424')]:
                fake=FakeAndroidOS(sha);fake.avd='DJLFlutterPixel9QA';setattr(fake,field,value)
                with self.subTest(field=field),self.assertRaises(qa.Refused): qa.Device.android(artifact,sha,run=fake).signal(123,True)
                self.assertEqual(fake.signals,[])
                self.assertFalse(any(args[:3]==['shell','pm','path'] for args in fake.queries))


class StaleDiagnosticTest(unittest.TestCase):
    def test_strict_scalar_marker_roundtrip_and_rejection(self):
        before='DJL_STATUS_DIAG_BEFORE_HOLD nativeObservedAtEpochMs=1800000000000 nativeStaleDateEpochMs=1800000025000 nativeActivityStateCode=0'
        after=before.replace('BEFORE_HOLD','AFTER_FAILED_HOLD')+' samePid=true noWrites=false'
        for value in [before, after, after.replace('samePid=true','samePid=false'), before.replace('1800000025000','0'), before.replace('1800000000000','9007199254740991'), 'DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE']:
            self.assertEqual(qa.driver_markers(value+'\n'),[value])
            self.assertEqual(qa.driver_markers('flutter: '+value+'\r\n'),[value])
        for value in [
            'private '+before, 'flutter: private '+before, 'flutter: flutter: '+before, before+' private', before+'\nsecret', before.replace('BEFORE_HOLD','AFTER_HOLD'),
            before.replace('1800000000000','9007199254740992'), before.replace('1800000000000','0'),
            before.replace('1800000000000','-1'), before.replace('1800000000000','1.5'), before.replace('1800000000000','01'),
            before.replace('nativeActivityStateCode=0','nativeActivityStateCode=5'),
            before.replace('nativeActivityStateCode=0','nativeActivityStateCode=true'),
            after.replace('samePid=true','samePid=1'), after.replace('noWrites=false','noWrites=False'),
            before+' samePid=true noWrites=true', after.rsplit(' ',1)[0],
            'DJL_STATUS_DIAG_BEFORE_HOLD UNAVAILABLE', 'DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE private',
        ]:
            with self.subTest(value=value): self.assertEqual(qa.driver_markers(value),[])

class DiagnosticRecoveryTest(unittest.TestCase):
    session=SignalTransactionRegressionTest.session
    stop=SignalTransactionRegressionTest.stop
    def stopped(self,folder):
        clock=[1800000000000];session,fake=self.session(folder,clock,'normal')
        with patch.object(qa.time,'time',lambda:clock[0]/1000):self.stop(session)
        frame=Path(folder)/'deadline-after-02.png';frame.write_bytes(b'PUBLIC FAILED FRAME')
        sha=prep.digest(frame);session.state.frames['deadline-after']=sha
        session.captures.append({'file':frame.name,'sha256':sha,'appStopped':True,'capturedAtEpochMs':1800000028000,'capturedAtMonotonicMs':28000})
        session.proof['stoppedAtDeadlineCapture']=True
        return session,fake
    def recover(self,session,**kwargs):
        session.control_action({'operation':'diagnostic-recover','phase':'deadline','visualConfirmed':False,**kwargs})
    def test_failure_persisted_before_cont_and_success_never_acknowledged(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session,fake=self.stopped(folder);real=session.device.signal;observed=[]
            def signal(*args,**kwargs):
                saved=json.loads((Path(folder)/'state.json').read_text())
                self.assertTrue(saved['failed']);self.assertTrue(saved['processProof']['diagnosticRecoveryRequested'])
                self.assertEqual(saved['processProof']['failedFrameSha256'],session.state.frames['deadline-after'])
                self.assertFalse(saved['ack']);self.assertFalse(saved['resumedSamePid'])
                observed.append(True);return real(*args,**kwargs)
            session.device.signal=signal;self.recover(session)
            self.assertEqual(observed,[True]);self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')])
            self.assertTrue(session.state.failed);self.assertFalse(session.state.acked);self.assertFalse(session.state.resumed)
            self.assertNotIn('explicitDeadlineVisualAck',session.proof);self.assertNotIn('confirmedFrameSha256',session.proof)
            self.assertTrue(session.proof['cleanupResumedOwned']);self.assertIsNone(session.stop_owner)
            session.abort_recovery();self.assertEqual(len(fake.signals),2)
            with self.assertRaises(qa.Refused):self.recover(session)
            with self.assertRaises(qa.Refused):session.state.submit('deadline_verified',{'pid':123,'count':0})
            session.state.index=qa.PHASES.index('finished');session.state.marker=True;session.state.acked=True;session.state.driver_connected=True
            self.assertFalse(session.state.complete(0))
    def test_bad_recovery_preconditions_refuse_without_signal(self):
        changes={
          'phase':lambda s:setattr(s.state,'index',qa.PHASES.index('generic')),
          'owner':lambda s:setattr(s,'stop_owner',None),
          'ownerPID':lambda s:s.stop_owner.update(pid=124),
          'verified':lambda s:s.proof.update(stoppedVerified=False),
          'recordedStop':lambda s:setattr(s.state,'stopped',False),
          'acked':lambda s:setattr(s.state,'acked',True),
          'resumed':lambda s:setattr(s.state,'resumed',True),
          'frame':lambda s:s.state.frames.pop('deadline-after'),
          'capture':lambda s:s.captures.clear(),
          'notStopped':lambda s:s.captures[0].update(appStopped=False),
          'changedFrame':lambda s:(s.output/s.captures[0]['file']).write_bytes(b'CHANGED'),
          'successAck':lambda s:s.proof.update(explicitDeadlineVisualAck=True),
          'duplicate':lambda s:s.proof.update(diagnosticRecoveryRequested=True),
        }
        for name,change in changes.items():
            with self.subTest(name=name),tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
                session,fake=self.stopped(folder);change(session)
                with self.assertRaises(qa.Refused):self.recover(session)
                self.assertEqual(fake.signals,[('STOP','123')])
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session,fake=self.stopped(folder)
            with self.assertRaises(qa.Refused):self.recover(session,visualConfirmed=True)
            self.assertEqual(fake.signals,[('STOP','123')])
    def test_changed_or_dead_process_cleanup_refuses_and_stays_failed(self):
        for field,value in [('pid',124),('uid',10124),('state','Z'),('system_state','T')]:
            with self.subTest(field=field),tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
                session,fake=self.stopped(folder);setattr(fake,field,value)
                self.recover(session)
                self.assertTrue(session.state.failed);self.assertTrue(session.proof['cleanupRefused'])
                self.assertEqual(fake.signals,[('STOP','123')]);self.assertFalse(session.state.complete(0))
    def test_cleanup_save_failure_is_reported_after_fail_was_persisted(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session,fake=self.stopped(folder);real_save=session.save;calls=[]
            def save():
                calls.append(True)
                if len(calls)==2:raise OSError('private storage error')
                real_save()
            with patch.object(session,'save',side_effect=save):
                with self.assertRaises(OSError):self.recover(session)
            self.assertTrue(session.state.failed);self.assertTrue(session.proof['diagnosticPersistenceFailed'])
            self.assertTrue(json.loads((Path(folder)/'state.json').read_text())['failed'])
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')])
            self.assertIsNone(session.stop_owner)

    def test_recovery_requires_existing_http_auth_and_returns_only_terminal_status(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session,fake=self.stopped(folder);session.control={'token':'a'*64}
            def request(token,origin=False):
                body=json.dumps({'operation':'diagnostic-recover','phase':'deadline','visualConfirmed':False}).encode()
                headers=f'POST /control HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nAuthorization: Bearer {token}\r\n'
                if origin:headers+='Origin: https://untrusted.invalid\r\n'
                socket=FakeSocket(headers.encode()+b'\r\n'+body)
                session.handler()(socket,('127.0.0.1',1),object())
                return bytes(socket.output)
            self.assertIn(b'403',request('b'*64));self.assertIn(b'403',request('a'*64,True))
            self.assertEqual(fake.signals,[('STOP','123')]);self.assertFalse(session.state.failed)
            output=request('a'*64);self.assertIn(b'200',output)
            self.assertEqual(json.loads(output.split(b'\r\n\r\n')[1]),{'phase':'deadline','ack':False,'driverConnected':False,'failed':True,'stopped':False,'resumed':False})
            self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')]);self.assertIn(b'409',request('a'*64))

    def test_failed_serve_exits_with_forged_success_markers_and_driver_zero(self):
        from types import SimpleNamespace
        for forged in [False,True]:
            with self.subTest(forged=forged),tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
                session,fake=self.stopped(folder);session.manifest={'nonceSha256':'a'*64}
                if forged:
                    marker=Path(folder)/'native-status-driver-markers.log'
                    marker.write_text('DJL_STATUS_DRIVER_CONNECTED\nDJL_STATUS_ADAPTER_FINISHED\n')
                    prep.private_json(Path(folder)/'native-status-driver-exit.json',{'exitCode':0,'markerSha256':prep.digest(marker),'nonceSha256':'a'*64})
                shutdown=[]
                # No socket/process/device creation: exercise the real serve loop
                # with a synchronous authenticated-control-equivalent callback.
                server=SimpleNamespace(serve_forever=lambda:self.recover(session),shutdown=lambda:shutdown.append(True))
                def thread(*,target,**kwargs):return SimpleNamespace(start=target)
                args=['native_status_harness.py','serve',folder,'--artifact',str(Path(folder)/'public.apk'),'--sha256','a'*64]
                with patch.object(sys,'argv',args),patch.object(qa,'Session',return_value=session),patch.object(qa,'ThreadingHTTPServer',return_value=server),patch.object(qa.threading,'Thread',side_effect=thread):
                    with self.assertRaises(SystemExit) as raised:qa.main()
                self.assertIsInstance(raised.exception.code,str);self.assertEqual(shutdown,[True])
                self.assertTrue(session.state.failed);self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')])
                self.assertFalse(session.state.complete(0))

    def test_save_failure_still_cleans_up_and_reports_separate_persistence_failure(self):
        with tempfile.TemporaryDirectory(dir='/private/tmp') as folder:
            session,fake=self.stopped(folder)
            with patch.object(session,'save',side_effect=OSError('private path')):
                with self.assertRaises(OSError):self.recover(session)
            self.assertTrue(session.state.failed);self.assertTrue(session.proof['diagnosticPersistenceFailed'])
            self.assertTrue(session.proof['cleanupResumedOwned']);self.assertEqual(fake.signals,[('STOP','123'),('CONT','123')])
            self.assertFalse(session.state.resumed);self.assertFalse(session.state.acked)

if __name__=='__main__': unittest.main()
