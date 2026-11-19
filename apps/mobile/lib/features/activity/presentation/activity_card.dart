import 'package:flutter/material.dart';
import '../../settings/domain/appearance.dart';
import '../domain/desktop_activity.dart';
import '../domain/activity_preview.dart';
import 'command_timeline_row.dart';

class ActivityCard extends StatelessWidget {
  const ActivityCard({
    super.key,
    required this.activity,
    required this.changes,
    this.onOpenFile,
  });
  final DesktopActivity activity;
  final Listenable changes;
  final void Function(String path, bool image)? onOpenFile;
  String get _status => switch (activity.status) {
    'running' => 'Running',
    'failed' => 'Failed',
    'stopped' => 'Stopped',
    'completed' => 'Completed',
    _ => activity.status,
  };
  String? get _image => activity.kind == 'command'
      ? activityImageReference(
          command: activity.command,
          outputTail: activity.outputTail,
          cwd: activity.cwd,
        )
      : null;
  void _details(BuildContext context) => showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: BoxConstraints(
      maxHeight: MediaQuery.sizeOf(context).height * .85,
    ),
    builder: (context) => SafeArea(
      child: ListenableBuilder(
        listenable: changes,
        builder: (context, _) {
          final mono = TextStyle(
            fontFamily: DjlAppearance.of(context).font.codeFamily,
            fontSize: 13,
          );
          return ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                activity.kind == 'command'
                    ? 'Command details'
                    : activity.kind == 'fileChange'
                    ? 'File change details'
                    : 'Tool details',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Text('Status: $_status'),
              SelectableText(activity.title, style: mono),
              if (activity.cwd != null)
                Text('Working directory: ${activity.cwd}'),
              if (activity.exitCode != null)
                Text('Exit code: ${activity.exitCode}'),
              if (activity.durationMs != null)
                Text('Duration: ${activity.durationMs} ms'),
              for (final file in activity.files) ...[
                const Divider(height: 24),
                Text(file.path, style: Theme.of(context).textTheme.titleSmall),
                Text('Kind: ${file.kind}'),
                if (file.additions != null || file.deletions != null)
                  Text('+${file.additions ?? 0} −${file.deletions ?? 0}'),
                if (file.diff.isNotEmpty)
                  SelectableText(file.diff, style: mono),
                if (onOpenFile != null &&
                    file.path != 'unknown' &&
                    activityWorkspacePath(file.path, cwd: activity.cwd) != null)
                  TextButton.icon(
                    onPressed: () => onOpenFile!(file.path, false),
                    icon: const Icon(Icons.description_outlined),
                    label: Text('Open ${file.path}'),
                  ),
              ],
              const SizedBox(height: 16),
              Text(
                'Output · last $activityOutputLines lines',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              SelectableText(
                activity.outputTail.isEmpty
                    ? 'No textual output.'
                    : activity.outputTail,
                style: mono,
              ),
            ],
          );
        },
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (activity.kind == 'command')
        CommandTimelineRow(
          command: activity.command,
          status: activity.status,
          statusLabel: _status,
          onTap: () => _details(context),
        )
      else
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(
            activity.kind == 'fileChange'
                ? Icons.difference_outlined
                : Icons.build_outlined,
            size: 20,
          ),
          title: Text(
            activity.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(
            '$_status${activity.exitCode == null ? '' : ' · Exit ${activity.exitCode}'}',
          ),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _details(context),
        ),
      if (_image != null && onOpenFile != null)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () => onOpenFile!(_image!, true),
            icon: const Icon(Icons.image_outlined),
            label: Text('Image · ${_image!.split('/').last}'),
          ),
        ),
    ],
  );
}
