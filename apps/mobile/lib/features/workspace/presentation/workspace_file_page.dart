import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../data/workspace_repository.dart';
import 'workspace_file_controller.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

class WorkspaceFilePage extends StatefulWidget {
  const WorkspaceFilePage({
    super.key,
    required this.repository,
    this.initialPath,
    this.image = false,
  });
  final WorkspaceRepository repository;
  final String? initialPath;
  final bool image;
  @override
  State<WorkspaceFilePage> createState() => _WorkspaceFilePageState();
}

class _WorkspaceFilePageState extends State<WorkspaceFilePage> {
  late final WorkspaceFileController _controller;
  late final TextEditingController _path;
  late bool _image;
  @override
  void initState() {
    super.initState();
    _controller = WorkspaceFileController(widget.repository);
    _path = TextEditingController(text: widget.initialPath);
    _image = widget.image;
    if (widget.initialPath?.isNotEmpty == true) {
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    if (_path.text.trim().isEmpty) {
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    await _controller.load(_path.text.trim(), asImage: _image);
  }

  @override
  void dispose() {
    _path.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _controller,
    builder: (context, _) {
      final c = _controller;
      return Scaffold(
        appBar: AppBar(
          title: Text(
            c.text?.name ??
                c.image?.name ??
                context.l10n.workspaceFileFallbackTitle,
          ),
          actions: [
            IconButton(
              tooltip: context.l10n.workspaceCopyFileContents,
              onPressed: c.text == null
                  ? null
                  : () {
                      Clipboard.setData(ClipboardData(text: c.text!.content));
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            context.l10n.workspaceFileContentsCopied,
                          ),
                        ),
                      );
                    },
              icon: const Icon(DjlIcons.copy),
            ),
            IconButton(
              tooltip: context.l10n.workspaceReloadFile,
              onPressed: c.loading ? null : _load,
              icon: const Icon(DjlIcons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    TextField(
                      key: const Key('workspace_file_path'),
                      controller: _path,
                      autocorrect: false,
                      decoration: InputDecoration(
                        labelText: context.l10n.workspaceFilePathOnMac,
                        helperText: widget.repository.cwd,
                      ),
                      onSubmitted: (_) => _load(),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: SegmentedButton<bool>(
                            segments: [
                              ButtonSegment(
                                value: false,
                                label: Text(context.l10n.workspaceSegmentText),
                              ),
                              ButtonSegment(
                                value: true,
                                label: Text(context.l10n.workspaceSegmentImage),
                              ),
                            ],
                            selected: {_image},
                            onSelectionChanged: (value) =>
                                setState(() => _image = value.single),
                          ),
                        ),
                        const SizedBox(width: 12),
                        FilledButton(
                          onPressed: c.loading ? null : _load,
                          child: Text(context.l10n.workspaceOpen),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (c.loading) const LinearProgressIndicator(),
              if (c.error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    c.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              Expanded(
                child: c.image != null
                    ? InteractiveViewer(
                        minScale: .5,
                        maxScale: 6,
                        child: Center(
                          child: c.image!.mimeType == 'image/svg+xml'
                              ? SvgPicture.memory(
                                  c.image!.bytes,
                                  semanticsLabel: c.image!.name,
                                  errorBuilder: (_, error, stack) => Text(
                                    context.l10n.workspaceSvgRenderFailed,
                                  ),
                                )
                              : Image.memory(
                                  c.image!.bytes,
                                  errorBuilder: (_, error, stack) => Text(
                                    context.l10n.workspaceImageRenderFailed,
                                  ),
                                ),
                        ),
                      )
                    : c.text != null
                    ? SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: SizedBox(
                          width: double.infinity,
                          child: SelectableText(
                            c.text!.content,
                            style: const TextStyle(
                              fontFamily: 'GeistMono',
                              fontSize: 13,
                            ),
                          ),
                        ),
                      )
                    : Center(
                        child: Text(context.l10n.workspaceOpenFileToPreview),
                      ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
