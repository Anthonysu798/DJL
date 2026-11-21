import 'package:flutter/material.dart';

import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../../../core/network/cloud_client.dart';
import '../data/content_reporter.dart';

typedef SendReport = Future<void> Function(ReportReason reason, String? note);

/// Asks why an AI answer is being reported, sends it, and thanks the person.
Future<void> showReportSheet(BuildContext context, SendReport send) async {
  final sent = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => ReportSheet(send: send),
  );
  if (sent == true && context.mounted) {
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      const SnackBar(content: Text("Thanks. We'll review this answer.")),
    );
  }
}

/// The report button shown under an AI answer. Hidden when reporting is not
/// available on this screen.
class ReportAnswerButton extends StatelessWidget {
  const ReportAnswerButton({super.key, required this.send, this.size = 14});
  final SendReport send;
  final double size;

  @override
  Widget build(BuildContext context) => IconButton(
    key: const Key('report.answer'),
    tooltip: 'Report this answer',
    visualDensity: VisualDensity.compact,
    icon: Icon(
      DjlIcons.flag,
      size: size,
      color: DjlColors.of(context).inkMuted,
    ),
    onPressed: () => showReportSheet(context, send),
  );
}

class ReportSheet extends StatefulWidget {
  const ReportSheet({super.key, required this.send});
  final SendReport send;
  @override
  State<ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<ReportSheet> {
  final _note = TextEditingController();
  ReportReason? _reason;
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final reason = _reason;
    if (reason == null || _sending) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.send(reason, _note.text);
      if (mounted) Navigator.pop(context, true);
    } on CloudFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = switch (failure.code) {
          'rate_limited' => 'Too many reports right now. Try again later.',
          'network' || 'timeout' => failure.message,
          _ => "Couldn't send the report. Try again.",
        };
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = "Couldn't send the report. Try again.";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = DjlColors.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(
                'Report this answer',
                style: theme.textTheme.titleLarge!.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'DJL reviews reports to keep answers safe. What is wrong with it?',
              style: theme.textTheme.bodyMedium!.copyWith(
                color: colors.inkMuted,
              ),
            ),
            const SizedBox(height: 12),
            for (final reason in ReportReason.values)
              ListTile(
                key: Key('report.reason.${reason.name}'),
                contentPadding: EdgeInsets.zero,
                title: Text(reason.label),
                trailing: _reason == reason
                    ? Icon(DjlIcons.check, color: colors.ink)
                    : null,
                selected: _reason == reason,
                onTap: _sending ? null : () => setState(() => _reason = reason),
              ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('report.note'),
              controller: _note,
              enabled: !_sending,
              maxLength: 1000,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(
                hintText: 'Add details (optional)',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: colors.danger)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('report.send'),
              onPressed: _reason == null || _sending ? null : _submit,
              child: Text(_sending ? 'Sending…' : 'Send report'),
            ),
          ],
        ),
      ),
    );
  }
}
