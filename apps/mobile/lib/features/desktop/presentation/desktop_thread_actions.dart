import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_controller.dart';
import '../../../l10n/l10n.dart';

List<PopupMenuEntry<String>> desktopThreadActions(
  BuildContext context,
  DesktopController desktop,
  RemoteJson value,
) {
  final l10n = context.l10n;
  final id = value['id'] as String,
      archived = desktop.threadList.data.isArchived(value['id'] as String);
  return [
    PopupMenuItem(value: 'copy-session', child: Text(l10n.chatUiCopySessionId)),
    if (!archived)
      PopupMenuItem(value: 'rename-chat', child: Text(l10n.chatUiRenameChat)),
    if (!archived && value['parentThreadId'] == null)
      PopupMenuItem(
        value: 'pin-chat',
        child: Text(
          desktop.threadList.data.isPinned(id)
              ? l10n.chatUiUnpinChat
              : l10n.chatUiPinChat,
        ),
      ),
    PopupMenuItem(
      value: 'archive-chat',
      child: Text(archived ? l10n.chatUiUnarchiveChat : l10n.chatUiArchiveChat),
    ),
    PopupMenuItem(
      value: 'remove-chat',
      child: Text(l10n.chatUiRemoveFromDevice),
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.chatUiSessionIdCopied)),
        );
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
          title: Text(context.l10n.chatUiRemoveChatTitle),
          content: Text(
            archived
                ? context.l10n.chatUiRemoveChatBodyArchived
                : context.l10n.chatUiRemoveChatBody,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.l10n.chatUiRemoveChat),
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
    title: Text(context.l10n.chatUiRenameChat),
    content: TextField(
      key: const Key('desktop_chat_name'),
      controller: _name,
      autofocus: true,
      decoration: InputDecoration(labelText: context.l10n.chatUiChatName),
      onChanged: (_) => setState(() {}),
      onSubmitted: (_) => _save(),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(context.l10n.commonCancel),
      ),
      FilledButton(
        onPressed: _name.text.trim().isEmpty ? null : _save,
        child: Text(context.l10n.chatUiSaveName),
      ),
    ],
  );
}
