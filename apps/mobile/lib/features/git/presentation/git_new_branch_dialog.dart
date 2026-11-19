import 'package:flutter/material.dart';
import '../domain/git_creation_review.dart';

class GitNewBranchDialog extends StatefulWidget {
  const GitNewBranchDialog({
    super.key,
    required this.isCurrent,
    this.scopeChanges,
    this.initialName = 'djl/',
  });
  final bool Function() isCurrent;
  final Listenable? scopeChanges;
  final String initialName;
  @override
  State<GitNewBranchDialog> createState() => _GitNewBranchDialogState();
}

class _GitNewBranchDialogState extends State<GitNewBranchDialog> {
  late final TextEditingController _name;
  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.initialName);
    _name.selection = TextSelection.collapsed(offset: _name.text.length);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _finish(String? name) {
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.pop(context, name);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.scopeChanges]),
    builder: (context, _) {
      final name = normalizedGitCreatedBranchName(_name.text);
      final current = widget.isCurrent();
      final valid = current && name.isNotEmpty && name != 'djl/';
      return AlertDialog(
        title: const Text('New branch'),
        scrollable: true,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _name,
              autofocus: true,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.none,
              decoration: const InputDecoration(hintText: 'djl/my-feature'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            const Text(
              'Branch will be created locally and checked out. Uncommitted changes stay with this working copy.',
            ),
            if (!current)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text(
                  'Thread activity changed. Close and reopen this Git action.',
                ),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => _finish(null),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: !valid
                ? null
                : () {
                    if (!mounted) return;
                    final value = normalizedGitCreatedBranchName(_name.text);
                    if (!widget.isCurrent()) {
                      setState(() {});
                      return;
                    }
                    if (value.isNotEmpty && value != 'djl/') {
                      _finish(value);
                    }
                  },
            child: const Text('Create'),
          ),
        ],
      );
    },
  );
}
