import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../../../core/presentation/djl_frosted.dart';
import '../../groups/domain/group_models.dart';
import '../data/file_opener.dart';

/// Shows one attachment full screen. Images and text files are drawn here;
/// PDFs, Office files and everything else open in the system viewer.
class AttachmentPreviewPage extends StatefulWidget {
  const AttachmentPreviewPage({
    super.key,
    required this.name,
    required this.mimeType,
    required this.load,
    this.opener = const FileOpener(),
  });
  final String name, mimeType;
  final Future<Uint8List> Function() load;
  final FileOpener opener;

  static Future<void> show(
    BuildContext context, {
    required String name,
    required String mimeType,
    required Future<Uint8List> Function() load,
  }) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          AttachmentPreviewPage(name: name, mimeType: mimeType, load: load),
    ),
  );

  @override
  State<AttachmentPreviewPage> createState() => _AttachmentPreviewPageState();
}

class _AttachmentPreviewPageState extends State<AttachmentPreviewPage> {
  late Future<Uint8List> _bytes = widget.load();
  final _shareButton = GlobalKey();

  bool get _image => widget.mimeType.toLowerCase().startsWith('image/');
  bool get _text => attachmentIsText(widget.name, widget.mimeType);

  Rect? _origin() {
    final box = _shareButton.currentContext?.findRenderObject();
    return box is RenderBox ? box.localToGlobal(Offset.zero) & box.size : null;
  }

  Future<void> _openExternally(Uint8List bytes) async {
    final shown = await widget.opener.open(
      bytes,
      widget.name,
      widget.mimeType,
      origin: _origin(),
    );
    if (!shown && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No app here opens this file. Pick one to send it to.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final top = MediaQuery.paddingOf(context).top;
    return Scaffold(
      backgroundColor: _image ? Colors.black : colors.surface,
      body: FutureBuilder<Uint8List>(
        future: _bytes,
        builder: (context, snapshot) {
          final bytes = snapshot.data;
          final Widget body;
          if (snapshot.hasError) {
            body = _Message(
              icon: DjlIcons.error,
              title: "Couldn't open this file",
              detail: 'Check that your Mac is connected, then try again.',
              action: DjlGlassPillButton(
                label: 'Try again',
                onPressed: () => setState(() => _bytes = widget.load()),
              ),
            );
          } else if (bytes == null) {
            body = const Center(child: CircularProgressIndicator.adaptive());
          } else if (_image) {
            body = InteractiveViewer(
              maxScale: 6,
              child: Center(
                child: Image.memory(
                  bytes,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => _Message(
                    icon: DjlIcons.image,
                    title: "This image can't be shown here",
                    detail: widget.name,
                    action: DjlGlassPillButton(
                      label: 'Open in another app',
                      onPressed: () => _openExternally(bytes),
                    ),
                  ),
                ),
              ),
            );
          } else if (_text && bytes.length <= 2 * 1024 * 1024) {
            body = _TextFile(
              text: utf8.decode(bytes, allowMalformed: true),
              topInset: top + 64,
            );
          } else {
            body = _Message(
              icon: attachmentIcon(widget.name, widget.mimeType),
              title: widget.name,
              detail:
                  '${attachmentKindLabel(widget.name, widget.mimeType)} · '
                  '${formatByteSize(bytes.length)}',
              action: DjlGlassPillButton(
                label: 'Open',
                prominent: true,
                onPressed: () => _openExternally(bytes),
              ),
            );
          }
          return Stack(
            children: [
              Positioned.fill(child: body),
              Positioned(
                top: top + 8,
                left: 16,
                right: 16,
                child: Row(
                  children: [
                    const DjlGlassBackButton(),
                    const SizedBox(width: DjlSpace.md),
                    Expanded(
                      child: Text(
                        widget.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(color: _image ? Colors.white : null),
                      ),
                    ),
                    const SizedBox(width: DjlSpace.md),
                    DjlGlassIconButton(
                      key: _shareButton,
                      icon: DjlIcons.share,
                      label: 'Share',
                      onPressed: bytes == null
                          ? null
                          : () => unawaited(
                              widget.opener.share(
                                bytes,
                                widget.name,
                                widget.mimeType,
                                origin: _origin(),
                              ),
                            ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The icon for a file, by what it is.
IconData attachmentIcon(String name, String mimeType) {
  if (mimeType.toLowerCase().startsWith('image/')) return DjlIcons.image;
  return switch (attachmentKindLabel(name, mimeType)) {
    'PDF' => DjlIcons.filePdf,
    'Word' => DjlIcons.fileDoc,
    'PowerPoint' || 'Keynote' => DjlIcons.fileSlides,
    'Excel' || 'Spreadsheet' => DjlIcons.fileSheet,
    'Archive' => DjlIcons.fileArchive,
    _ => attachmentIsText(name, mimeType) ? DjlIcons.fileCode : DjlIcons.file,
  };
}

class _TextFile extends StatelessWidget {
  const _TextFile({required this.text, required this.topInset});
  final String text;
  final double topInset;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: EdgeInsets.fromLTRB(
      DjlSpace.page,
      topInset,
      DjlSpace.page,
      MediaQuery.paddingOf(context).bottom + DjlSpace.xl,
    ),
    child: SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SelectableText(
        text,
        style: TextStyle(
          fontFamily: 'JetBrainsMono',
          fontSize: 13,
          height: 1.5,
          color: DjlColors.of(context).ink,
        ),
      ),
    ),
  );
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.detail,
    this.action,
  });
  final IconData icon;
  final String title, detail;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DjlSpace.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DjlFrosted(
              radius: DjlRadius.lg,
              shadow: false,
              blur: false,
              child: SizedBox.square(
                dimension: 88,
                child: Icon(icon, size: 40, color: colors.ink),
              ),
            ),
            const SizedBox(height: DjlSpace.xl),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: DjlSpace.xs),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (action != null) ...[
              const SizedBox(height: DjlSpace.xl),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
