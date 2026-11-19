"""Host-only checks: AST extraction, fake subprocess, and stubbed JS; no server/ADB."""
import ast
import hashlib
import importlib.util
import io
from unittest import mock
import copy
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
from android_qa_device import PIXEL9, read_owned_profile
import re
import subprocess
import threading
import types
import unittest
import xml.etree.ElementTree as ET

SOURCE = Path(__file__).resolve().parents[2] / 'tool/android_simulator_browser.py'
TREE = ast.parse(SOURCE.read_text())
SURFACE = next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == 'Surface')
PAGE = ast.literal_eval(next(node.value for node in TREE.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'PAGE' for target in node.targets)))


def function(name, namespace=None):
    node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == name)
    namespace = {} if namespace is None else namespace
    exec(compile(ast.Module(body=[copy.deepcopy(node)], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace[name]


def accessibility_nodes(xml):
    get = next(node for node in SURFACE.body if isinstance(node, ast.FunctionDef) and node.name == 'do_GET')
    loop = next(node for node in ast.walk(get) if isinstance(node, ast.For) and ast.unparse(node.iter) == "root.iter('node')")
    namespace = {'root': ET.fromstring(xml), 'nodes': [], 're': re}
    exec(compile(ast.Module(body=[copy.deepcopy(loop)], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace['nodes']


class AndroidMirrorBoundaryTests(unittest.TestCase):
    def test_public_preview_pinch_uses_only_the_verified_native_test_command(self):
        expected = ['shell', 'uiautomator', 'runtest', '/data/local/tmp/owned.jar',
                    '-c', 'app.djl.qa.PublicPreviewPinchTest#testPreparedPublicPreviewPinch', '-s']
        read = mock.Mock(return_value=b'checked')
        def verify(read_args):
            self.assertEqual(read_args(['shell', 'qa-check']), b'checked')
            return expected
        guard = mock.Mock(side_effect=verify)
        command = function('input_command', {'native_pinch_command': guard, 'adb': read})
        self.assertEqual(command({'action': 'pinch-public-preview'}, 1080, 2424), expected)
        guard.assert_called_once()
        read.assert_called_once_with('shell', 'qa-check')
        for value, width, height in [
            ({'action': 'pinch-public-preview', 'package': 'another.app'}, 1080, 2424),
            ({'action': 'pinch-public-preview', 'scale': 100}, 1080, 2424),
            ({'action': 'pinch-public-preview'}, 0, 0),
            ({'action': 'pinch-public-preview'}, 1080, 2400),
        ]:
            guard.reset_mock()
            with self.subTest(value=value, width=width, height=height), self.assertRaises(ValueError):
                command(value, width, height)
            guard.assert_not_called()

    def test_public_preview_pinch_button_is_explicit_and_sends_no_geometry(self):
        button = re.search(r'<button onclick="([^"]+)">Pinch public preview</button>', PAGE)
        self.assertIsNotNone(button)
        self.assertEqual(button.group(1), "send({action:'pinch-public-preview'})")

    def test_empty_native_text_fields_expose_their_hint_or_role_for_focus(self):
        nodes = accessibility_nodes('''<hierarchy><node class='android.widget.EditText' hint='Search folders' focusable='true' enabled='true' bounds='[10,20][210,80]'/><node class='android.widget.EditText' focusable='true' enabled='true' bounds='[10,90][210,150]'/></hierarchy>''')
        self.assertEqual([node['label'] for node in nodes], ['Search folders', 'Text field'])
        self.assertTrue(all(node['clickable'] for node in nodes))
        self.assertEqual(nodes[0]['bounds'], [10, 20, 210, 80])

    def test_disabled_and_protected_text_fields_keep_native_boundaries(self):
        nodes = accessibility_nodes('''<hierarchy><node class='android.widget.EditText' hint='Folder name' focusable='true' enabled='false' bounds='[10,20][210,80]'/><node class='android.widget.EditText' text='do-not-expose' password='true' focusable='true' enabled='true' bounds='[10,90][210,150]'/></hierarchy>''')
        self.assertFalse(nodes[0]['clickable'])
        self.assertEqual(nodes[1]['label'], 'Protected field')
        self.assertNotIn('do-not-expose', str(nodes))

    def test_native_controls_without_visible_area_are_not_offered(self):
        self.assertEqual(accessibility_nodes('''<hierarchy><node class='android.widget.EditText' hint='Hidden' focusable='true' bounds='[0,0][0,0]'/><node text='Hidden button' clickable='true' bounds='[20,20][20,60]'/></hierarchy>'''), [])

    def test_accessibility_exposes_only_native_declared_long_click_targets(self):
        nodes = accessibility_nodes('<hierarchy><node text="workspace" clickable="true" long-clickable="true" bounds="[10,20][110,80]"/><node text="Other" clickable="true" bounds="[0,0][10,10]"/></hierarchy>')
        self.assertTrue(nodes[0]['longClickable'])
        self.assertNotIn('longClickable', nodes[1])

    def test_native_accessibility_hold_button_uses_its_observed_bounds(self):
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[],rendered=[];
const elements={screen:{},keys:{append(){}},native:{append(node){rendered.push(node)}},'input-status':{},'input-progress':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
const fetch=async(url,options)=>url==='/accessibility'?{ok:true,json:async()=>[{label:'workspace',clickable:true,longClickable:true,bounds:[10,20,110,80]}]}:(sent.push(JSON.parse(options.body)),{ok:true});
'''
        assertions = '''
(async()=>{
 await accessibility();
 const hold=rendered.find(node=>node.textContent==='Native hold: workspace');
 if(!hold)throw new Error('Native long-click target unavailable');
 hold.onclick();await pending;
 if(JSON.stringify(sent)!==JSON.stringify([{action:'long-press',at:[60,50]}]))throw new Error('Native hold did not preserve observed bounds');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_long_press_uses_one_fixed_bounded_screen_gesture(self):
        command = function('input_command')
        self.assertEqual(command({'action': 'long-press', 'at': [25, 45], 'duration': 90000}, 1080, 2424),
                         ['shell', 'input', 'swipe', '25', '45', '25', '45', '1500'])
        for point in [[-1, 0], [1080, 0], [0, 2424], [True, 1], [1.5, 2], ['1', 2]]:
            with self.subTest(point=point), self.assertRaises(ValueError):
                command({'action': 'long-press', 'at': point}, 1080, 2424)

    def test_actual_browser_pointer_hold_is_distinct_from_tap_and_drag(self):
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[];
const image={naturalWidth:1080,naturalHeight:2424,setPointerCapture(){},getBoundingClientRect(){return {left:0,top:0,width:1080,height:2424}}};
const elements={screen:image,keys:{append(){}},'input-status':{},'input-progress':{},'held-drag':{checked:false}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
const fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true}};
'''
        assertions = '''
(async()=>{
 const event=(x,y,timeStamp)=>({clientX:x,clientY:y,timeStamp,pointerId:1});
 screen.onpointerdown(event(25,45,100));screen.onpointerup(event(25,45,800));await pending;
 screen.onpointerdown(event(25,45,1000));screen.onpointerup(event(25,45,1100));await pending;
 screen.onpointerdown(event(25,45,2000));screen.onpointerup(event(200,400,2800));await pending;
 const expected=[{action:'long-press',at:[25,45]},{action:'tap',at:[25,45]},{action:'drag',from:[25,45],to:[200,400]}];
 if(JSON.stringify(sent)!==JSON.stringify(expected))throw new Error('Native gesture kind or geometry changed');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failed_accessibility_read_finishes_with_private_safe_error_without_retry(self):
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
let requests=0;
const elements={screen:{},keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url)=>{requests++;if(url!=='/accessibility')throw new Error('Unexpected input');throw new Error('PRIVATE_NATIVE_XML')};
'''
        assertions = '''
(async()=>{
 try{await accessibility()}catch{}
 if(elements.native.textContent!=='Native accessibility unavailable. Request a fresh snapshot.')throw new Error('Observer remained pending or exposed private error');
 if(requests!==1||elements.native.textContent.includes('PRIVATE'))throw new Error('Observer retried or leaked data');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_native_clipboard_controls_use_only_fixed_os_key_commands(self):
        command = function('input_command')
        self.assertEqual(command({'action': 'key', 'key': 'paste'}, 1080, 2424),
                         ['shell', 'input', 'keycombination', '113', '50'])
        self.assertEqual(command({'action': 'key', 'key': 'select-all'}, 1080, 2424),
                         ['shell', 'input', 'keycombination', '113', '29'])

    def test_browser_typing_maps_only_fixed_keyboard_codes(self):
        command = function('input_command')
        for key, code in [('a', '29'), ('z', '54'), ('space', '62'),
                          ('grave', '68'), ('left-bracket', '71'),
                          ('semicolon', '74'), ('tab', '61')]:
            with self.subTest(key=key):
                self.assertEqual(command({'action': 'key', 'key': key}, 1080, 2424),
                                 ['shell', 'input', 'keyevent', code])
        self.assertEqual(command({'action': 'key', 'key': '3', 'shift': True}, 1080, 2424),
                         ['shell', 'input', 'keycombination', '59', '10'])
        for value in ['true', 1, None, [], {}]:
            with self.subTest(shift=value), self.assertRaises(ValueError):
                command({'action': 'key', 'key': '3', 'shift': value}, 1080, 2424)

    def test_image_keyboard_forwards_one_validated_event_and_ignores_host_shortcuts(self):
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[];
const elements={screen:{},keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected network');sent.push(JSON.parse(options.body));return {ok:true}};
'''
        assertions = '''
(async()=>{
 setLive(false);
 if(screen.tabIndex!==0||typeof screen.onkeydown!=='function')throw new Error('Native screen has no keyboard bridge');
 let prevented=0;
 for(const key of ['a','A','#','`','[',' ', 'Enter','Backspace']){
   screen.onkeydown({key,shiftKey:key==='A'||key==='#',preventDefault(){prevented++}});
 }
 for(const event of [{key:'a',metaKey:true},{key:'v',ctrlKey:true},{key:'a',altKey:true},{key:'Shift'},{key:'Dead'},{key:'💭'}]){
   screen.onkeydown({...event,preventDefault(){throw new Error('Host shortcut swallowed')}});
 }
 await pending;
 const expected=[{action:'key',key:'a'},{action:'key',key:'a',shift:true},{action:'key',key:'3',shift:true},{action:'key',key:'grave'},{action:'key',key:'left-bracket'},{action:'key',key:'space'},{action:'key',key:'enter'},{action:'key',key:'delete'}];
 if(JSON.stringify(sent)!==JSON.stringify(expected)||prevented!==8)throw new Error('Keyboard command mapping or request count changed');
 if(elements['input-progress'].textContent!=='Native actions: 8/8 complete, 0 failed')throw new Error('Keyboard completion missing');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_password_text_and_content_description_are_both_redacted(self):
        nodes = accessibility_nodes('''<hierarchy>
          <node password="true" text="SECRET_PIN_TEXT" content-desc="SECRET_PIN_DESCRIPTION" bounds="[1,2][30,40]" clickable="true"/>
          <node password="true" text="SECRET_TEXT_ONLY" bounds="[50,60][70,80]" clickable="false"/>
          <node text="public text" content-desc="Public action" bounds="[0,0][5,5]" clickable="true"/>
        </hierarchy>''')
        self.assertEqual(nodes, [
            {'label': 'Protected field', 'bounds': [1, 2, 30, 40], 'clickable': True},
            {'label': 'Protected field', 'bounds': [50, 60, 70, 80], 'clickable': False},
            {'label': 'Public action', 'bounds': [0, 0, 5, 5], 'clickable': True},
        ])
        self.assertNotIn('SECRET_', json.dumps(nodes))

    def test_taps_drags_and_fixed_keys_preserve_bounded_commands(self):
        command = function('input_command')
        self.assertEqual(command({'action': 'tap', 'at': [0, 0]}, 1080, 2400), ['shell', 'input', 'tap', '0', '0'])
        self.assertEqual(command({'action': 'drag', 'from': [1, 2], 'to': [1079, 2399]}, 1080, 2400), ['shell', 'input', 'swipe', '1', '2', '1079', '2399', '600'])
        keys = {'home': '3', 'back': '4', 'recents': '187', 'wake': '224', 'enter': '66', 'delete': '67', **{str(n): str(n + 7) for n in range(10)}}
        for key, code in keys.items():
            self.assertEqual(command({'action': 'key', 'key': key}, 1080, 2400), ['shell', 'input', 'keyevent', code])

    def test_invalid_points_arbitrary_text_and_commands_stay_rejected(self):
        command = function('input_command')
        invalid = [
            {'action': 'tap', 'at': [-1, 0]}, {'action': 'tap', 'at': [1080, 0]},
            {'action': 'tap', 'at': [0, 2400]}, {'action': 'tap', 'at': [True, 0]},
            {'action': 'tap', 'at': ['0', 0]}, {'action': 'tap', 'at': [1.5, 0]},
            {'action': 'tap', 'at': [0]}, {'action': 'text', 'text': 'anything'},
            {'action': 'shell', 'command': 'anything'}, {'action': 'key', 'key': 'KEYCODE_POWER'},
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                command(value, 1080, 2400)

    def test_held_drag_uses_native_draganddrop_and_keeps_coordinate_bounds(self):
        command = function('input_command')
        value = {'action': 'drag-and-drop', 'from': [1, 2], 'to': [1079, 2399], 'duration': 999999, 'device': 'other'}
        self.assertEqual(command(value, 1080, 2400), ['shell', 'input', 'draganddrop', '1', '2', '1079', '2399', '600'])
        for field, point in [('from', [-1, 0]), ('to', [1080, 0]), ('to', [0, 2400]), ('from', [True, 0]), ('to', ['1', 2])]:
            with self.subTest(field=field, point=point), self.assertRaises(ValueError):
                command({**value, field: point}, 1080, 2400)

    def test_explicit_held_drag_control_preserves_normal_drag_and_tap(self):
        self.assertIn('Hold before dragging', PAGE)
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[];
const image={naturalWidth:720,naturalHeight:1600,setPointerCapture(){},getBoundingClientRect(){return {left:0,top:0,width:360,height:800}}};
const held={checked:false};
const elements={screen:image,keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'held-drag':held};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected network');sent.push(JSON.parse(options.body));return {ok:true}};
'''
        assertions = '''
(async()=>{
 const down={clientX:30,clientY:300,pointerId:1},up={clientX:150,clientY:100};
 screen.onpointerdown(down);screen.onpointerup(up);await pending;
 held.checked=true;
 screen.onpointerdown(down);screen.onpointerup(up);await pending;
 screen.onpointerdown(down);screen.onpointerup(down);await pending;
 const expected=[{action:'drag',from:[60,600],to:[300,200]},{action:'drag-and-drop',from:[60,600],to:[300,200]},{action:'tap',at:[60,600]}];
 if(JSON.stringify(sent)!==JSON.stringify(expected))throw new Error('Pointer action changed, duplicated, or ignored explicit hold');
 if(elements['input-progress'].textContent!=='Native actions: 3/3 complete, 0 failed')throw new Error('Pointer completion evidence missing');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_tile_fixture_setup_targets_only_the_fixed_djl_component(self):
        command = function('input_command')
        expected = ['shell', 'cmd', 'statusbar', 'add-tile', 'app.djl.mobile/.DJLLaunchTileService']
        self.assertEqual(command({'action': 'add-djl-tile'}, 0, 0), expected)
        self.assertEqual(command({'action': 'add-djl-tile', 'component': 'other/.Service', 'device': 'other', 'command': 'arbitrary'}, 0, 0), expected)

    def test_tile_activation_targets_only_the_registered_djl_service(self):
        command = function('input_command')
        expected = ['shell', 'cmd', 'statusbar', 'click-tile', 'app.djl.mobile/.DJLLaunchTileService']
        self.assertEqual(command({'action': 'activate-djl-tile'}, 0, 0), expected)
        self.assertEqual(command({'action': 'activate-djl-tile', 'component': 'other/.Service', 'device': 'other', 'command': 'arbitrary'}, 0, 0), expected)

    def test_tile_fixture_button_sends_only_its_fixed_setup_action(self):
        button = re.search(r'<button onclick="([^"]+)">Add DJL test tile</button>', PAGE)
        self.assertIsNotNone(button)
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[];
const elements={screen:{},keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected network');sent.push(JSON.parse(options.body));return {ok:true}};
'''
        assertions = '''
(async()=>{
 setLive(false);await (ACTION);
 if(JSON.stringify(sent)!=='[{"action":"add-djl-tile"}]')throw new Error('Fixed tile setup changed or duplicated');
 if(elements['input-progress'].textContent!=='Native actions: 1/1 complete, 0 failed')throw new Error('Setup completion evidence missing');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''.replace('ACTION', button.group(1))
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_tile_activation_button_sends_only_the_fixed_sdk_action(self):
        button = re.search(r'<button onclick="([^"]+)">Activate DJL test tile</button>', PAGE)
        self.assertIsNotNone(button)
        script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = '''
const sent=[];
const elements={screen:{},keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected network');sent.push(JSON.parse(options.body));return {ok:true}};
'''
        assertions = '''
(async()=>{
 setLive(false);await (ACTION);
 if(JSON.stringify(sent)!=='[{"action":"activate-djl-tile"}]')throw new Error('Fixed tile activation changed or duplicated');
 if(elements['input-progress'].textContent!=='Native actions: 1/1 complete, 0 failed')throw new Error('Activation completion evidence missing');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''.replace('ACTION', button.group(1))
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_device_selection_and_subprocess_arguments_remain_fixed(self):
        device = ast.literal_eval(next(node.value for node in TREE.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'DEVICE' for target in node.targets)))
        calls = []
        def fake_check_output(*args, **kwargs):
            calls.append((args, kwargs))
            return b'fixture'
        run = function('adb', {'ADB': '/fixed/adb', 'DEVICE': device, 'subprocess': types.SimpleNamespace(check_output=fake_check_output, DEVNULL=-3)})
        self.assertEqual(run('shell', 'input', 'keyevent', '3'), b'fixture')
        self.assertEqual(calls, [((['/fixed/adb', '-s', 'emulator-5556', 'shell', 'input', 'keyevent', '3'],), {'timeout': 10, 'stderr': -3})])

    def test_origin_token_geometry_and_ax_cleanup_boundaries_remain(self):
        post = next(node for node in SURFACE.body if isinstance(node, ast.FunctionDef) and node.name == 'do_POST')
        guard = ast.unparse(post.body[0].test)
        self.assertIn("self.path != '/input'", guard)
        self.assertIn("self.headers.get('Origin') not in ORIGINS", guard)
        self.assertIn("self.headers.get('X-QA-Token') != TOKEN", guard)
        self.assertIn('input_command(value, *SCREEN)', ast.unparse(post))
        self.assertNotIn('screencap', ast.unparse(post))
        origins = ast.literal_eval(next(node.value for node in TREE.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'ORIGINS' for target in node.targets)))
        self.assertEqual(origins, {'http://127.0.0.1:8856', 'http://localhost:8856'})
        bind = next(node for node in ast.walk(TREE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'ThreadingHTTPServer')
        self.assertEqual(ast.literal_eval(bind.args[0]), ('127.0.0.1', 8856))
        get = next(node for node in SURFACE.body if isinstance(node, ast.FunctionDef) and node.name == 'do_GET')
        self.assertIn("adb('shell', 'rm', '-f', path)", ast.unparse(get))

    def test_failed_frontend_actions_surface_and_do_not_poison_ordered_queue(self):
        page_script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        for failure in ['http', 'transport']:
            with self.subTest(failure=failure):
                prelude = '''
const assert = (value,message) => {if(!value)throw new Error(message)};
const sent=[], errors=[];let release, active=0,maxActive=0;
const gate=new Promise(resolve=>release=resolve);
const status={set textContent(value){if(value)errors.push(value)}};
const progressNode={};
const elements={screen:{naturalWidth:1080,naturalHeight:2400},keys:{append(){}},native:{append(){}},'input-status':status,'input-progress':progressNode};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{
 assert(url==='/input','Unexpected network URL');
 sent.push(JSON.parse(options.body).key);active++;maxActive=Math.max(active,maxActive);
 try{if(sent.length===1){await gate;if(FAILURE==='transport')throw new Error('fixture transport error');return {ok:false}}return {ok:true}}finally{active--}
};
'''.replace('FAILURE', json.dumps(failure))
                assertions = '''
(async()=>{
 const first=send({action:'key',key:'home'}),second=send({action:'key',key:'1'}),third=send({action:'key',key:'enter'});
 await Promise.resolve();await Promise.resolve();
 assert(JSON.stringify(sent)==='["home"]','Actions did not remain serialized');
 assert(progressNode.textContent==='Native actions: 0/3 complete, 0 failed','Pending native actions were not visible');
 release();const results=await Promise.allSettled([first,second,third]);
 assert(JSON.stringify(sent)==='["home","1","enter"]','Valid actions after failure were skipped or duplicated');
 assert(results[0].status==='rejected'&&results[1].status==='fulfilled'&&results[2].status==='fulfilled','Action result semantics were lost');
 assert(maxActive===1,'Actions overlapped');
 assert(errors.length===1,'Failed action was not surfaced exactly once');
 assert(progressNode.textContent==='Native actions: 3/3 complete, 1 failed','Cumulative completion/failure evidence was lost');
})().catch(error=>{console.error(error.message);process.exitCode=1});
'''
                result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + page_script + assertions], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)


    def test_paused_screenshots_allow_input_without_refresh_and_resume_polling(self):
        self.assertIn('Refresh once', PAGE)
        page_script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = """
const assert=(value,message)=>{if(!value)throw new Error(message)};
const frames=[],sent=[],timers=new Map();let nextTimer=0;
const setTimeout=callback=>{const id=++nextTimer;timers.set(id,callback);return id};
const clearTimeout=id=>timers.delete(id);
const image={naturalWidth:1080,naturalHeight:2400,set src(value){frames.push(value)}};
const elements={screen:image,keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{assert(url==='/input','Unexpected network');sent.push(JSON.parse(options.body));return {ok:true}};
"""
        assertions = """
(async()=>{
 assert(frames.length===1,'Default live frame missing');
 screen.onload();assert(timers.size===1,'Default live polling missing');
 const oldTimer=[...timers.values()][0];
 setLive(false);
 assert(timers.size===0,'Pause retained a pending timer');
 assert(elements['observer-state'].textContent==='Screenshots paused','Paused state is not visible');
 assert(elements['observer-toggle'].textContent==='Resume screenshots','Resume control missing');
 await send({action:'key',key:'home'});
 assert(sent.length===1&&sent[0].key==='home','Paused input skipped or duplicated');
 assert(frames.length===1,'Paused input refreshed the screen');
 screen.onload();screen.onerror();oldTimer();
 assert(timers.size===0&&frames.length===1,'Paused load/error/stale timer restarted observation');
 refresh(true);assert(frames.length===2,'Manual Refresh once did not capture exactly once');
 screen.onload();assert(timers.size===0,'Manual refresh resumed paused polling');
 await send({action:'key',key:'back'});
 assert(sent.length===2&&frames.length===2,'Input after manual refresh resumed observation');
 setLive(true);
 assert(frames.length===3,'Resume did not request a frame');
 assert(elements['observer-state'].textContent==='Screenshots live','Live state is not visible');
 screen.onerror();assert(timers.size===1,'Resume did not restore polling');
 [...timers.values()][0]();assert(frames.length===4,'Live polling did not refresh');
})().catch(error=>{console.error(error.message);process.exitCode=1});
"""
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + page_script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_composer_runner_uses_frame_harness_and_final_marker(self):
        runner = ast.parse((SOURCE.parent / 'run_native_android.py').read_text())
        argument = next(node for node in ast.walk(runner) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument' and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == '--journey')
        choices = ast.literal_eval(next(keyword.value for keyword in argument.keywords if keyword.arg == 'choices'))
        self.assertIn('composer', choices)
        namespace = {'args': types.SimpleNamespace(journey='composer')}
        for variable, expected in [('prefix', 'DJL_COMPOSER'), ('required', 'DJL_COMPOSER_FINISHED')]:
            assignment = next(node for node in ast.walk(runner) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == variable for target in node.targets))
            self.assertEqual(eval(compile(ast.Expression(assignment.value), str(SOURCE), 'eval'), namespace), expected)
        harness = next(node for node in ast.walk(runner) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'harness_args' for target in node.targets) and 'native_frame_harness.py' in ast.unparse(node.value))
        self.assertIn("'--prefix', prefix", ast.unparse(harness.value))


    def test_fixed_swipe_up_uses_only_positive_native_geometry(self):
        command = function('input_command')
        expected = ['shell', 'input', 'swipe', '540', '1920', '540', '480', '600']
        self.assertEqual(command({'action': 'swipe-up'}, 1080, 2400), expected)
        self.assertEqual(command({'action': 'swipe-up', 'from': [-99, -99], 'to': [0, 0], 'duration': 1, 'device': 'other-device', 'command': 'arbitrary', 'width': 2, 'height': 2}, 1080, 2400), expected)
        self.assertEqual(command({'action': 'swipe-up'}, 101, 203), ['shell', 'input', 'swipe', '50', '162', '50', '40', '600'])
        for width, height in [(0, 2400), (1080, 0), (-1, 2400), (1080, -1), (True, 2400), (1080, 1.5), ('1080', 2400)]:
            with self.subTest(width=width, height=height), self.assertRaises(ValueError):
                command({'action': 'swipe-up'}, width, height)
        self.assertEqual(command({'action': 'key', 'key': 'wake'}, 0, 0), ['shell', 'input', 'keyevent', '224'])

    def test_fixed_hold_center_and_swipe_down_ignore_client_coordinates_and_duration(self):
        command = function('input_command')
        cases = [
            ('hold-center', 1080, 2400, ['shell', 'input', 'swipe', '540', '1200', '540', '1200', '1200']),
            ('hold-center', 101, 203, ['shell', 'input', 'swipe', '50', '101', '50', '101', '1200']),
            ('swipe-down', 1080, 2400, ['shell', 'input', 'swipe', '540', '0', '540', '1920', '600']),
            ('swipe-down', 101, 203, ['shell', 'input', 'swipe', '50', '0', '50', '162', '600']),
            ('hold-center', 1, 1, ['shell', 'input', 'swipe', '0', '0', '0', '0', '1200']),
            ('swipe-down', 1, 1, ['shell', 'input', 'swipe', '0', '0', '0', '0', '600']),
        ]
        for action, width, height, expected in cases:
            with self.subTest(action=action, width=width, height=height):
                value = {'action': action, 'from': [-99, -99], 'to': [9999, 9999], 'duration': 1, 'device': 'other-device', 'command': 'arbitrary', 'width': 2, 'height': 2}
                try:
                    actual = command(value, width, height)
                except ValueError as error:
                    self.fail(f'Fixed gesture unavailable: {error}')
                self.assertEqual(actual, expected)
                for coordinate, bound in zip(actual[3:7], [width, height, width, height]):
                    self.assertTrue(0 <= int(coordinate) < bound)

    def test_fixed_gestures_reject_non_positive_or_non_integer_native_geometry(self):
        command = function('input_command')
        for action in ['hold-center', 'swipe-down']:
            for width, height in [(0, 2400), (1080, 0), (-1, 2400), (1080, -1), (True, 2400), (1080, False), (1.5, 2400), (1080, 1.5), ('1080', 2400), (1080, None)]:
                with self.subTest(action=action, width=width, height=height):
                    with self.assertRaisesRegex(ValueError, 'Native screen size unavailable'):
                        command({'action': action}, width, height)

    def test_native_wm_size_parser_prefers_override_and_rejects_invalid(self):
        parse = function('screen_size', {'re': re})
        self.assertEqual(parse('Physical size: 1080x2400\n'), (1080, 2400))
        self.assertEqual(parse('Physical size: 1080x2400\nOverride size: 720x1600\n'), (720, 1600))
        self.assertEqual(parse('Override size: 720x1600\r\nPhysical size: 1080x2400\r\n'), (720, 1600))
        self.assertEqual(parse('Override size: 720x1600\n'), (720, 1600))
        for value in ['', 'Physical size: 0x2400', 'Override size: -1x2400', 'Physical size: 1080x2400\nOverride size: invalid', 'Physical size: invalid', 'Physical size: 1080*2400']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse(value)

    def test_startup_reads_fixed_native_dimensions_without_screenshot(self):
        main = next(node for node in TREE.body if isinstance(node, ast.If) and '__name__' in ast.unparse(node.test))
        size = next(node for node in main.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'SCREEN' for target in node.targets))
        calls = []
        def fake_adb(*args):
            calls.append(args)
            return b'Physical size: 1080x2400\nOverride size: 720x1600\n'
        namespace = {'PROFILE':{'avd':'DJLFlutterQA'},'adb': fake_adb, 'screen_size': function('screen_size', {'re': re})}
        exec(compile(ast.Module(body=[copy.deepcopy(size)], type_ignores=[]), str(SOURCE), 'exec'), namespace)
        self.assertEqual(calls, [('shell', 'wm', 'size')])
        self.assertEqual(namespace['SCREEN'], (720, 1600))
        server = next(node for node in main.body if 'serve_forever' in ast.unparse(node))
        self.assertLess(main.body.index(size), main.body.index(server))
        post = next(node for node in SURFACE.body if isinstance(node, ast.FunctionDef) and node.name == 'do_POST')
        self.assertNotIn('wm', ast.unparse(post))
        self.assertNotIn('screencap', ast.unparse(post))

    def startup(self, state, name, sdk=b'36', size=b'Physical size: 1080x2424'):
        main = next(node for node in TREE.body if isinstance(node, ast.If) and '__name__' in ast.unparse(node.test))
        calls = []
        def fake_adb(*args):
            calls.append(args)
            return {('get-state',): state, ('emu', 'avd', 'name'): name, ('shell', 'getprop', 'ro.build.version.sdk'):sdk, ('shell', 'wm', 'size'):size}[args]
        def fake_server(address, surface):
            calls.append(('server', address))
            return types.SimpleNamespace(serve_forever=lambda: calls.append(('serve',)))
        def fake_skin():
            calls.append(('skin',));return {}
        namespace = {'configure_diagnostics': lambda: None, 'PIXEL9':PIXEL9,'PIXEL9_PROFILES':{PIXEL9:36,'DJLFlutterPixel9AOSP35QA':35},'read_owned_profile':read_owned_profile,'load_pixel9_skin':fake_skin,'adb': fake_adb, 'screen_size': function('screen_size', {'re': re}), 'ThreadingHTTPServer': fake_server, 'Surface': object(), 'print': lambda *args, **kwargs: None}
        try:
            exec(compile(ast.Module(body=copy.deepcopy(main.body), type_ignores=[]), str(SOURCE), 'exec'), namespace)
        except RuntimeError as error:
            return calls, error
        return calls, None

    def test_pixel9_startup_proves_sdk_geometry_and_refuses_overrides(self):
        calls,error=self.startup(b'device',b'DJLFlutterPixel9QA\nOK')
        self.assertIsNone(error)
        self.assertEqual(calls[:4],[('get-state',),('emu','avd','name'),('shell','getprop','ro.build.version.sdk'),('shell','wm','size')])
        self.assertEqual(calls.count(('shell','wm','size')),1);self.assertIn(('skin',),calls)
        for sdk,size in [(b'35',b'Physical size: 1080x2424'),(b'36',b'Physical size: 1080x2400'),(b'36',b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
            calls,error=self.startup(b'device',b'DJLFlutterPixel9QA\nOK',sdk,size)
            self.assertIsInstance(error,RuntimeError);self.assertFalse(any(c[0]=='server' for c in calls))

    def test_api35_pixel9_startup_and_exact_os_caption(self):
        calls,error=self.startup(b'device',b'DJLFlutterPixel9AOSP35QA\nOK',b'35')
        self.assertIsNone(error);self.assertEqual(calls.count(('shell','wm','size')),1);self.assertIn(('skin',),calls)
        for sdk,size in [(b'36',b'Physical size: 1080x2424'),(b'35',b'Physical size: 1080x2400'),(b'35',b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
            calls,error=self.startup(b'device',b'DJLFlutterPixel9AOSP35QA\nOK',sdk,size)
            self.assertIsInstance(error,RuntimeError);self.assertFalse(any(c[0]=='server' for c in calls))
        render=function('render_page',{'PIXEL9':PIXEL9,'PIXEL9_PROFILES':{PIXEL9:36,'DJLFlutterPixel9AOSP35QA':35},'PAGE':PAGE,'TOKEN':'public-fixture'})
        page=render({'avd':'DJLFlutterPixel9AOSP35QA','sdk':35},True)
        self.assertIn('Android 15 / API 35',page);self.assertNotIn('Android 16 / API 36',page)
        self.assertIn('class="pixel9"',page);self.assertIn('src="/skin/pixel9/mask.webp"',page)
        fallback=render({'avd':'DJLFlutterPixel9AOSP35QA','sdk':35},False)
        self.assertIn('unframed native capture (skin unavailable)',fallback);self.assertIn('class="unframed"',fallback)

    def test_profile_caption_official_layout_and_unframed_fallback(self):
        render=function('render_page',{'PIXEL9':PIXEL9,'PIXEL9_PROFILES':{PIXEL9:36,'DJLFlutterPixel9AOSP35QA':35},'PAGE':PAGE,'TOKEN':'public-fixture'})
        page=render({'avd':PIXEL9},True)
        self.assertIn('Android 16 / API 36',page);self.assertIn('physical 1080×2424',page)
        self.assertIn('class="pixel9"',page);self.assertIn('src="/skin/pixel9/mask.webp"',page)
        for value in ['1198/2531','55/1198','58/2531','1080/1198','2424/2531','pointer-events:none']:
            self.assertIn(value,page)
        fallback=render({'avd':PIXEL9},False)
        self.assertIn('unframed native capture (skin unavailable)',fallback);self.assertIn('class="unframed"',fallback)
        self.assertNotIn('src="/skin/',fallback)
        for name in ['DJLFlutterQA','DJLFlutterAOSP35QA']:
            old=render({'avd':name},False);self.assertIn('Verified '+name,old);self.assertNotIn('Verified Pixel9',old)

    def test_skin_loader_reads_only_fixed_public_assets_and_fails_closed(self):
        files=ast.literal_eval(next(n.value for n in TREE.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SKIN_FILES' for t in n.targets)))
        self.assertEqual(set(files),{'/skin/pixel9/back.webp','/skin/pixel9/mask.webp'})
        self.assertEqual({v[0] for v in files.values()},{'back.webp','mask.webp'})
        root=Path('/Applications/Android Studio.app/Contents/plugins/android/resources/device-art-resources/pixel_9')
        load=function('load_pixel9_skin',{'SKIN_ROOT':root,'SKIN_FILES':files,'hashlib':hashlib})
        # Boundary supplies public bytes; production hash constants stay real.
        fixture={str(root/'layout'):b'public layout',str(root/'back.webp'):b'public back',str(root/'mask.webp'):b'public mask'}
        layout_sha='fd024b14e9d7c38042be3d2bd4dad0e93fb3d6cfe0e1884a1d15d23063103e4a'
        fixture_sha={b'public layout':layout_sha,**{('public '+name.split('.')[0]).encode():sha for name,sha in files.values()}}
        calls=[]
        def read(path): calls.append(str(path));return fixture[str(path)]
        def hashed(data): return types.SimpleNamespace(hexdigest=lambda:fixture_sha[data])
        with mock.patch.object(Path,'read_bytes',read),mock.patch.object(hashlib,'sha256',hashed):
            self.assertEqual(set(load()),set(files));self.assertEqual(set(calls),set(fixture))
            fixture_sha[b'public mask']='0'*64;self.assertEqual(load(),{})
        with mock.patch.object(Path,'read_bytes',side_effect=OSError): self.assertEqual(load(),{})

    def test_actual_js_maps_pixel9_screen_bounds_excluding_official_bezel(self):
        script=re.search(r'<script>(.*?)</script>',PAGE,re.S).group(1)
        prelude="""
const image={naturalWidth:1080,naturalHeight:2424,getBoundingClientRect(){return {left:55/4,top:58/4,width:1080/4,height:2424/4}}};
const elements={screen:image,keys:{append(){}},'input-status':{},'input-progress':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
"""
        assertion="if(JSON.stringify(point({clientX:(55+540)/4,clientY:(58+1212)/4}))!=='[540,1212]')throw new Error('Bezel changed native point');"
        result=subprocess.run([str(Path.home()/'.bun/bin/bun'),'--eval',prelude+script+assertion],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_startup_accepts_only_owned_avd_names_before_screen_query_and_server(self):
        expected = [('get-state',), ('emu', 'avd', 'name'), ('shell', 'wm', 'size'), ('server', ('127.0.0.1', 8856)), ('serve',)]
        for name in [b'DJLFlutterQA\nOK\n', b'DJLFlutterAOSP35QA\nOK\n', b'\n DJLFlutterQA \r\n OK \r\n']:
            with self.subTest(name=name):
                calls, error = self.startup(b'device\n', name)
                self.assertIsNone(error)
                self.assertEqual(calls, expected)

    def test_startup_refuses_missing_ambiguous_or_unrelated_avd_before_screen_or_server(self):
        for name in [b'', b'OK\n', b'OtherAVD\nOK\n', b'DJLFlutterQA-copy\nOK\n', b'DJLFlutterQA\nOtherAVD\nOK\n', b'DJLFlutterQA\nDJLFlutterAOSP35QA\nOK\n', b'DJLFlutterQA\nDJLFlutterQA\nOK\n']:
            with self.subTest(name=name):
                calls, error = self.startup(b'device\n', name)
                self.assertIsInstance(error, RuntimeError)
                self.assertEqual(calls, [('get-state',), ('emu', 'avd', 'name')])

    def test_startup_refuses_offline_device_before_avd_screen_or_server(self):
        for state in [b'', b'offline\n', b'unauthorized\n']:
            with self.subTest(state=state):
                calls, error = self.startup(state, b'DJLFlutterQA\nOK\n')
                self.assertIsInstance(error, RuntimeError)
                self.assertEqual(calls, [('get-state',)])

    def test_swipe_button_does_not_need_image_geometry(self):
        button = re.search(r'<button onclick="([^"]+)">Swipe up</button>', PAGE)
        self.assertIsNotNone(button)
        self.assertIn("key('wake')", PAGE)
        page_script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = """
const sent=[],frames=[];
const image={naturalWidth:0,naturalHeight:0,getBoundingClientRect(){throw new Error('Image pointer geometry used')},set src(value){frames.push(value)}};
const elements={screen:image,keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected request');sent.push(JSON.parse(options.body));return {ok:true}};
"""
        assertions = """
(async()=>{
 setLive(false);
 await (ACTION);
 if(JSON.stringify(sent)!=='[{"action":"swipe-up"}]')throw new Error('Swipe button changed or duplicated its fixed action');
 if(frames.length!==1)throw new Error('Paused swipe triggered screenshot');
})().catch(error=>{console.error(error.message);process.exitCode=1});
""".replace('ACTION', button.group(1))
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + page_script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_hold_center_and_swipe_down_buttons_send_fixed_actions_without_image_geometry(self):
        actions = []
        for label in ['Hold screen center', 'Swipe down']:
            button = re.search(r'<button onclick="([^"]+)">' + label + '</button>', PAGE)
            self.assertIsNotNone(button, f'Missing semantic button: {label}')
            actions.append('await (' + button.group(1) + ');')
        page_script = re.search(r'<script>(.*?)</script>', PAGE, re.S).group(1)
        prelude = """
const sent=[],frames=[];
const image={naturalWidth:0,naturalHeight:0,getBoundingClientRect(){throw new Error('Image pointer geometry used')},set src(value){frames.push(value)}};
const elements={screen:image,keys:{append(){}},native:{append(){}},'input-status':{},'input-progress':{},'observer-state':{},'observer-toggle':{}};
const document={getElementById:id=>elements[id],createElement:()=>({})};
globalThis.fetch=async(url,options)=>{if(url!=='/input')throw new Error('Unexpected request');sent.push(JSON.parse(options.body));return {ok:true}};
"""
        assertions = """
(async()=>{
 setLive(false);
 ACTIONS
 if(JSON.stringify(sent)!=='[{"action":"hold-center"},{"action":"swipe-down"}]')throw new Error('Semantic buttons changed or duplicated fixed actions');
 if(frames.length!==1)throw new Error('Paused gesture triggered screenshot');
})().catch(error=>{console.error(error.message);process.exitCode=1});
""".replace('ACTIONS', '\n'.join(actions))
        result = subprocess.run([str(Path.home() / '.bun/bin/bun'), '--eval', prelude + page_script + assertions], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)



class Pixel9ViewerRequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('task33_viewer_under_test', SOURCE)
        cls.viewer=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.viewer)
    def request(self,path,method='GET',headers=None):
        viewer=self.viewer;handler=object.__new__(viewer.Surface)
        handler.path=path;handler.headers={'Host':'127.0.0.1:8856',**(headers or {})}
        handler.rfile=io.BytesIO(b'{"action":"key","key":"home"}')
        handler.result=[]
        handler.send_error=lambda code,*args:handler.result.append(('error',code))
        handler.reply=lambda data,kind:handler.result.append((kind,data))
        getattr(handler,'do_'+method)();return handler.result
    def test_capture_cleanup_cannot_delete_a_later_request_hierarchy(self):
        viewer = self.viewer
        replied, later_dumped, first_cleaned = (threading.Event() for _ in range(3))
        files, paths, errors, results = {}, [], [], []
        def dump(argv, **kwargs):
            path = argv[-1]
            files[path] = b"<hierarchy><node text='QA control' clickable='true' bounds='[0,0][100,50]'/></hierarchy>"
            paths.append(path)
            if threading.current_thread().name == 'capture-B':
                later_dumped.set()
                self.assertTrue(first_cleaned.wait(2))
            return b'dumped'
        def adb(*args):
            path = args[-1]
            if args[:2] == ('exec-out', 'cat'):
                if path not in files: raise FileNotFoundError('capture removed by another request')
                return files[path]
            self.assertEqual(args[:3], ('shell', 'rm', '-f'))
            files.pop(path, None)
            if threading.current_thread().name == 'capture-A': first_cleaned.set()
            return b''
        def capture():
            handler = object.__new__(viewer.Surface)
            handler.path = '/accessibility'
            handler.headers = {'Host': '127.0.0.1:8856'}
            def reply(data, kind):
                results.append(json.loads(data))
                if threading.current_thread().name == 'capture-A':
                    replied.set()
                    self.assertTrue(later_dumped.wait(2))
            handler.reply = reply
            try: handler.do_GET()
            except Exception as error: errors.append(type(error).__name__)
        with mock.patch.object(viewer, 'verify_profile'), mock.patch.object(viewer, 'adb', side_effect=adb), mock.patch.object(viewer.subprocess, 'check_output', side_effect=dump):
            first = threading.Thread(target=capture, name='capture-A')
            second = threading.Thread(target=capture, name='capture-B')
            first.start(); self.assertTrue(replied.wait(2)); second.start()
            first.join(3); second.join(3)
            self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(len(set(paths)), 2)
        self.assertEqual(files, {})

    def test_only_two_exact_asset_routes_and_host_allowed_without_device_access(self):
        viewer=self.viewer
        assets={'/skin/pixel9/back.webp':b'PUBLIC BACK','/skin/pixel9/mask.webp':b'PUBLIC MASK'}
        with mock.patch.object(viewer,'SKIN',assets),mock.patch.object(viewer,'adb') as adb:
            for route,data in assets.items(): self.assertEqual(self.request(route),[('image/webp',data)])
            for path in ['/skin/pixel9/layout','/skin/pixel9/back.webp?file=/etc/passwd','/skin/pixel9/../../secret','/etc/passwd']:
                self.assertEqual(self.request(path),[('error',404)])
            self.assertEqual(self.request('/skin/pixel9/back.webp',headers={'Host':'untrusted.invalid'}),[('error',403)])
            adb.assert_not_called()
    def test_frame_bytes_unchanged_and_pixel_profile_switch_refuses_before_commands(self):
        viewer=self.viewer
        native=(SOURCE.parents[1]/'integration_test/fixtures/djl-local-qa.png').read_bytes()
        legacy={'avd':'DJLFlutterAOSP35QA'}
        with mock.patch.object(viewer,'PROFILE',legacy),mock.patch.object(viewer,'read_owned_profile',return_value=legacy),mock.patch.object(viewer,'capture_owned_android_frame',return_value=native):
            self.assertEqual(self.request('/frame.png?t=1'),[('image/png',native)])
        pixel={'avd':PIXEL9,'sdk':36,'physicalSize':(1080,2424),'sizeOverride':False}
        with mock.patch.object(viewer,'PROFILE',pixel),mock.patch.object(viewer,'read_owned_profile',return_value=legacy),mock.patch.object(viewer,'adb') as adb,mock.patch.object(viewer,'capture_owned_android_frame') as capture:
            self.assertEqual(self.request('/frame.png'),[('error',409)])
            self.assertEqual(self.request('/accessibility'),[('error',409)])
            headers={'Origin':'http://127.0.0.1:8856','X-QA-Token':viewer.TOKEN,'Content-Length':'29'}
            self.assertEqual(self.request('/input','POST',headers),[('error',400)])
            adb.assert_not_called();capture.assert_not_called()
        with mock.patch.object(viewer,'PROFILE',pixel),mock.patch.object(viewer,'read_owned_profile',return_value=pixel),mock.patch.object(viewer,'capture_owned_android_frame',return_value=native):
            self.assertEqual(self.request('/frame.png'),[('error',409)])
    def test_api35_pixel9_actual_request_validates_os_before_fixed_input(self):
        viewer=self.viewer;profile={'avd':'DJLFlutterPixel9AOSP35QA','sdk':35,'physicalSize':(1080,2424),'sizeOverride':False};calls=[]
        def adb(*args):
            calls.append(args)
            if args==('shell','input','keyevent','3'):return b''
            return {('emu','avd','name'):b'DJLFlutterPixel9AOSP35QA\nOK',('shell','getprop','ro.build.version.sdk'):sdk,('shell','wm','size'):size}[args]
        headers={'Origin':'http://127.0.0.1:8856','X-QA-Token':viewer.TOKEN,'Content-Length':'29'}
        sdk=b'35';size=b'Physical size: 1080x2424'
        with mock.patch.object(viewer,'PROFILE',profile),mock.patch.object(viewer,'adb',side_effect=adb):
            self.assertEqual(self.request('/input','POST',headers),[('application/json',b'{}')])
            self.assertEqual(calls,[('emu','avd','name'),('shell','getprop','ro.build.version.sdk'),('shell','wm','size'),('shell','input','keyevent','3')])
            for sdk,size in [(b'36',b'Physical size: 1080x2424'),(b'35',b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
                calls.clear();self.assertEqual(self.request('/input','POST',headers),[('error',400)])
                self.assertFalse(any(c[:2]==('shell','input') for c in calls))

    def test_unauthorized_post_never_queries_device_and_authorized_keeps_fixed_commands(self):
        viewer=self.viewer;legacy={'avd':'DJLFlutterAOSP35QA'}
        with mock.patch.object(viewer,'read_owned_profile') as guard,mock.patch.object(viewer,'adb') as adb:
            self.assertEqual(self.request('/input','POST'),[('error',403)])
            self.assertEqual(self.request('/input','POST',{'Origin':'https://untrusted.invalid','X-QA-Token':viewer.TOKEN}),[('error',403)])
            guard.assert_not_called();adb.assert_not_called()
        body=b'{"action":"key","key":"home"}'
        with mock.patch.object(viewer,'PROFILE',legacy),mock.patch.object(viewer,'read_owned_profile',return_value=legacy),mock.patch.object(viewer,'adb') as adb:
            self.assertEqual(self.request('/input','POST',{'Origin':'http://127.0.0.1:8856','X-QA-Token':viewer.TOKEN,'Content-Length':str(len(body))}),[('application/json',b'{}')])
            adb.assert_called_once_with('shell','input','keyevent','3')


class NativeInputDiagnosticTests(unittest.TestCase):
    """Real handler/profile/validation/adb, with only external I/O mocked."""
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('task56_viewer_under_test', SOURCE)
        cls.viewer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.viewer)

    def setUp(self):
        self.viewer = type(self).viewer
        self.profile = {'avd': 'DJLFlutterPixel9AOSP35QA', 'sdk': 35, 'physicalSize': (1080, 2424), 'sizeOverride': False}
        self.queries = [('emu', 'avd', 'name'), ('shell', 'getprop', 'ro.build.version.sdk'), ('shell', 'wm', 'size')]
        self.outputs = [b'DJLFlutterPixel9AOSP35QA\nOK', b'35', b'Physical size: 1080x2424']
        self.records = []
        self.calls = []
        self.clock = iter(range(1000))
        self.patches = [
            mock.patch.object(self.viewer, 'PROFILE', self.profile),
            mock.patch.object(self.viewer, 'time', types.SimpleNamespace(monotonic=lambda: next(self.clock)), create=True),
            mock.patch.object(self.viewer, 'SCREEN', (1080, 2424)),
            mock.patch.object(self.viewer, 'DIAGNOSTICS', types.SimpleNamespace(instance='synthetic-instance', emit=self.records.append), create=True),
            mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=self.subprocess),
        ]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def subprocess(self, argv, **kwargs):
        self.assertEqual(argv[:3], [self.viewer.ADB, '-s', 'emulator-5556'])
        self.assertEqual(kwargs, {'timeout': 10, 'stderr': subprocess.DEVNULL})
        args = tuple(argv[3:])
        self.calls.append(args)
        if args in self.queries:
            return self.outputs[self.queries.index(args)]
        return b''

    def handler(self, body=b'{"action":"key","key":"home"}', path='/input', headers=None):
        handler = object.__new__(self.viewer.Surface)
        handler.path = path
        handler.headers = {'Origin': 'http://127.0.0.1:8856', 'X-QA-Token': self.viewer.TOKEN, 'Content-Length': str(len(body)), **(headers or {})}
        handler.rfile = io.BytesIO(body)
        handler.result = []
        handler.send_error = lambda code, *args: handler.result.append(('error', code))
        handler.reply = lambda data, kind: handler.result.append((kind, data))
        return handler

    def receipt(self, stage, invoked=False, outcome='not_invoked', status=400, exception=None, timeout=False, substage=None, returncode=None):
        self.assertEqual(len(self.records), 1, 'Every POST needs exactly one redacted terminal receipt')
        record = self.records[0]
        self.assertEqual(set(record), {'schema', 'event', 'server_instance', 'request_id', 'utc', 'stage', 'substage', 'total_elapsed_s', 'stage_elapsed_s', 'returncode', 'exception_class', 'timeout', 'timeout_budget_s', 'input_invoked', 'outcome', 'http_status_attempted'})
        self.assertEqual({key: record[key] for key in ['schema', 'event', 'server_instance', 'stage', 'substage', 'input_invoked', 'outcome', 'http_status_attempted', 'exception_class', 'timeout', 'timeout_budget_s', 'returncode']}, {'schema': 1, 'event': 'request', 'server_instance': 'synthetic-instance', 'stage': stage, 'substage': substage, 'input_invoked': invoked, 'outcome': outcome, 'http_status_attempted': status, 'exception_class': exception, 'timeout': timeout, 'timeout_budget_s': 10, 'returncode': returncode})
        import uuid
        uuid.UUID(record['request_id'])
        self.assertRegex(record['utc'], r'^\d{4}-\d\d-\d\dT')
        self.assertGreaterEqual(record['total_elapsed_s'], record['stage_elapsed_s'])
        self.assertGreaterEqual(record['stage_elapsed_s'], 0)
        return record

    def test_authorization_rejections_do_not_read_body_or_profile(self):
        for path, headers in [('/wrong', {}), ('/input', {'Origin': 'CANARY_ORIGIN'}), ('/input', {'X-QA-Token': 'CANARY_TOKEN'})]:
            with self.subTest(path=path, headers=headers):
                self.records.clear()
                handler = self.handler(path=path, headers=headers)
                handler.rfile = mock.Mock()
                handler.do_POST()
                self.assertEqual(handler.result, [('error', 403)])
                self.assertEqual(self.calls, [])
                handler.rfile.read.assert_not_called()
                self.receipt('authorization', status=403)

    def test_profile_exact_mismatch_keeps_input_uninvoked(self):
        self.outputs[1] = b'36'
        handler = self.handler()
        handler.do_POST()
        self.assertEqual(handler.result, [('error', 400)])
        self.assertEqual(self.calls, self.queries[:2])
        self.receipt('profile', exception='RuntimeError', substage='api')

    def test_each_profile_query_timeout_or_nonzero_stops_before_input(self):
        for index, substage in enumerate(['avd', 'api', 'geometry']):
            for timeout in [False, True]:
                with self.subTest(index=index, timeout=timeout):
                    self.records.clear()
                    self.calls.clear()
                    original = self.subprocess
                    def failing(argv, **kwargs):
                        if tuple(argv[3:]) == self.queries[index]:
                            original(argv, **kwargs)
                            if timeout:
                                raise subprocess.TimeoutExpired(['CANARY_CMD'], 10, output=b'CANARY_OUTPUT', stderr=b'CANARY_STDERR')
                            raise subprocess.CalledProcessError(19, ['CANARY_CMD'], output=b'CANARY_OUTPUT', stderr=b'CANARY_STDERR')
                        return original(argv, **kwargs)
                    with mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=failing):
                        handler = self.handler()
                        handler.do_POST()
                    self.assertEqual(handler.result, [('error', 400)])
                    self.assertEqual(self.calls, self.queries[:index + 1])
                    self.receipt('profile', substage=substage, timeout=timeout, exception='TimeoutExpired' if timeout else 'CalledProcessError', returncode=None if timeout else 19)
                    self.assertNotIn('CANARY', json.dumps(self.records))

    def test_invalid_length_json_and_input_have_distinct_stages(self):
        cases = [(b'{}', {'Content-Length': 'CANARY_LENGTH'}, 'body', 'ValueError'), (b'{}', {'Content-Length': '0'}, 'body', 'ValueError'), (b'{}', {'Content-Length': '2048'}, 'body', 'ValueError'), (b'{CANARY_JSON', {}, 'json', 'JSONDecodeError'), (b'[]', {}, 'input_validation', 'ValueError'), (b'{"action":"CANARY_ACTION"}', {}, 'input_validation', 'ValueError')]
        for body, headers, stage, exception in cases:
            with self.subTest(stage=stage, exception=exception):
                self.records.clear()
                self.calls.clear()
                handler = self.handler(body=body, headers=headers)
                handler.do_POST()
                self.assertEqual(handler.result, [('error', 400)])
                self.assertEqual(self.calls, self.queries)
                self.receipt(stage, exception=exception)
                self.assertNotIn('CANARY', json.dumps(self.records))

    def test_input_timeout_and_nonzero_are_single_attempt_effect_unknown(self):
        for timeout in [False, True]:
            with self.subTest(timeout=timeout):
                self.records.clear()
                self.calls.clear()
                def failing(argv, **kwargs):
                    value = self.subprocess(argv, **kwargs)
                    if tuple(argv[3:]) not in self.queries:
                        if timeout:
                            raise subprocess.TimeoutExpired(['CANARY_CMD'], 10, output=b'CANARY_OUTPUT', stderr=b'CANARY_STDERR')
                        raise subprocess.CalledProcessError(23, ['CANARY_CMD'], output=b'CANARY_OUTPUT', stderr=b'CANARY_STDERR')
                    return value
                with mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=failing):
                    handler = self.handler(body=b'{"action":"key","key":"8","CANARY_BODY":"CANARY_SECRET"}', headers={'Authorization': 'CANARY_AUTH', 'X-Nonce': 'CANARY_NONCE'})
                    handler.do_POST()
                self.assertEqual(handler.result, [('error', 400)])
                self.assertEqual(self.calls, self.queries + [('shell', 'input', 'keyevent', '15')])
                self.receipt('input_subprocess', invoked=True, outcome='effect_unknown', timeout=timeout, exception='TimeoutExpired' if timeout else 'CalledProcessError', returncode=None if timeout else 23)
                encoded = json.dumps(self.records)
                for forbidden in ['CANARY', 'keyevent', '"15"', '"8"', 'Authorization']:
                    self.assertNotIn(forbidden, encoded)

    def test_completed_command_keeps_fixed_argv_and_marks_only_subprocess_completion(self):
        handler = self.handler(body=b'{"action":"tap","at":[731,1817],"CANARY":"CANARY_BODY"}')
        handler.do_POST()
        self.assertEqual(handler.result, [('application/json', b'{}')])
        self.assertEqual(self.calls, self.queries + [('shell', 'input', 'tap', '731', '1817')])
        self.receipt('complete', invoked=True, outcome='subprocess_completed', status=200, returncode=0)
        for forbidden in ['CANARY', '731', '1817', 'tap']:
            self.assertNotIn(forbidden, json.dumps(self.records))

    def test_native_pinch_has_its_own_bounded_sdk_budget_and_parses_the_result(self):
        command = ['shell', 'uiautomator', 'runtest', '/data/local/tmp/owned.jar', '-c', 'fixed-case', '-s']
        output = b'QA_PUBLIC_PINCH_OK asset=p.png\nOK (1 test)'
        budgets = []
        def sdk(argv, **kwargs):
            if tuple(argv[3:]) in self.queries:
                return self.subprocess(argv, **kwargs)
            self.assertEqual(argv[3:], command)
            self.calls.append(tuple(argv[3:]))
            budgets.append(kwargs['timeout'])
            return output
        with mock.patch.object(self.viewer, 'native_pinch_command', return_value=command), \
                mock.patch.object(self.viewer, 'record_native_pinch_result') as parse, \
                mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=sdk):
            handler = self.handler(body=b'{"action":"pinch-public-preview"}')
            handler.do_POST()
            parse.assert_called_once_with(output)
        self.assertEqual(handler.result, [('application/json', b'{}')])
        self.assertEqual(budgets, [30])
        self.assertEqual(self.records[0]['timeout_budget_s'], 30)
        self.assertEqual(self.calls, self.queries + [tuple(command)])

    def test_response_write_failure_after_input_is_not_replayed(self):
        handler = self.handler()
        class FailedStream(io.BytesIO):
            def write(self, value):
                raise BrokenPipeError('CANARY_MESSAGE')
        handler.reply = self.viewer.Surface.reply.__get__(handler)
        handler.send_response = lambda code: handler.result.append(('status', code))
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        handler.wfile = FailedStream()
        with self.assertRaises(BrokenPipeError):
            handler.do_POST()
        self.assertEqual(self.calls, self.queries + [('shell', 'input', 'keyevent', '3')])
        self.receipt('response', invoked=True, outcome='subprocess_completed', status=200, returncode=0, exception='BrokenPipeError')
        self.assertNotIn('CANARY', json.dumps(self.records))

    def test_sink_failure_never_retries_input_or_changes_rejection(self):
        with mock.patch.object(self.viewer.DIAGNOSTICS, 'emit', side_effect=OSError('CANARY_SINK')):
            handler = self.handler()
            handler.do_POST()
            self.assertEqual(handler.result, [('application/json', b'{}')])
            self.assertEqual(self.calls, self.queries + [('shell', 'input', 'keyevent', '3')])
            self.calls.clear()
            handler = self.handler(headers={'X-QA-Token': 'CANARY_REJECT'})
            handler.do_POST()
            self.assertEqual(handler.result, [('error', 403)])
            self.assertEqual(self.calls, [])

    def test_disabled_diagnostics_preserve_existing_request(self):
        with mock.patch.object(self.viewer, 'DIAGNOSTICS', None):
            handler = self.handler()
            handler.do_POST()
        self.assertEqual(handler.result, [('application/json', b'{}')])
        self.assertEqual(self.records, [])
        self.assertEqual(self.calls, self.queries + [('shell', 'input', 'keyevent', '3')])

    def test_unrecognized_exception_class_and_message_stay_redacted(self):
        class CANARY_EXCEPTION(RuntimeError):
            pass
        with mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=CANARY_EXCEPTION('CANARY_MESSAGE')):
            handler = self.handler()
            handler.do_POST()
        self.assertEqual(handler.result, [('error', 400)])
        self.receipt('profile', substage='avd', exception='Exception')
        self.assertNotIn('CANARY', json.dumps(self.records))

    def test_cli_is_opt_in_and_configures_one_private_startup_sink(self):
        import os
        import tempfile
        self.assertIsNone(self.viewer.configure_diagnostics([]))
        with tempfile.TemporaryDirectory() as folder:
            os.chmod(folder, 0o700)
            path = Path(folder).resolve() / 'cli.jsonl'
            sink = self.viewer.configure_diagnostics(['--diagnostics-file', str(path)])
            try:
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['event'], 'startup')
                self.assertEqual(rows[0]['server_instance'], sink.instance)
            finally:
                sink.close()

    def test_private_startup_provenance_links_requests_without_payload(self):
        import os
        import tempfile
        self.assertTrue(callable(getattr(self.viewer, 'PrivateDiagnostics', None)), 'Missing opt-in private startup sink')
        with tempfile.TemporaryDirectory() as folder:
            os.chmod(folder, 0o700)
            path = Path(folder).resolve() / 'receipts.jsonl'
            sink = self.viewer.PrivateDiagnostics(path)
            self.addCleanup(sink.close)
            with mock.patch.object(self.viewer, 'DIAGNOSTICS', sink):
                self.handler().do_POST()
            rows = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(len(rows), 2)
            startup, request = rows
            self.assertEqual(set(startup), {'schema', 'event', 'server_instance', 'start_utc', 'pid', 'viewer_sha256', 'profile_helper_sha256'})
            self.assertEqual(startup['schema'], 1)
            self.assertEqual(startup['event'], 'startup')
            self.assertEqual(startup['pid'], os.getpid())
            self.assertEqual(startup['viewer_sha256'], hashlib.sha256(SOURCE.read_bytes()).hexdigest())
            helper = SOURCE.parent / 'android_qa_device.py'
            self.assertEqual(startup['profile_helper_sha256'], hashlib.sha256(helper.read_bytes()).hexdigest())
            self.assertEqual(request['server_instance'], startup['server_instance'])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            self.assertNotIn('CANARY', json.dumps(rows))

    def test_private_sink_rejects_symlinks_and_unsafe_permissions(self):
        import os
        import tempfile
        self.assertTrue(callable(getattr(self.viewer, 'PrivateDiagnostics', None)), 'Missing private output validation')
        with tempfile.TemporaryDirectory() as folder:
            parent = Path(folder).resolve()
            os.chmod(parent, 0o700)
            target = parent / 'target'
            target.write_text('CANARY_RETAIN')
            os.chmod(target, 0o600)
            link = parent / 'symlink'
            link.symlink_to(target)
            with self.assertRaises((ValueError, OSError)):
                self.viewer.PrivateDiagnostics(link)
            self.assertEqual(target.read_text(), 'CANARY_RETAIN')
            os.chmod(target, 0o644)
            with self.assertRaises((ValueError, OSError)):
                self.viewer.PrivateDiagnostics(target)
            fifo = parent / 'fifo'
            os.mkfifo(fifo, 0o600)
            with mock.patch.object(self.viewer.os, 'open', side_effect=AssertionError('Nonregular output must not be opened')):
                with self.assertRaises(ValueError):
                    self.viewer.PrivateDiagnostics(fifo)
            os.chmod(parent, 0o755)
            with self.assertRaises((ValueError, OSError)):
                self.viewer.PrivateDiagnostics(parent / 'unsafe-parent')

    def test_interleaved_handlers_keep_stage_and_ids_request_local(self):
        import threading
        first_in_profile = threading.Event()
        second_done = threading.Event()
        errors = []
        def interleaved(argv, **kwargs):
            if threading.current_thread().name == 'profile-failure':
                self.assertEqual(tuple(argv[3:]), self.queries[0])
                first_in_profile.set()
                if not second_done.wait(2):
                    raise AssertionError('Second handler did not complete')
                raise subprocess.TimeoutExpired(['CANARY_CMD'], 10)
            return self.subprocess(argv, **kwargs)
        first, second = self.handler(), self.handler()
        def run_first():
            try:
                first.do_POST()
            except BaseException as exc:
                errors.append(type(exc).__name__)
        with mock.patch.object(self.viewer.subprocess, 'check_output', side_effect=interleaved):
            thread = threading.Thread(target=run_first, name='profile-failure')
            thread.start()
            try:
                self.assertTrue(first_in_profile.wait(2))
                second.do_POST()
            finally:
                second_done.set()
                thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(first.result, [('error', 400)])
        self.assertEqual(second.result, [('application/json', b'{}')])
        self.assertEqual(len(self.records), 2)
        self.assertEqual(len({record['request_id'] for record in self.records}), 2)
        completed, failed = self.records
        self.assertEqual((completed['stage'], completed['input_invoked'], completed['outcome']), ('complete', True, 'subprocess_completed'))
        self.assertEqual((failed['stage'], failed['substage'], failed['input_invoked'], failed['outcome']), ('profile', 'avd', False, 'not_invoked'))
        self.assertNotIn('CANARY', json.dumps(self.records))

if __name__ == '__main__':
    unittest.main()
