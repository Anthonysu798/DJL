import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../chat/data/cloud_repository.dart';
import '../../chat/presentation/message_view.dart';
import '../domain/gallery_image.dart';
import 'image_controller.dart';
import 'image_preview_page.dart';

import '../../../core/design/djl_icons.dart';
import '../../../core/presentation/djl_glass_menu.dart';

class ImageGalleryPage extends StatefulWidget {
  const ImageGalleryPage({
    super.key,
    required this.controller,
    required this.repository,
    required this.onOpen,
    required this.onCreate,
    this.onOpenNavigation,
  });
  final ImageController controller;
  final CloudRepository repository;
  final void Function(GalleryImage image, bool edit) onOpen;
  final VoidCallback onCreate;
  final VoidCallback? onOpenNavigation;
  @override
  State<ImageGalleryPage> createState() => _ImageGalleryPageState();
}

class _ImageGalleryPageState extends State<ImageGalleryPage> {
  @override
  void initState() {
    super.initState();
    unawaited(widget.controller.refresh());
  }

  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  void _preview(GalleryImage image) {
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => ImagePreviewPage(
          repository: widget.repository,
          fileId: image.fileId,
          mimeType: image.mimeType,
        ),
      ),
    );
  }

  Widget _tile(GalleryImage image, double width) {
    final ratio =
        image.width != null &&
            image.height != null &&
            image.width! > 0 &&
            image.height! > 0
        ? image.width! / image.height!
        : 1.0;
    return SizedBox(
      width: width,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            container: true,
            button: true,
            label: 'Open image',
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => _preview(image),
              child: SizedBox(
                height: math.min(220, width / ratio),
                child: ExcludeSemantics(
                  child: CloudImage(
                    repository: widget.repository,
                    fileId: image.fileId,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            image.prompt.isEmpty ? 'Generated image' : image.prompt,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, height: 1.2),
          ),
          Row(
            children: [
              Expanded(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    style: TextButton.styleFrom(
                      foregroundColor: cloudActionColor(context),
                      minimumSize: const Size(0, 44),
                      padding: EdgeInsets.zero,
                      textStyle: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    onPressed: () => widget.onOpen(image, false),
                    child: const Text('Open chat'),
                  ),
                ),
              ),
              if (widget.controller.configuration.imageEditing)
                DjlGlassMenuButton<String>(
                  tooltip: 'Image actions',
                  onSelected: (_) => widget.onOpen(image, true),
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'edit',
                      child: Text('Edit in chat'),
                    ),
                  ],
                  icon: const Icon(DjlIcons.more, size: 18),
                ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      return Scaffold(
        body: RefreshIndicator(
          onRefresh: c.refresh,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              CloudLargeNavigationBar(
                title: 'Images',
                leading: widget.onOpenNavigation == null
                    ? const SizedBox.shrink()
                    : CloudNavigationButton(
                        icon: DjlIcons.menu,
                        label: 'Open navigation',
                        onPressed: widget.onOpenNavigation!,
                      ),
                trailing: c.configuration.imageGeneration
                    ? IconButton(
                        tooltip: 'Create image',
                        onPressed: widget.onCreate,
                        icon: const Icon(DjlIcons.add),
                      )
                    : null,
              ),
              if (c.images.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Center(
                      child: c.loading
                          ? const CircularProgressIndicator.adaptive()
                          : Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  DjlIcons.images,
                                  size: 44,
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  'Your images',
                                  style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  c.error ??
                                      (c.configuration.imageGeneration
                                          ? 'Create an image and find it here, ready to save or share.'
                                          : 'Image creation is not configured yet. Saved images will appear here.'),
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 17,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                                  ),
                                ),
                                if (c.error != null)
                                  TextButton(
                                    onPressed: c.refresh,
                                    child: const Text('Retry'),
                                  ),
                              ],
                            ),
                    ),
                  ),
                )
              else ...[
                if (c.loading)
                  const SliverToBoxAdapter(child: LinearProgressIndicator()),
                if (c.error != null)
                  SliverToBoxAdapter(
                    child: ListTile(
                      title: Text(c.error!),
                      trailing: TextButton(
                        onPressed: c.refresh,
                        child: const Text('Retry'),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.all(16),
                  sliver: SliverLayoutBuilder(
                    builder: (context, constraints) {
                      final minimum =
                          150 *
                          math.max(
                            1,
                            MediaQuery.textScalerOf(context).scale(13) / 13,
                          );
                      final columns = math.max(
                        1,
                        ((constraints.crossAxisExtent + 12) / (minimum + 12))
                            .floor(),
                      );
                      final width =
                          (constraints.crossAxisExtent - 12 * (columns - 1)) /
                          columns;
                      return SliverList.builder(
                        itemCount: (c.images.length / columns).ceil(),
                        itemBuilder: (_, row) => Padding(
                          padding: const EdgeInsets.only(bottom: 18),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (
                                var column = 0;
                                column < columns &&
                                    row * columns + column < c.images.length;
                                column++
                              ) ...[
                                if (column > 0) const SizedBox(width: 12),
                                _tile(c.images[row * columns + column], width),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
                if (c.cursor != null)
                  SliverToBoxAdapter(
                    child: Center(
                      child: TextButton(
                        onPressed: c.loading
                            ? null
                            : () => c.refresh(more: true),
                        child: const Text('Load more'),
                      ),
                    ),
                  ),
                SliverToBoxAdapter(
                  child: SizedBox(height: MediaQuery.paddingOf(context).bottom),
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
}
