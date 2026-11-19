import 'package:flutter/cupertino.dart' show CupertinoButton, CupertinoIcons;
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../chat/data/cloud_repository.dart';
import '../../chat/presentation/message_view.dart' show CloudImage;
import 'image_export_controller.dart';

class ImagePreviewPage extends StatefulWidget {
  const ImagePreviewPage({
    super.key,
    required this.repository,
    required this.fileId,
    required this.mimeType,
  });
  final CloudRepository repository;
  final String fileId, mimeType;
  @override
  State<ImagePreviewPage> createState() => _ImagePreviewPageState();
}

class _ImagePreviewPageState extends State<ImagePreviewPage> {
  late final ImageExportController _export;
  @override
  void initState() {
    super.initState();
    _export = ImageExportController(widget.repository);
  }

  @override
  void dispose() {
    _export.dispose();
    super.dispose();
  }

  Widget _button(String label, IconData icon, VoidCallback? action) => Tooltip(
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

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _export,
    builder: (context, _) {
      final theme = Theme.of(context), colors = theme.colorScheme;
      final dark = theme.brightness == Brightness.dark;
      return Scaffold(
        body: Stack(
          fit: StackFit.expand,
          children: [
            ColoredBox(color: colors.surface),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    colors.surfaceContainerLow.withValues(
                      alpha: dark ? .82 : .65,
                    ),
                    colors.surface,
                  ],
                ),
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  radius: 1.35,
                  colors: [
                    cloudActionColor(
                      context,
                    ).withValues(alpha: dark ? .14 : .08),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
            InteractiveViewer(
              minScale: 1,
              maxScale: 5,
              child: SizedBox.expand(
                child: CloudImage(
                  repository: widget.repository,
                  fileId: widget.fileId,
                ),
              ),
            ),
            SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(15, 15, 15, 0),
                    child: Row(
                      children: [
                        _button(
                          'Close',
                          CupertinoIcons.xmark,
                          () => Navigator.pop(context),
                        ),
                        const SizedBox(width: 11),
                        Expanded(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: DjlGlassSurface(
                              radius: 999,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 10,
                                ),
                                child: Text(
                                  'Your image',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    color: colors.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Builder(
                          builder: (buttonContext) => _button(
                            'Share',
                            CupertinoIcons.share,
                            _export.busy
                                ? null
                                : () {
                                    final box =
                                        buttonContext.findRenderObject()!
                                            as RenderBox;
                                    _export.share(
                                      widget.fileId,
                                      widget.mimeType,
                                      box.localToGlobal(Offset.zero) & box.size,
                                    );
                                  },
                          ),
                        ),
                        const SizedBox(width: 4),
                        _button(
                          'Save to Photos',
                          CupertinoIcons.square_arrow_down,
                          _export.busy
                              ? null
                              : () => _export.save(widget.fileId),
                        ),
                      ],
                    ),
                  ),
                  if (_export.busy)
                    const Padding(
                      padding: EdgeInsets.fromLTRB(18, 8, 18, 0),
                      child: LinearProgressIndicator(),
                    ),
                  const Spacer(),
                  if (_export.error != null || _export.notice != null)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: DjlGlassSurface(
                        radius: 16,
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            _export.error ?? _export.notice!,
                            style: TextStyle(
                              color: _export.error == null
                                  ? colors.onSurface
                                  : colors.error,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}
