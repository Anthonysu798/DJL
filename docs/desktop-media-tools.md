# Bundled video tools

Desktop artifact builds stage pinned FFmpeg and FFprobe into
`Contents/Resources/media/darwin-{arm64,x64}` on macOS and `resources/media/win32-x64`
on Windows. The binaries are separate command-line programs, outside ASAR. Linux
continues to use installed system tools; this manifest does not cover Linux distributions.

`scripts/lib/desktop-media-manifest.ts` pins vendor URLs, archive and extracted-payload
SHA-256 digests, runtime versions, GPL license text, and vendor build information.
Downloads go into the ignored `.cache/djl/media-tools/` directory. The repository
contains no generated executables. A changed cached or downloaded artifact fails closed.

The selected macOS distribution is Martin Riedl's 9.0.2 static build. Windows uses
Gyan's official 9.0.2 essentials build.
Every installed target retains `LICENSE.GPLv3.txt`, `BUILD-INFO.txt`, `SOURCE.txt`,
and a provenance receipt. Source and build/dependency references accompany the binaries.
For a public release, retain access to the corresponding upstream sources and fulfill
the source-distribution obligations of those bundled GPL programs alongside the release.

The initially considered eugeneware macOS ARM64 b6.1.1 asset is deliberately excluded:
its actual runtime is 6.0, enables `nonfree`, and `-L` reports it is not redistributable.
The existing Remotion binary is also unsuitable because it omits required video filters.

To stage and verify on a matching native runner:

```sh
bun scripts/stage-desktop-media.ts --platform mac --arch arm64 --root /tmp/djl-media
bun scripts/stage-desktop-media.ts --verify --platform mac --arch arm64 --root /tmp/djl-media
```

Use `win`/`x64` or `mac`/`x64` on their respective runners. The smoke invokes the
actual pinned binaries, checks versions and licensing output, verifies executable
headers, encodes H.264/AAC with crop, scale, SAR, frame rate and a timed overlay,
probes dimensions/audio/duration, decodes the whole output and extracts a PNG cover.
macOS additionally rejects non-system dynamic-library dependencies.

The artifact builder runs this before packaging and checks the resulting resource
directory again afterward. Desktop CI's native package matrix runs the same staging
and smoke. The shared mounted macOS bundle verifier repeats it in CI and releases.
Cross-target staging checks bytes and headers; it cannot establish native execution.

App signing may replace executable signatures, changing their hashes. Vendor hashes
are enforced before signing. Packaged verification retains pinned provenance/license
checks, executable-header checks and the native smoke; the existing production app
and installer signature/notarization checks authenticate the final package.
