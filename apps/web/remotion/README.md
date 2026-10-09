# DJL Remote motion

Run `bun run --cwd apps/web remote:studio` from the repository root, then open `http://localhost:5910/DJLRemote`.

The same `RemoteScene` composition runs in Settings through a lazily loaded Remotion Player. It is 840 × 350, 30 fps, 270 frames (9 seconds): dispersed dots assemble into the existing DJL logo, the logo moves between the iPhone and Mac, and the response appears on both screens.

The dot mask is sampled from `public/djl-logo.png`; the device artwork is vector geometry. All animation uses Remotion frame timing. The player is explicitly muted so silent autoplay does not wait on audio initialization. Settings starts it automatically and loops while visible, pauses when offscreen or hidden, and offers play/pause. Reduced-motion users receive a static device illustration without loading the player. Screen contents are illustrative, not live task or connection data.

No rendered video is required by the desktop app. Keep runtime Remotion packages and Studio pinned to matching versions.
