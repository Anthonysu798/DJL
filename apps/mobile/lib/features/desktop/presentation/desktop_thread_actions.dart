import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_controller.dart';

List<PopupMenuEntry<String>> desktopThreadActions(
  DesktopController desktop,
  RemoteJson value,
) {
  final id = value['id'] as String,
      archived = desktop.threadList.data.isArchived(value['id'] as String);
  return [
    const PopupMenuItem(value: 'copy-session', child: Text('Copy session ID')),
    if (!archived)
      const PopupMenuItem(value: 'rename-chat', child: Text('Rename chat')),
    if (!archived && value['parentThreadId'] == null)
      PopupMenuItem(
        value: 'pin-chat',
        child: Text(
          desktop.threadList.data.isPinned(id) ? 'Unpin chat' : 'Pin chat',
        ),
      ),
    PopupMenuItem(
      value: 'archive-chat',
      child: Text(archived ? 'Unarchive chat' : 'Archive chat'),
    ),
    const PopupMenuItem(
      value: 'remove-chat',
      child: Text('Remove from this device'),
    ),
  ];
}

const localThreadActions = {
  'copy-session',
  'rename-chat',
  'pin-chat',
  'archive-chat',
  'remove-chat',
};
Future<void> performDesktopThreadAction(
  BuildContext context,
  DesktopController desktop,
  RemoteJson value,
  String action, {
  VoidCallback? closeChat,
  bool Function()? isCurrent,
}) async {
  if (isCurrent?.call() == false) return;
  final mac = desktop.active?.macDeviceId, id = value['id'] as String;
  try {
    if (action == 'copy-session') {
      await Clipboard.setData(ClipboardData(text: id));
      if (context.mounted && isCurrent?.call() != false) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Session ID copied.')));
      }
      return;
    }
    if (action == 'rename-chat') {
      final name = await showDialog<String>(
        context: context,
        builder: (_) => _RenameDialog(title: desktop.titleOf(value)),
      );
      if (name != null &&
          desktop.active?.macDeviceId == mac &&
          isCurrent?.call() != false) {
        await desktop.threadList.rename(id, name);
      }
      return;
    }
    if (action == 'pin-chat') {
      await desktop.threadList.pin(id, !desktop.threadList.data.isPinned(id));
      return;
    }
    if (action == 'archive-chat') {
      final archived = desktop.threadList.data.isArchived(id);
      await desktop.threadList.archive(id, !archived);
      if (!archived &&
          desktop.active?.macDeviceId == mac &&
          isCurrent?.call() != false) {
        desktop.closeThread(id);
        closeChat?.call();
      }
      return;
    }
    if (action == 'remove-chat') {
      final archived = desktop.threadList.data.isArchived(id);
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Remove this chat from this device?'),
          content: Text(
            'The chat stays on your desktop.${archived ? '' : ' It will also be archived there.'} Subagent chats are archived locally.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Remove chat'),
            ),
          ],
        ),
      );
      if (yes == true &&
          desktop.active?.macDeviceId == mac &&
          isCurrent?.call() != false) {
        await desktop.threadList.remove(id, archiveOnDesktop: !archived);
        desktop.closeThread(id);
        closeChat?.call();
      }
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }
}

class _RenameDialog extends StatefulWidget {
  const _RenameDialog({required this.title});
  final String title;
  @override
  State<_RenameDialog> createState() => _RenameDialogState();
}

class _RenameDialogState extends State<_RenameDialog> {
  late final TextEditingController _name = TextEditingController(
    text: widget.title,
  );
  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _save() {
    if (_name.text.trim().isNotEmpty) {
      Navigator.pop(context, _name.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Rename chat'),
    content: TextField(
      key: const Key('desktop_chat_name'),
      controller: _name,
      autofocus: true,
      decoration: const InputDecoration(labelText: 'Chat name'),
      onChanged: (_) => setState(() {}),
      onSubmitted: (_) => _save(),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _name.text.trim().isEmpty ? null : _save,
        child: const Text('Save name'),
      ),
    ],
  );
}
