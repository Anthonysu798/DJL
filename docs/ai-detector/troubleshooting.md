# Troubleshooting

- **Model not installed:** install the model for the selected or detected language. Downloads require network access once.
- **Install verification fails:** retry on a stable connection. DJL deletes partial data and will not run a corrupt model.
- **Scanned PDF:** OCR/image-only PDFs are not supported; provide a text-based PDF, DOCX, TXT, or pasted text.
- **Too little eligible prose:** add longer continuous prose. Headings, quotations, code, tables, references, and short fragments do not contribute.
- **Mixed-language error:** install both English and Simplified Chinese models or select a single language to exclude other-language paragraphs.
- **Slow first run:** the model loads lazily. Later checks in the same language avoid initialization; cache hits return derived results without inference.
- **Need to remove local data:** use **Clear cache** and **Remove model** on the detector screen.
