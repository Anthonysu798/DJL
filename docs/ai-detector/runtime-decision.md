# Runtime decision

DJL uses `@huggingface/transformers` 4.2.0 with ONNX Runtime Node on CPU. It fits the existing Node/Electron server, provides a single packaging surface, loads pinned local tokenizer/model directories, and supports deterministic classifier inference without a separate service.

A Python worker was rejected because it adds a second runtime, subprocess lifecycle, signing/packaging burden, and more failure modes. Ollama/LM Studio and generic chat LLM scoring were rejected because generative model responses are not stable classifier probabilities and do not satisfy the product's evidence semantics. Remote detector APIs were rejected because submitted writing must stay local.

Inference always sets `allowRemoteModels = false`. Model delivery is a separate verified installer so runtime inference cannot silently fetch missing files.

Desktop builds keep the native ONNX Runtime and Sharp libraries outside ASAR compression so Electron can load the signed platform binaries. Detector weights are not bundled in the application artifact; the verified installer stores them in DJL's local state directory after explicit user action.
