# Security review

## Threats and controls

- **Malicious Office archive:** central-directory entry, path traversal, nested archive, macro, compression-ratio, entry-count, entry-size, and total expansion limits are enforced before extraction.
- **Malicious or oversized PDF:** input bytes, page count, and extracted characters are bounded. Encrypted, malformed, and image-only PDFs fail without OCR fallback.
- **Model supply-chain substitution:** repository revisions and every runtime file are pinned. Downloads are HTTPS-only, redirect-bounded, restricted to Hugging Face-controlled hosts, byte-bounded, SHA-256 verified, written to a private partial directory, and atomically promoted.
- **Partial/corrupt installation:** a model is ready only when every file matches install metadata and its exact size. Metadata is written last, and every installed file is re-hashed against the pinned SHA-256 manifest immediately before runtime loading. A same-size modification therefore fails closed instead of reaching ONNX Runtime.
- **Cross-origin request:** the endpoint applies DJL authentication and trusted-origin/CORS checks.
- **Content disclosure through cache/export/logs:** the cache strips content, export omits it by default, and the route has no content logging.
- **Resource exhaustion:** concurrent requests are coordinated while native inference is serialized, model loading is lazy, request bodies and document/archive expansion are bounded, install progress is coalesced, and cancellation is checked during extraction, tokenization, and between passages.

Residual risk includes vulnerabilities in ONNX Runtime, tokenizers, PDF.js, and archive parsing. Dependency updates and model changes must follow the release process and re-run security fixtures.
