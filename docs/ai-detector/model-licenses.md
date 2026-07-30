# Model artifacts and licenses

The labels below are repository declarations, not a finding that the complete
training-data and model-redistribution chain is commercially cleared. The
current English and Chinese models both have unresolved provenance; see the
engineering release gate in
[`model-license-audit.md`](./model-license-audit.md).

## English

- Model: `onnx-community/tmr-ai-text-detector-ONNX`
- Revision: `b9aa251e5bcda7e429fcc936767d921435945b60`
- Repository declaration: MIT
- Quantized ONNX: 125,855,418 bytes
- SHA-256: `a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79`

## Simplified Chinese

- Conversion: `Eslzzyl/aigc-detector-zh-onnx`
- Revision: `e6c77fd62955fac134e76deb5396806f6d35fd30`
- Original model/config: `yuchuantian/AIGC_detector_zhv3`
- Original revision: `47695ff451b32c225dd938f4f478f7fdc6aa6bb0`
- Repository declaration: Apache-2.0 metadata
- Quantized ONNX: 103,097,593 bytes
- SHA-256: `57e5ec316f7ce764e94ba4f301cf492f3f22f22ea0cd3b385ebad847a42de40c`

Tokenizer/config hashes are part of `apps/server/src/aiDetector/modelManifest.ts`. DJL downloads these files after explicit user action; it does not include them in source or application artifacts. Model notices and upstream license links must remain available whenever a model is offered.
