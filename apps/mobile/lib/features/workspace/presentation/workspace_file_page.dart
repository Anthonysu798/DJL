import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../data/workspace_repository.dart';
import 'workspace_file_controller.dart';

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
          title: Text(c.text?.name ?? c.image?.name ?? 'Workspace file'),
          actions: [
            IconButton(
              tooltip: 'Copy file contents',
              onPressed: c.text == null
                  ? null
                  : () {
                      Clipboard.setData(ClipboardData(text: c.text!.content));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('File contents copied.')),
                      );
                    },
              icon: const Icon(Icons.copy),
            ),
            IconButton(
              tooltip: 'Reload file',
              onPressed: c.loading ? null : _load,
              icon: const Icon(Icons.refresh),
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
                        labelText: 'File path on your Mac',
                        helperText: widget.repository.cwd,
                      ),
                      onSubmitted: (_) => _load(),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: SegmentedButton<bool>(
                            segments: const [
                              ButtonSegment(value: false, label: Text('Text')),
                              ButtonSegment(value: true, label: Text('Image')),
                            ],
                            selected: {_image},
                            onSelectionChanged: (value) =>
                                setState(() => _image = value.single),
                          ),
                        ),
                        const SizedBox(width: 12),
                        FilledButton(
                          onPressed: c.loading ? null : _load,
                          child: const Text('Open'),
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
                                  errorBuilder: (_, error, stack) => const Text(
                                    'This SVG could not be rendered.',
                                  ),
                                )
                              : Image.memory(
                                  c.image!.bytes,
                                  errorBuilder: (_, error, stack) => const Text(
                                    'This image format could not be rendered on this device.',
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
                    : const Center(
                        child: Text('Open a workspace file to preview it.'),
                      ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
