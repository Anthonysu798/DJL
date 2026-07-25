# Privacy model

- Submitted text and files are processed inside the local DJL server.
- Inference disables remote model loading and points Transformers.js at DJL's verified model directory.
- Document text, filenames, extracted passages, and results are not logged or sent to analytics.
- The persistent result cache contains a SHA-256 content digest and derived scores/regions only; it contains no text or filename. Users can clear it from the screen.
- Model installation downloads only the public files in the pinned manifest. No document-derived value is attached to those requests.
- Exports are explicit local saves. Analyzed text is excluded by default and included only when the user checks the inclusion control.

The loopback HTTP route uses DJL's existing session authentication and trusted-origin policy. `Cache-Control: no-store` prevents response caching.
