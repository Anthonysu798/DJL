import 'desktop_composer.dart';

class DesktopQueuedDraft {
  const DesktopQueuedDraft({
    required this.id,
    required this.draft,
    required this.plan,
  });
  final String id;
  final DesktopComposerDraft draft;
  final bool plan;
}
