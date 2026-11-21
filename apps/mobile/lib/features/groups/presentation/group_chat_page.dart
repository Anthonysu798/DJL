import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';
import '../../../core/presentation/djl_glass.dart';
import '../../../core/presentation/djl_glass_menu.dart';
import '../../attachments/data/attachment_picker.dart';
import '../../settings/domain/appearance.dart';
import '../domain/group_models.dart';
import '../../reports/data/content_reporter.dart';
import '../../reports/presentation/report_sheet.dart';
import 'agent_avatar.dart';
import 'group_attachments.dart';
import 'groups_controller.dart';
import '../../../l10n/l10n.dart';

/// One group chat: everyone's messages, each agent's reply as it is written,
/// and a composer that picks who answers.
class GroupChatPage extends StatefulWidget {
  const GroupChatPage({
    super.key,
    required this.controller,
    required this.groupId,
  });
  final GroupsController controller;
  final String groupId;

  @override
  State<GroupChatPage> createState() => _GroupChatPageState();
}

class _GroupChatPageState extends State<GroupChatPage> {
  final _input = TextEditingController();
  final _focus = FocusNode();
  final _picker = AttachmentPicker();
  final _drafts = <DraftAttachment>[];
  int _draftSerial = 0;
  Group? _opened;

  GroupsController get _groups => widget.controller;

  @override
  void initState() {
    super.initState();
    _input.addListener(() => setState(() {}));
    _open();
  }

  void _open() {
    final group = _groups.group(widget.groupId);
    if (group == null || _opened?.threadId == group.threadId) return;
    _opened = group;
    unawaited(_groups.open(group));
  }

  @override
  void dispose() {
    final group = _opened;
    if (group != null) _groups.close(group);
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _attach(BuildContext anchor) async {
    final box = anchor.findRenderObject()! as RenderBox;
    final kind = await showDjlGlassMenu<String>(
      context,
      anchor: box.localToGlobal(Offset.zero) & box.size,
      label: context.l10n.groupsAttach,
      sections: [
        [
          DjlMenuItem('photos', context.l10n.groupsPhotos, DjlIcons.images),
          DjlMenuItem('camera', context.l10n.cloudChatCamera, DjlIcons.camera),
          DjlMenuItem('files', context.l10n.groupsFiles, DjlIcons.document),
        ],
      ],
    );
    if (kind == null || !mounted) return;
    try {
      final picked = switch (kind) {
        'photos' => await _picker.images(),
        'camera' => [?await _picker.image(camera: true)],
        _ => await _picker.files(),
      };
      if (!mounted || picked.isEmpty) return;
      final tooBig = picked.where(
        (file) => file.bytes.length > groupAttachmentMaxBytes,
      );
      final unsupported = picked.where(
        (file) => !groupAttachmentSupported(file.name, file.mime),
      );
      final room = groupAttachmentMaxCount - _drafts.length;
      setState(() {
        for (final file
            in picked
                .where(
                  (file) =>
                      file.bytes.length <= groupAttachmentMaxBytes &&
                      groupAttachmentSupported(file.name, file.mime),
                )
                .take(room)) {
          _drafts.add(
            DraftAttachment(
              'draft-${++_draftSerial}',
              file.name,
              file.mime,
              file.bytes,
            ),
          );
        }
      });
      final note = unsupported.isNotEmpty
          ? context.l10n.groupsFileUnsupported(unsupported.first.name)
          : tooBig.isNotEmpty
          ? context.l10n.groupsFileTooLarge(
              tooBig.first.name,
              formatByteSize(groupAttachmentMaxBytes),
            )
          : picked.length > room
          ? context.l10n.groupsTooManyFiles(groupAttachmentMaxCount)
          : null;
      if (note != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(note)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.l10n.groupsOpenFailed)));
      }
    }
  }

  Future<void> _send(Group group) async {
    final text = _input.text.trim();
    final files = List.of(_drafts);
    if (text.isEmpty && files.isEmpty) return;
    final mentions = parseGroupMentions(text, [
      for (final member in group.members) member.handle,
    ]);
    if (mentions.all &&
        !group.skipAllWarning &&
        group.members.length >= groupAllWarningMinMembers) {
      final choice = await _confirmEveryone(group);
      if (choice == null || !mounted) return;
      if (choice == _Everyone.always) unawaited(_groups.skipAllWarning(group));
    }
    _input.clear();
    setState(_drafts.clear);
    final sent = await _groups.send(
      group,
      text,
      files: [
        for (final file in files)
          (name: file.name, mimeType: file.mimeType, bytes: file.bytes),
      ],
    );
    if (!sent && mounted && _input.text.isEmpty && _drafts.isEmpty) {
      // Nothing was sent; give the words and files back.
      _input.text = text;
      setState(() => _drafts.addAll(files));
    }
  }

  Future<_Everyone?> _confirmEveryone(Group group) => showDialog<_Everyone>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(context.l10n.groupsAskEveryoneTitle),
      content: Text(context.l10n.groupsAskEveryoneBody(group.members.length)),
      actionsAlignment: MainAxisAlignment.spaceBetween,
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, _Everyone.always),
          child: Text(context.l10n.groupsDontAskAgain),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              onPressed: () => Navigator.pop(context, _Everyone.once),
              child: Text(context.l10n.groupsAskEveryone),
            ),
          ],
        ),
      ],
    ),
  );

  void _mention(String handle) {
    final cursor = _input.selection.baseOffset;
    final active = activeMentionQuery(
      _input.text,
      cursor < 0 ? _input.text.length : cursor,
    );
    final inserted = '@$handle ';
    if (active == null) {
      final at = cursor < 0 ? _input.text.length : cursor;
      final gap = at > 0 && _input.text[at - 1].trim().isNotEmpty ? ' ' : '';
      _input.value = TextEditingValue(
        text: _input.text.replaceRange(at, at, '$gap$inserted'),
        selection: TextSelection.collapsed(
          offset: at + gap.length + inserted.length,
        ),
      );
    } else {
      final end = active.start + 1 + active.query.length;
      _input.value = TextEditingValue(
        text: _input.text.replaceRange(active.start, end, inserted),
        selection: TextSelection.collapsed(
          offset: active.start + inserted.length,
        ),
      );
    }
    _focus.requestFocus();
  }

  void _showMembers(Group group) => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (_) => _MembersSheet(controller: _groups, groupId: group.id),
  );

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _groups,
    builder: (context, _) {
      _open();
      final group = _groups.group(widget.groupId) ?? _opened;
      final colors = DjlColors.of(context);
      if (group == null) {
        return Scaffold(
          appBar: AppBar(),
          body: Center(child: Text(context.l10n.groupsGroupGone)),
        );
      }
      final running = _groups.running(group);
      final messages = _groups.messages(group);
      final writing = [
        for (final member in group.members)
          if (_groups.state(member.id).busy) member,
      ];
      final cursor = _input.selection.baseOffset;
      final query = _focus.hasFocus
          ? activeMentionQuery(
              _input.text,
              cursor < 0 ? _input.text.length : cursor,
            )
          : null;
      final top = MediaQuery.paddingOf(context).top + 72;
      return Scaffold(
        backgroundColor: colors.surface,
        body: Stack(
          children: [
            Positioned.fill(
              child: Column(
                children: [
                  Expanded(
                    child: !_groups.messagesLoaded(group)
                        ? _groups.available
                              ? const _Loading()
                              : const _Offline()
                        : messages.isEmpty && writing.isEmpty
                        ? _EmptyChat(
                            group: group,
                            topInset: top,
                            onSuggestion: () {
                              _input.text = context.l10n.groupsSayHelloPrompt(
                                '@$groupAllHandle',
                              );
                              _focus.requestFocus();
                            },
                          )
                        : ListView.builder(
                            reverse: true,
                            keyboardDismissBehavior:
                                ScrollViewKeyboardDismissBehavior.onDrag,
                            padding: EdgeInsets.fromLTRB(
                              DjlSpace.lg,
                              top,
                              DjlSpace.lg,
                              DjlSpace.md,
                            ),
                            itemCount: writing.length + messages.length,
                            itemBuilder: (context, index) {
                              // Index 0 is the bottom: agents still writing,
                              // then messages from newest to oldest.
                              if (index < writing.length) {
                                final member =
                                    writing[writing.length - 1 - index];
                                return _WritingRow(
                                  key: ValueKey('writing-${member.id}'),
                                  member: member,
                                  draft: _groups.draft(member.id),
                                  waiting:
                                      _groups.state(member.id) ==
                                      GroupMemberState.waiting,
                                );
                              }
                              final message =
                                  messages[messages.length -
                                      1 -
                                      (index - writing.length)];
                              return _MessageRow(
                                key: ValueKey(message.id),
                                controller: _groups,
                                message: message,
                                member: message.memberId == null
                                    ? null
                                    : group.member(message.memberId!),
                                reply: _groups.reply(message.replyId),
                              );
                            },
                          ),
                  ),
                  SafeArea(
                    top: false,
                    minimum: const EdgeInsets.only(bottom: DjlSpace.sm),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: DjlSpace.md,
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_groups.error != null)
                            _Notice(text: _groups.error!)
                          else if (!_groups.available)
                            _Notice(
                              text: context.l10n.groupsReconnectingToMac,
                              quiet: true,
                            ),
                          if (group.pendingHandoffs > 0 && !running)
                            _PauseCard(
                              onContinue: () =>
                                  _groups.resolvePause(group, carryOn: true),
                              onStop: () =>
                                  _groups.resolvePause(group, carryOn: false),
                            ),
                          if (query != null)
                            _MentionStrip(
                              group: group,
                              query: query.query,
                              onPick: _mention,
                            ),
                          _Composer(
                            input: _input,
                            focus: _focus,
                            enabled: _groups.available,
                            running: running,
                            drafts: _drafts,
                            onAttach: _groups.canAttach ? _attach : null,
                            onRemoveDraft: (draft) =>
                                setState(() => _drafts.remove(draft)),
                            onMention: () => _mention(''),
                            onSend: () => _send(group),
                            onStop: () => _groups.stop(group),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // Messages fade out under the status bar instead of colliding
            // with the clock.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: top,
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      // Solid behind the status bar, then clear by the
                      // bottom of the header.
                      colors: [
                        colors.surface,
                        colors.surface,
                        colors.surface.withValues(alpha: 0),
                      ],
                      stops: [0, (top - 72) / top, 1],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _Header(
                group: group,
                onMembers: () => _showMembers(group),
              ),
            ),
          ],
        ),
      );
    },
  );
}

enum _Everyone { once, always }

class _Header extends StatelessWidget {
  const _Header({required this.group, required this.onMembers});
  final Group group;
  final VoidCallback onMembers;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final theme = Theme.of(context);
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          DjlSpace.md,
          DjlSpace.xs,
          DjlSpace.md,
          0,
        ),
        child: SizedBox(
          height: 52,
          child: DjlGlassSurface(
            radius: 26,
            child: Row(
              children: [
                IconButton(
                  tooltip: context.l10n.coreBack,
                  onPressed: () => Navigator.maybePop(context),
                  icon: const Icon(DjlIcons.back, size: 22),
                ),
                Expanded(
                  child: Semantics(
                    button: true,
                    label: context.l10n.groupsHeaderLabel(
                      group.name,
                      group.members.length,
                    ),
                    child: InkWell(
                      onTap: onMembers,
                      customBorder: const StadiumBorder(),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Flexible(
                            child: Text(
                              group.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleMedium,
                            ),
                          ),
                          const SizedBox(width: DjlSpace.sm),
                          Text(
                            '${group.members.length}',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: colors.inkMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: DjlSpace.sm),
                  child: Semantics(
                    button: true,
                    label: context.l10n.groupsMembers,
                    child: InkWell(
                      onTap: onMembers,
                      customBorder: const StadiumBorder(),
                      child: Padding(
                        padding: const EdgeInsets.all(DjlSpace.xs),
                        child: AgentAvatarStack(members: group.members),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MessageRow extends StatelessWidget {
  const _MessageRow({
    super.key,
    required this.controller,
    required this.message,
    required this.member,
    required this.reply,
  });
  final GroupsController controller;
  final GroupMessage message;
  final GroupMember? member;
  final GroupReply? reply;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    if (message.fromUser) {
      return Padding(
        padding: const EdgeInsets.only(left: 56, bottom: DjlSpace.lg),
        child: Align(
          alignment: Alignment.centerRight,
          child: Semantics(
            label: context.l10n.groupsYou,
            child: AnimatedOpacity(
              duration: DjlMotion.of(context, DjlMotion.fast),
              opacity: message.sending ? .55 : 1,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (message.attachments.isNotEmpty)
                    MessageAttachments(
                      attachments: message.attachments,
                      controller: controller,
                      progress: controller.progress(message.id),
                    ),
                  if (message.text.isNotEmpty)
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.ink,
                        borderRadius: BorderRadius.circular(22),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        child: Text(
                          message.text,
                          style: Theme.of(context).textTheme.bodyLarge
                              ?.copyWith(color: colors.onInk, height: 1.3),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
    }
    final Widget body;
    if (reply?.failed ?? false) {
      body = Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(DjlIcons.error, size: 18, color: colors.danger),
          const SizedBox(width: DjlSpace.sm),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.l10n.groupsCouldNotReply,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  message.text,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
      );
    } else if (reply?.empty ?? false) {
      body = Text(
        context.l10n.groupsNothingToAdd,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: colors.inkMuted),
      );
    } else {
      final reporter = ContentReportScope.maybeOf(context);
      body = reporter == null || message.text.trim().isEmpty
          ? _ReplyText(message.text)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ReplyText(message.text),
                ReportAnswerButton(
                  send: (reason, note) => reporter.reportDesktop(
                    text: message.text,
                    agent: member?.handle,
                    reason: reason,
                    note: note,
                  ),
                ),
              ],
            );
    }
    return _AgentRow(member: member, child: body);
  }
}

/// An agent's words. Live drafts and finished replies share this, so a reply
/// does not reflow when it settles.
class _ReplyText extends StatelessWidget {
  const _ReplyText(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => MarkdownBody(
    data: text,
    styleSheet: DjlAppearance.of(context)
        .markdown(context)
        .copyWith(
          p: Theme.of(context).textTheme.bodyLarge?.copyWith(height: 1.35),
          horizontalRuleDecoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: DjlColors.of(context).hairline),
            ),
          ),
        ),
    // Files an agent made stay on the Mac; a broken remote image would only
    // add noise.
    sizedImageBuilder: (config) => Text(
      config.alt?.isNotEmpty == true
          ? config.alt!
          : context.l10n.groupsImageOnMac,
    ),
    onTapLink: (_, url, _) {
      final uri = url == null ? null : Uri.tryParse(url);
      if (uri != null && uri.hasScheme && uri.scheme.startsWith('http')) {
        unawaited(launchUrl(uri, mode: LaunchMode.externalApplication));
      }
    },
  );
}

/// An agent's avatar and name beside whatever it is saying.
class _AgentRow extends StatelessWidget {
  const _AgentRow({required this.member, required this.child});
  final GroupMember? member;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 28, bottom: DjlSpace.lg),
      child: Semantics(
        container: true,
        label: member?.handle ?? context.l10n.groupsRemovedAgent,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AgentAvatar(provider: member?.provider),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 2, bottom: 5),
                    child: Text(
                      member?.handle ?? context.l10n.groupsRemovedAgent,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        fontSize: 13,
                        color: colors.inkMuted,
                      ),
                    ),
                  ),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surfaceRaised,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      child: child,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A reply in progress. Only this row listens to the agent's live text.
class _WritingRow extends StatelessWidget {
  const _WritingRow({
    super.key,
    required this.member,
    required this.draft,
    required this.waiting,
  });
  final GroupMember member;
  final ValueListenable<String> draft;
  final bool waiting;

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    child: _AgentRow(
      member: member,
      child: ValueListenableBuilder<String>(
        valueListenable: draft,
        builder: (context, text, _) => text.isEmpty
            ? Semantics(
                label: waiting
                    ? context.l10n.groupsWaitingTurn
                    : context.l10n.groupsWriting,
                child: const _TypingDots(),
              )
            : _ReplyText(text),
      ),
    ),
  );
}

class _TypingDots extends StatefulWidget {
  const _TypingDots();
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulse.stop();
    } else if (!_pulse.isAnimating) {
      _pulse.repeat();
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = DjlColors.of(context).inkMuted;
    return SizedBox(
      height: 22,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, _) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var dot = 0; dot < 3; dot++)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2.5),
                child: Opacity(
                  // Each dot peaks a third of a cycle after the one before.
                  opacity:
                      .3 +
                      .7 *
                          (1 - (((_pulse.value - dot / 3) % 1) - .5).abs() * 2),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                    child: const SizedBox.square(dimension: 6),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.input,
    required this.focus,
    required this.enabled,
    required this.running,
    required this.drafts,
    required this.onAttach,
    required this.onRemoveDraft,
    required this.onMention,
    required this.onSend,
    required this.onStop,
  });
  final TextEditingController input;
  final FocusNode focus;
  final bool enabled, running;
  final List<DraftAttachment> drafts;

  /// Null when the Mac cannot take files.
  final void Function(BuildContext anchor)? onAttach;
  final ValueChanged<DraftAttachment> onRemoveDraft;
  final VoidCallback onMention, onSend, onStop;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final hasText = input.text.trim().isNotEmpty || drafts.isNotEmpty;
    final stops = running && !hasText;
    final active = enabled && (hasText || stops);
    return DjlGlassSurface(
      radius: 26,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (drafts.isNotEmpty)
            AttachmentDraftStrip(drafts: drafts, onRemove: onRemoveDraft),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 4, 6, 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (onAttach != null)
                  Builder(
                    builder: (anchor) => IconButton(
                      key: const Key('group-composer-attach'),
                      tooltip: context.l10n.groupsAttachTooltip,
                      onPressed: enabled ? () => onAttach!(anchor) : null,
                      icon: const Icon(DjlIcons.attach, size: 22),
                    ),
                  ),
                IconButton(
                  tooltip: context.l10n.groupsMentionAgent,
                  onPressed: enabled ? onMention : null,
                  icon: const Icon(DjlIcons.mention, size: 22),
                ),
                Expanded(
                  child: TextField(
                    key: const Key('group-composer-input'),
                    controller: input,
                    focusNode: focus,
                    enabled: enabled,
                    minLines: 1,
                    maxLines: 5,
                    textCapitalization: TextCapitalization.sentences,
                    style: Theme.of(context).textTheme.bodyLarge,
                    decoration: InputDecoration(
                      hintText: context.l10n.groupsMessageHint,
                      filled: false,
                      isDense: true,
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
                const SizedBox(width: DjlSpace.xs),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Semantics(
                    button: true,
                    enabled: active,
                    label: stops
                        ? context.l10n.groupsStopAgents
                        : context.l10n.cloudChatSendMessage,
                    child: GestureDetector(
                      key: const Key('group-composer-action'),
                      onTap: !active
                          ? null
                          : stops
                          ? onStop
                          : onSend,
                      child: AnimatedContainer(
                        duration: DjlMotion.of(context, DjlMotion.fast),
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: active ? colors.ink : colors.surfaceSunken,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          stops ? DjlIcons.stop : DjlIcons.send,
                          size: stops ? 14 : 18,
                          color: active ? colors.onInk : colors.inkFaint,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Who a message can be addressed to, filtered as the person types.
class _MentionStrip extends StatelessWidget {
  const _MentionStrip({
    required this.group,
    required this.query,
    required this.onPick,
  });
  final Group group;
  final String query;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    final prefix = query.toLowerCase();
    bool matches(String handle) => handle.toLowerCase().startsWith(prefix);
    final members = [
      for (final member in group.members)
        if (matches(member.handle)) member,
    ];
    final everyone = matches(groupAllHandle) || matches('everyone');
    if (members.isEmpty && !everyone) return const SizedBox.shrink();
    Widget chip(String label, Widget leading, String handle) => Padding(
      padding: const EdgeInsets.only(right: DjlSpace.sm),
      child: Material(
        color: colors.surfaceRaised,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () => onPick(handle),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 6, 14, 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                leading,
                const SizedBox(width: DjlSpace.sm),
                Text(label, style: Theme.of(context).textTheme.labelLarge),
              ],
            ),
          ),
        ),
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: DjlSpace.sm),
      child: SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            if (everyone)
              chip(
                context.l10n.groupsEveryone,
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: colors.ink,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(DjlIcons.group, size: 18, color: colors.onInk),
                ),
                groupAllHandle,
              ),
            for (final member in members)
              chip(
                member.handle,
                AgentAvatar(provider: member.provider, size: 32),
                member.handle,
              ),
          ],
        ),
      ),
    );
  }
}

class _PauseCard extends StatelessWidget {
  const _PauseCard({required this.onContinue, required this.onStop});
  final VoidCallback onContinue, onStop;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: DjlSpace.sm),
      padding: const EdgeInsets.all(DjlSpace.lg),
      decoration: BoxDecoration(
        color: colors.surfaceRaised,
        borderRadius: BorderRadius.circular(DjlRadius.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.l10n.groupsPausedTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: DjlSpace.xs),
          Text(
            context.l10n.groupsPausedBody,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: colors.inkMuted),
          ),
          const SizedBox(height: DjlSpace.md),
          Row(
            children: [
              Expanded(
                child: TextButton(
                  style: TextButton.styleFrom(
                    backgroundColor: colors.surfaceSunken,
                    minimumSize: const Size(0, 44),
                    shape: const StadiumBorder(),
                  ),
                  onPressed: onStop,
                  child: Text(context.l10n.groupsEndItHere),
                ),
              ),
              const SizedBox(width: DjlSpace.sm),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                  onPressed: onContinue,
                  child: Text(context.l10n.groupsLetThemContinue),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.quiet = false});
  final String text;
  final bool quiet;

  @override
  Widget build(BuildContext context) {
    final colors = DjlColors.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DjlSpace.md,
        0,
        DjlSpace.md,
        DjlSpace.sm,
      ),
      child: Semantics(
        liveRegion: true,
        child: Row(
          children: [
            Icon(
              quiet ? DjlIcons.sync : DjlIcons.error,
              size: 16,
              color: quiet ? colors.inkMuted : colors.danger,
            ),
            const SizedBox(width: DjlSpace.sm),
            Expanded(
              child: Text(text, style: Theme.of(context).textTheme.bodySmall),
            ),
          ],
        ),
      ),
    );
  }
}

/// The chat was opened before the Mac was reachable; nothing to show yet.
class _Offline extends StatelessWidget {
  const _Offline();
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(DjlSpace.xxxl),
      child: Text(
        context.l10n.groupsOfflineHint,
        textAlign: TextAlign.center,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: DjlColors.of(context).inkMuted),
      ),
    ),
  );
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: context.l10n.groupsLoadingMessages,
      child: const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
    ),
  );
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat({
    required this.group,
    required this.topInset,
    required this.onSuggestion,
  });
  final Group group;
  final double topInset;
  final VoidCallback onSuggestion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = DjlColors.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          DjlSpace.xxxl,
          topInset,
          DjlSpace.xxxl,
          DjlSpace.xxl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AgentAvatarStack(members: group.members, size: 52),
            const SizedBox(height: DjlSpace.xl),
            Text(
              context.l10n.groupsEveryoneIsHere,
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineMedium,
            ),
            const SizedBox(height: DjlSpace.sm),
            Text(
              context.l10n.groupsEmptyChatHint,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.inkMuted,
                height: 1.35,
              ),
            ),
            const SizedBox(height: DjlSpace.xl),
            TextButton(
              style: TextButton.styleFrom(
                backgroundColor: colors.surfaceRaised,
                shape: const StadiumBorder(),
                padding: const EdgeInsets.symmetric(
                  horizontal: DjlSpace.xl,
                  vertical: DjlSpace.md,
                ),
              ),
              onPressed: onSuggestion,
              child: Text(context.l10n.groupsAskEveryoneToSayHello),
            ),
          ],
        ),
      ),
    );
  }
}

class _MembersSheet extends StatelessWidget {
  const _MembersSheet({required this.controller, required this.groupId});
  final GroupsController controller;
  final String groupId;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final group = controller.group(groupId);
      final theme = Theme.of(context);
      final colors = DjlColors.of(context);
      if (group == null) return const SizedBox(height: 120);
      return SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(
            DjlSpace.xl,
            0,
            DjlSpace.xl,
            DjlSpace.lg,
          ),
          children: [
            Text(group.name, style: theme.textTheme.headlineMedium),
            const SizedBox(height: DjlSpace.xs),
            Text(
              context.l10n.groupsManageOnMac,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: DjlSpace.lg),
            for (final member in group.members)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: DjlSpace.sm),
                child: Row(
                  children: [
                    AgentAvatar(provider: member.provider, size: 40),
                    const SizedBox(width: DjlSpace.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            member.handle,
                            style: theme.textTheme.titleMedium,
                          ),
                          Text(
                            switch (controller.state(member.id)) {
                              GroupMemberState.working =>
                                context.l10n.groupsWriting,
                              GroupMemberState.waiting =>
                                context.l10n.groupsWaitingTurn,
                              GroupMemberState.failed =>
                                context.l10n.groupsCouldNotReply,
                              GroupMemberState.idle =>
                                member.role?.isNotEmpty == true
                                    ? '${member.role![0].toUpperCase()}'
                                          '${member.role!.substring(1)}'
                                    : context.l10n.groupsReady,
                            },
                            style: theme.textTheme.bodySmall?.copyWith(
                              color:
                                  controller.state(member.id) ==
                                      GroupMemberState.failed
                                  ? colors.danger
                                  : colors.inkMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (controller.state(member.id).busy)
                      TextButton(
                        style: TextButton.styleFrom(
                          backgroundColor: colors.surfaceRaised,
                          shape: const StadiumBorder(),
                          minimumSize: const Size(0, 36),
                        ),
                        onPressed: () =>
                            controller.stopMember(group, member.id),
                        child: Text(context.l10n.groupsStop),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );
}
