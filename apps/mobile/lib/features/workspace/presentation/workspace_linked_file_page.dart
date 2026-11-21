import 'dart:async';
import 'package:flutter/cupertino.dart' show CupertinoButton;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../images/data/native_image_actions.dart';
import '../data/workspace_repository.dart';
import '../domain/workspace_models.dart';
import 'workspace_code_view.dart';
import 'workspace_linked_file_controller.dart';

import '../../../core/design/djl_tokens.dart';
import '../../../core/design/djl_icons.dart';

class WorkspaceLinkedFilePage extends StatefulWidget {
  const WorkspaceLinkedFilePage({
    super.key,
    required this.repository,
    required this.path,
    this.imageActions,
  });
  final WorkspaceRepository repository;
  final String path;
  final NativeImageActions? imageActions;
  @override
  State<WorkspaceLinkedFilePage> createState() =>
      _WorkspaceLinkedFilePageState();
}

class _WorkspaceLinkedFilePageState extends State<WorkspaceLinkedFilePage> {
  late final _controller = WorkspaceLinkedFileController(widget.repository);
  late final _imageActions = widget.imageActions ?? NativeImageActions();
  Timer? _copyReset;
  bool _copied = false, _exporting = false;
  int _findRevision = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_controller.load(widget.path));
  }

  @override
  void dispose() {
    _copyReset?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _copy(WorkspaceTextFile file) async {
    await Clipboard.setData(ClipboardData(text: file.content));
    if (!mounted) return;
    unawaited(HapticFeedback.lightImpact());
    _copyReset?.cancel();
    setState(() => _copied = true);
    _copyReset = Timer(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  Future<void> _export(WorkspaceImage image, {Rect? origin}) async {
    if (_exporting) return;
    setState(() => _exporting = true);
    String? message;
    try {
      if (origin == null) {
        await _imageActions.save(image.bytes, image.name);
        message = 'Saved to Photos.';
      } else {
        await _imageActions.share(image.bytes, image.mimeType, origin);
      }
    } catch (e) {
      message = e.toString();
    }
    if (!mounted) return;
    setState(() => _exporting = false);
    if (message != null) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Image'),
          content: Text(message!),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('OK'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _controller,
    builder: (context, _) {
      final file = _controller.text;
      if (file != null) return _text(file);
      final image = _controller.image;
      if (image != null) return _image(image);
      return Scaffold(
        body: Stack(
          children: [
            Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: _controller.loading
                      ? [
                          const CircularProgressIndicator.adaptive(),
                          const SizedBox(height: 16),
                          const Text('Loading file'),
                        ]
                      : [
                          const Icon(DjlIcons.document, size: 38),
                          const SizedBox(height: 16),
                          Text(
                            widget.path.split('/').last,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            _controller.error ?? 'Unable to load file.',
                            maxLines: 5,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          TextButton(
                            onPressed: () => _controller.load(widget.path),
                            child: const Text('Retry'),
                          ),
                        ],
                ),
              ),
            ),
            _previewChrome(
              title: widget.path.split('/').last,
              closeLabel: 'Close file preview',
            ),
          ],
        ),
      );
    },
  );

  Widget _text(WorkspaceTextFile file) {
    final colors = Theme.of(context).colorScheme;
    final segments = file.path.split('/').where((s) => s.isNotEmpty).toList();
    final parent = segments.length > 1 ? segments[segments.length - 2] : null;
    final language = workspaceLanguageLabel(file.name);
    final codeLanguage = workspaceCodeLanguage(file.name);
    // Monochrome: the glyph says what kind of file it is, not a colour.
    final tint = DjlColors.of(context).ink;
    final glyph = switch (codeLanguage) {
      'bash' => DjlIcons.terminal,
      'markdown' => DjlIcons.book,
      'css' => DjlIcons.appearance,
      'ruby' => DjlIcons.diamond,
      'rust' => DjlIcons.settings,
      'sql' => DjlIcons.storage,
      'plain' => DjlIcons.document,
      _ => DjlIcons.code,
    };
    Widget chip(String text) => DecoratedBox(
      decoration: BoxDecoration(
        color: colors.onSurface.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: colors.onSurfaceVariant,
          ),
        ),
      ),
    );
    return Scaffold(
      backgroundColor: workspaceCodeBackground(context),
      appBar: AppBar(
        backgroundColor: workspaceCodeBackground(context),
        toolbarHeight: MediaQuery.textScalerOf(context).scale(28).clamp(56, 88),
        leadingWidth: 64,
        titleSpacing: 0,
        leading: TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Done'),
        ),
        title: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              file.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
            if (parent != null)
              Text(
                parent,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: colors.onSurfaceVariant),
              ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Find in file',
            onPressed: () => setState(() => _findRevision++),
            icon: const Icon(DjlIcons.search, size: 19),
          ),
          IconButton(
            tooltip: 'Reload file',
            onPressed: () => _controller.load(widget.path),
            icon: const Icon(DjlIcons.refresh, size: 19),
          ),
          IconButton(
            tooltip: 'Copy file contents',
            onPressed: () => _copy(file),
            icon: Icon(_copied ? DjlIcons.check : DjlIcons.copy, size: 19),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(
                  child: Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: tint.withValues(alpha: .14),
                      borderRadius: BorderRadius.circular(11),
                      border: Border.all(
                        color: tint.withValues(alpha: .18),
                        width: .5,
                      ),
                    ),
                    child: Icon(glyph, size: 17, color: tint),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            file.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (language != null) chip(language),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        file.path,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: 'GeistMono',
                          fontSize: 12,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          chip(_byteSize(file.byteLength)),
                          if (file.lineCount != null)
                            chip(
                              '${file.lineCount} line${file.lineCount == 1 ? '' : 's'}',
                            ),
                          chip(file.encoding.toUpperCase()),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, thickness: .5, color: colors.outlineVariant),
          Expanded(
            child: WorkspaceCodeView(file: file, findRevision: _findRevision),
          ),
        ],
      ),
    );
  }

  String _byteSize(int bytes) => bytes < 1000
      ? '$bytes ${bytes == 1 ? 'byte' : 'bytes'}'
      : bytes < 1000000
      ? '${(bytes / 1000).toStringAsFixed(bytes < 10000 ? 1 : 0)} KB'
      : '${(bytes / 1000000).toStringAsFixed(1)} MB';

  Widget _image(WorkspaceImage image) {
    final svg =
        image.mimeType.toLowerCase().contains('svg') ||
        image.name.toLowerCase().endsWith('.svg');
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          ColoredBox(color: colors.surface),
          if (!svg)
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  radius: 1.35,
                  colors: [
                    colors.primary.withValues(alpha: .1),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          InteractiveViewer(
            key: ValueKey(image),
            minScale: 1,
            maxScale: svg ? 8 : 5,
            child: SizedBox.expand(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  svg ? 88 : 0,
                  20,
                  svg ? 28 : 0,
                ),
                child: svg
                    ? SvgPicture.memory(
                        image.bytes,
                        fit: BoxFit.contain,
                        semanticsLabel: image.name,
                        errorBuilder: (_, error, stack) => _imageError(),
                      )
                    : Image.memory(
                        image.bytes,
                        fit: BoxFit.contain,
                        semanticLabel: image.name,
                        errorBuilder: (_, error, stack) => _imageError(),
                      ),
              ),
            ),
          ),
          _previewChrome(
            title: image.name,
            closeLabel: svg ? 'Close SVG preview' : 'Close',
            actions: svg
                ? [
                    _circle(
                      'Reload SVG preview',
                      DjlIcons.refresh,
                      () => _controller.load(widget.path),
                    ),
                  ]
                : [
                    Builder(
                      builder: (buttonContext) => _circle(
                        'Share',
                        DjlIcons.share,
                        _exporting
                            ? null
                            : () {
                                final box =
                                    buttonContext.findRenderObject()!
                                        as RenderBox;
                                unawaited(
                                  _export(
                                    image,
                                    origin:
                                        box.localToGlobal(Offset.zero) &
                                        box.size,
                                  ),
                                );
                              },
                      ),
                    ),
                    _circle(
                      'Save to Photos',
                      DjlIcons.download,
                      _exporting ? null : () => unawaited(_export(image)),
                    ),
                  ],
          ),
        ],
      ),
    );
  }

  Widget _imageError() => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('Unable to display image.'),
        TextButton(
          onPressed: () => _controller.load(widget.path),
          child: const Text('Retry'),
        ),
      ],
    ),
  );

  Widget _previewChrome({
    required String title,
    required String closeLabel,
    List<Widget> actions = const [],
  }) => SafeArea(
    child: Align(
      alignment: Alignment.topCenter,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 15, 15, 0),
        child: Row(
          children: [
            _circle(closeLabel, DjlIcons.close, () => Navigator.pop(context)),
            const SizedBox(width: 11),
            Expanded(
              child: Align(
                alignment: Alignment.centerLeft,
                heightFactor: 1,
                child: DjlGlassSurface(
                  radius: 999,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    child: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            ...actions,
          ],
        ),
      ),
    ),
  );

  Widget _circle(String label, IconData icon, VoidCallback? action) => Tooltip(
    message: label,
    child: CupertinoButton(
      padding: const EdgeInsets.all(3),
      minimumSize: const Size(44, 44),
      onPressed: action,
      child: SizedBox.square(
        dimension: 38,
        child: DjlGlassSurface(
          radius: 999,
          child: Center(
            child: Icon(
              icon,
              size: 17,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ),
      ),
    ),
  );
}
