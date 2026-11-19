import 'dart:async';
import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';
import '../../images/data/native_image_actions.dart';
import '../../workspace/domain/workspace_models.dart';

import '../../../core/design/djl_icons.dart';

class DesktopMarkdownImage extends StatefulWidget {
  const DesktopMarkdownImage({
    super.key,
    required this.path,
    required this.alt,
    required this.scope,
    required this.scopeChanges,
    required this.isCurrent,
    required this.load,
    this.canLoad,
    this.fullscreen = false,
    this.initialImage,
  });
  final String path, alt;
  final Object scope;
  final Listenable scopeChanges;
  final bool Function() isCurrent;
  final bool Function()? canLoad;
  final Future<WorkspaceImage> Function() load;
  final bool fullscreen;
  final WorkspaceImage? initialImage;
  @override
  State<DesktopMarkdownImage> createState() => _DesktopMarkdownImageState();
}

class _DesktopMarkdownImageState extends State<DesktopMarkdownImage> {
  WorkspaceImage? _image;
  int _revision = 0;
  bool _loading = false,
      _exporting = false,
      _lastReady = false,
      _attempted = false;
  bool get _ready => widget.isCurrent() && (widget.canLoad?.call() ?? true);
  String? _notice;
  @override
  void initState() {
    super.initState();
    widget.scopeChanges.addListener(_ownerChanged);
    _image = widget.isCurrent() ? widget.initialImage : null;
    _lastReady = _ready;
    if (_image == null) unawaited(_load());
  }

  void _ownerChanged() {
    final wasReady = _lastReady;
    _lastReady = _ready;
    if (widget.isCurrent()) {
      if (!_ready && _loading) {
        _revision++;
        setState(() => _loading = false);
      } else if (_ready &&
          !wasReady &&
          !_attempted &&
          _image == null &&
          !_loading) {
        unawaited(_load());
      }
      if (_ready != wasReady && _image == null) setState(() {});
      return;
    }
    if (!_loading && !_exporting && _image == null && _notice == null) return;
    _revision++;
    setState(() {
      _image = null;
      _loading = false;
      _exporting = false;
      _notice = null;
    });
  }

  @override
  void didUpdateWidget(DesktopMarkdownImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.scopeChanges != widget.scopeChanges) {
      oldWidget.scopeChanges.removeListener(_ownerChanged);
      widget.scopeChanges.addListener(_ownerChanged);
    }
    if (oldWidget.scope != widget.scope || oldWidget.path != widget.path) {
      _image = null;
      _notice = null;
      _exporting = false;
      _attempted = false;
      unawaited(_load());
    }
  }

  void _open() {
    if (!widget.isCurrent()) return;
    final source = widget, image = _image;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => DesktopMarkdownImage(
          path: source.path,
          alt: source.alt,
          scope: source.scope,
          scopeChanges: source.scopeChanges,
          isCurrent: source.isCurrent,
          load: source.load,
          canLoad: source.canLoad,
          initialImage: image,
          fullscreen: true,
        ),
      ),
    );
  }

  Future<void> _export({bool share = false, Rect? origin}) async {
    final image = _image, revision = _revision;
    if (_exporting || image == null || !widget.isCurrent()) return;
    bool current() => mounted && revision == _revision && widget.isCurrent();
    setState(() {
      _exporting = true;
      _notice = null;
    });
    try {
      final actions = NativeImageActions();
      if (share) {
        await actions.share(image.bytes, image.mimeType, origin!);
      } else {
        await actions.save(image.bytes, image.name);
      }
      if (current() && !share) setState(() => _notice = 'Saved to Photos.');
    } catch (_) {
      if (current()) {
        setState(
          () => _notice = share
              ? 'Could not share this image. Please try again.'
              : 'Could not save this image. Please try again.',
        );
      }
    } finally {
      if (current()) setState(() => _exporting = false);
    }
  }

  Future<void> _load() async {
    final revision = ++_revision;
    _loading = _ready;
    _lastReady = _ready;
    if (!_loading) return;
    _attempted = true;
    WorkspaceImage? image;
    try {
      image = await widget.load();
    } catch (_) {
      // The inline card stays quiet; opening a preview owns visible retry.
    }
    if (!mounted || revision != _revision || !widget.isCurrent()) return;
    setState(() {
      _image = image;
      _loading = false;
    });
  }

  @override
  void dispose() {
    _revision++;
    widget.scopeChanges.removeListener(_ownerChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final image = widget.isCurrent() ? _image : null;
    final theme = Theme.of(context);
    final content = image == null
        ? _metadata(theme)
        : ClipRRect(
            borderRadius: BorderRadius.circular(widget.fullscreen ? 0 : 18),
            child: Image.memory(
              image.bytes,
              width: widget.fullscreen ? MediaQuery.sizeOf(context).width : 200,
              fit: BoxFit.contain,
              semanticLabel: widget.alt.isEmpty ? image.name : widget.alt,
              errorBuilder: (_, _, _) => _metadata(theme),
            ),
          );
    if (widget.fullscreen) {
      final available = image != null && !_exporting && widget.isCurrent();
      return Scaffold(
        body: Stack(
          children: [
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      theme.colorScheme.surfaceContainerLow.withValues(
                        alpha: .65,
                      ),
                      theme.colorScheme.surface,
                    ],
                  ),
                ),
              ),
            ),
            SafeArea(
              child: Column(
                children: [
                  if (_loading || _exporting) const LinearProgressIndicator(),
                  Expanded(
                    child: Center(
                      child: image == null
                          ? Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: content,
                                ),
                                if (_ready && !_loading)
                                  Semantics(
                                    liveRegion: true,
                                    child: const Text(
                                      'Could not load this image.',
                                    ),
                                  ),
                                if (_ready)
                                  TextButton(
                                    onPressed: _loading
                                        ? null
                                        : () {
                                            setState(() => _notice = null);
                                            unawaited(_load());
                                          },
                                    child: const Text('Retry'),
                                  )
                                else
                                  Text(
                                    widget.isCurrent()
                                        ? 'Reconnect or reopen this image from its workspace.'
                                        : 'Reopen this image from its paired chat.',
                                  ),
                              ],
                            )
                          : InteractiveViewer(
                              minScale: 1,
                              maxScale: 5,
                              child: content,
                            ),
                    ),
                  ),
                  if (_notice != null)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(_notice!),
                    ),
                ],
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
                child: _previewControls(theme, available),
              ),
            ),
          ],
        ),
      );
    }
    return Semantics(
      container: true,
      button: true,
      enabled: widget.isCurrent(),
      onTap: widget.isCurrent() ? _open : null,
      label:
          'Open image ${widget.alt.isEmpty ? widget.path.split('/').last : widget.alt}',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _open,
        child: content,
      ),
    );
  }

  Widget _previewControls(ThemeData theme, bool available) => Row(
    children: [
      _previewButton(
        label: 'Close',
        icon: DjlIcons.close,
        onPressed: () => Navigator.pop(context),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Align(
          alignment: Alignment.centerLeft,
          heightFactor: 1,
          child: _previewSurface(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: SizedBox(
                height: 38,
                child: Center(
                  widthFactor: 1,
                  child: Text(
                    widget.path.split('/').last,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      Builder(
        builder: (buttonContext) => _previewButton(
          label: 'Share',
          icon: DjlIcons.share,
          onPressed: available
              ? () {
                  final box = buttonContext.findRenderObject()! as RenderBox;
                  unawaited(
                    _export(
                      share: true,
                      origin: box.localToGlobal(Offset.zero) & box.size,
                    ),
                  );
                }
              : null,
        ),
      ),
      const SizedBox(width: 4),
      _previewButton(
        label: 'Save to Photos',
        icon: DjlIcons.download,
        onPressed: available ? () => unawaited(_export()) : null,
      ),
    ],
  );

  Widget _previewSurface({required Widget child}) {
    final colors = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(30),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colors.surfaceContainerLow.withValues(alpha: .8),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(color: colors.onSurface.withValues(alpha: .06)),
          ),
          child: child,
        ),
      ),
    );
  }

  Widget _previewButton({
    required String label,
    required IconData icon,
    VoidCallback? onPressed,
  }) => SizedBox(
    width: 44,
    height: 44,
    child: Stack(
      alignment: Alignment.center,
      children: [
        _previewSurface(child: const SizedBox.square(dimension: 38)),
        IconButton(
          tooltip: label,
          color: Theme.of(context).colorScheme.onSurface,
          icon: Icon(icon, size: 17),
          onPressed: onPressed,
        ),
      ],
    ),
  );

  Widget _metadata(ThemeData theme) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: theme.colorScheme.surfaceContainerLow,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(
        color: theme.colorScheme.onSurface.withValues(alpha: .06),
      ),
    ),
    child: Row(
      children: [
        Icon(_loading ? DjlIcons.download : DjlIcons.image, size: 32),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.path.split('/').last,
                style: theme.textTheme.titleSmall,
              ),
              Text(
                widget.path,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
