"""Exact QA profiles; host callbacks only, never invokes ADB."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
from android_qa_device import read_owned_profile, validate_owned_profile

class OwnedProfileTests(unittest.TestCase):
    def read(self, name='DJLFlutterPixel9QA\nOK\n', sdk='36\n', size='Physical size: 1080x2424\n', legacy=None):
        self.calls=[]
        def query(args):
            self.calls.append(args)
            return {('emu','avd','name'):name, ('shell','getprop','ro.build.version.sdk'):sdk,
                    ('shell','wm','size'):size}[tuple(args)]
        return read_owned_profile(query, **({} if legacy is None else {'legacy_names':legacy}))
    def test_pixel9_requires_exact_sdk_and_physical_geometry(self):
        value=self.read()
        self.assertEqual(value, {'avd':'DJLFlutterPixel9QA','sdk':36,'physicalSize':(1080,2424),'sizeOverride':False})
        self.assertEqual(validate_owned_profile(value), value)
        self.assertEqual(self.calls, [['emu','avd','name'], ['shell','getprop','ro.build.version.sdk'], ['shell','wm','size']])
    def test_each_exact_pixel9_name_requires_its_own_sdk_and_typed_metadata(self):
        for name,sdk,wrong in [('DJLFlutterPixel9QA',36,35),('DJLFlutterPixel9AOSP35QA',35,36),('DJLFlutterPixel9Google35QA',35,36)]:
            good=self.read(name=name,sdk=str(sdk))
            self.assertEqual(good,{'avd':name,'sdk':sdk,'physicalSize':(1080,2424),'sizeOverride':False})
            self.assertEqual(validate_owned_profile(good),good)
            with self.assertRaises(RuntimeError): self.read(name=name,sdk=str(wrong))
            for bad in [str(sdk)+'\n'+str(sdk),'API'+str(sdk),'', '0'+str(sdk)]:
                with self.subTest(name=name,sdk=bad),self.assertRaises(RuntimeError):self.read(name=name,sdk=bad)
            for field,value in [('sdk',str(sdk)),('sdk',True),('physicalSize',(1080.0,2424)),('physicalSize',[1080,2424]),('sizeOverride',True)]:
                with self.subTest(name=name,field=field),self.assertRaises(RuntimeError):validate_owned_profile({**good,field:value})
            for size in ['Physical size: 1080x2400','Physical size: 1080x2424\nOverride size: 1080x2424','Override size: 1080x2424','','Physical size: 1080x2424\nnoise','Physical size: 1080x2424\nPhysical size: 1080x2424']:
                with self.subTest(name=name,size=size),self.assertRaises(RuntimeError):self.read(name=name,sdk=str(sdk),size=size)
            with self.assertRaises(RuntimeError):self.read(name=name,sdk=str(sdk),legacy={name})
        for name in ['DJLFlutterPixel9Google35QA-extra','DJLFlutterPixel9Google35QA\nDJLFlutterPixel9QA\nOK','DJLFlutterPixel9AOSP35QA-extra','DJLFlutterPixel9AOSP35QA\nDJLFlutterPixel9QA\nOK','DJLFlutterPixel9AOSP35QA\nDJLFlutterPixel9AOSP35QA']:
            with self.subTest(name=name),self.assertRaises(RuntimeError):self.read(name=name,sdk='35')
            self.assertEqual(self.calls,[['emu','avd','name']])

    def test_bad_sdk_size_override_and_malformed_results_refuse(self):
        for sdk in ['35','37','36\n36','API36','', '036']:
            with self.subTest(sdk=sdk), self.assertRaises(RuntimeError): self.read(sdk=sdk)
        for size in ['Physical size: 1080x2400','Physical size: 1080x2424\nOverride size: 1080x2424',
                     'Override size: 1080x2424', '', 'Physical size: 1080x2424\nnoise',
                     'Physical size: 1080x2424\nPhysical size: 1080x2424']:
            with self.subTest(size=size), self.assertRaises(RuntimeError): self.read(size=size)
    def test_unknown_or_ambiguous_name_stops_before_metadata_reads(self):
        for name in ['', 'OK', 'PersonalPixel9', 'DJLFlutterPixel9QA-extra', 'DJLFlutterPixel9QA\nDJLFlutterAOSP35QA\nOK']:
            with self.subTest(name=name), self.assertRaises(RuntimeError): self.read(name=name)
            self.assertEqual(self.calls, [['emu','avd','name']])
    def test_legacy_profiles_keep_prior_queries_and_status_subset(self):
        for name in ['DJLFlutterQA','DJLFlutterAOSP35QA']:
            self.assertEqual(self.read(name=name), {'avd':name})
            self.assertEqual(self.calls, [['emu','avd','name']])
        with self.assertRaises(RuntimeError): self.read(name='DJLFlutterQA', legacy={'DJLFlutterAOSP35QA'})
        with self.assertRaises(RuntimeError): self.read(legacy={'arbitrary'})
    def test_identity_cannot_claim_pixel9_without_typed_metadata(self):
        good=self.read()
        for change in [{'sdk':'36'},{'sdk':True},{'physicalSize':(1080,2400)},{'sizeOverride':True},{'physicalSize':None},{'physicalSize':(1080.0,2424)},{'physicalSize':[1080,2424]}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError): validate_owned_profile({**good,**change})
        with self.assertRaises(RuntimeError): validate_owned_profile({'avd':'DJLFlutterPixel9QA'})

if __name__=='__main__': unittest.main()
