import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import '../../attachments/data/attachment_picker.dart';
import 'chat_controller.dart';
import 'cloud_usage_banner.dart';
import '../../images/presentation/cloud_image_creation_sheet.dart';
import '../domain/cloud_models.dart';
import '../../../core/presentation/cloud_chrome.dart';
import '../../../core/presentation/djl_glass.dart';
import 'message_view.dart';
import 'cloud_edit_message_sheet.dart';
import 'cloud_share_link_sheet.dart';
import '../../voice/presentation/voice_controller.dart';
import '../../voice/data/native_voice_driver.dart';
import '../../voice/data/voice_driver.dart';
import '../../settings/presentation/settings_controller.dart';
import '../../settings/domain/appearance.dart';

List<FontVariation>? _systemFontAxes(
  BuildContext context,
  double size, {
  bool semibold = false,
}) {
  if (Theme.of(context).platform != TargetPlatform.iOS ||
      DjlAppearance.of(context).font != AppFontStyle.system) {
    return null;
  }
  final scaled = MediaQuery.textScalerOf(context).scale(size);
  return [
    FontVariation.opticalSize(scaled < 17 ? 17 : scaled),
    if (semibold) const FontVariation.weight(590),
  ];
}

double? _systemTracking(BuildContext context, double tracking) {
  if (Theme.of(context).platform != TargetPlatform.iOS ||
      DjlAppearance.of(context).font != AppFontStyle.system) {
    return null;
  }
  // SF Pro tracking: developer.apple.com/design/human-interface-guidelines/typography
  return tracking;
}

class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    required this.controller,
    this.createImageOnOpen = false,
    this.settings,
    this.voiceDriver,
    this.onConversationChanged,
    this.onOpenNavigation,
    this.exposed = true,
  });
  final VoidCallback? onOpenNavigation;
  final bool exposed;
  final ChatController controller;
  final bool createImageOnOpen;
  final SettingsController? settings;
  final VoiceDriver? voiceDriver;
  final ValueChanged<String?>? onConversationChanged;
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> with WidgetsBindingObserver {
  final _text = TextEditingController(), _scroll = ScrollController();
  final _picker = AttachmentPicker();
  late final VoiceController _voice;
  bool _displayed = false, _foreground = true, _lastAutomaticSpeech = false;
  bool _applyingComposerDraft = false;
  String? _lastConversationId;
  bool get _automaticSpeech =>
      widget.settings?.ready == true && widget.settings?.spokenReplies == true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _text.addListener(_composerChanged);
    _voice = VoiceController(
      widget.voiceDriver ?? NativeVoiceDriver(),
      onDraft: (value) {
        if (mounted) {
          _text.value = TextEditingValue(
            text: value,
            selection: TextSelection.collapsed(offset: value.length),
          );
        }
      },
    );
    _lastAutomaticSpeech = _automaticSpeech;
    widget.controller.addListener(_chatChanged);
    widget.settings?.addListener(_preferencesChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _displayed = true;
        _chatChanged();
      }
    });
    unawaited(_initialize());
  }

  void _preferencesChanged() {
    final enabled = _automaticSpeech;
    if (_lastAutomaticSpeech && !enabled) unawaited(_voice.suspend());
    _lastAutomaticSpeech = enabled;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_displayed && ModalRoute.of(context)?.isCurrent == false) {
      unawaited(_voice.suspend());
    }
  }

  @override
  void didUpdateWidget(covariant ChatPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.exposed != widget.exposed) {
      _voice.setForeground(_foreground && widget.exposed);
      if (!widget.exposed) unawaited(_voice.suspend());
    }
  }

  void _chatChanged() {
    if (!mounted || !_displayed) return;
    if (widget.controller.composerReady &&
        _text.text != widget.controller.composerDraft) {
      _applyingComposerDraft = true;
      final text = widget.controller.composerDraft;
      _text.value = TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: text.length),
      );
      _applyingComposerDraft = false;
    }
    final id = widget.controller.conversation?.id;
    if (_lastConversationId != id) {
      _lastConversationId = id;
      widget.onConversationChanged?.call(id);
    }
    _speakReply();
  }

  void _composerChanged() {
    if (!_applyingComposerDraft) {
      widget.controller.updateComposerDraft(_text.text);
    }
  }

  void _speakReply() {
    if (!_displayed ||
        !widget.exposed ||
        !_foreground ||
        !_automaticSpeech ||
        ModalRoute.of(context)?.isCurrent == false) {
      return;
    }
    final run = widget.controller.reducer;
    final message = widget.controller.visibleMessages.lastOrNull;
    if (run == null ||
        message?.role != 'assistant' ||
        message?.runId != run.runId) {
      return;
    }
    unawaited(
      _voice.readReply(
        runId: run.runId,
        succeeded: run.status == 'succeeded',
        messageId: message!.id,
        text: message.text,
      ),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _voice.setForeground(_foreground && widget.exposed);
    if (state == AppLifecycleState.resumed) {
      widget.controller.resume();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      widget.controller.suspend();
    }
    if (!_foreground) {
      unawaited(
        _voice.suspend(
          preservePermissionRequest: state == AppLifecycleState.inactive,
        ),
      );
    }
  }

  @override
  void dispose() {
    _displayed = false;
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_chatChanged);
    widget.settings?.removeListener(_preferencesChanged);
    _text.removeListener(_composerChanged);
    _voice.dispose();
    _text.dispose();
    _scroll.dispose();
    widget.controller.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    await widget.controller.initialize();
    if (mounted && widget.createImageOnOpen) await _generateImage();
  }

  Future<void> _generateImage() =>
      showCloudImageCreationSheet(context, controller: widget.controller);

  Future<void> _send() async {
    if (_voice.listening) await _voice.stop();
    await _voice.suspend();
    if (!mounted) return;
    final text = _text.text;
    if (await widget.controller.send(text) && mounted) {
      if (_text.text == text) _text.clear();
      final run = widget.controller.reducer;
      if (_automaticSpeech &&
          _foreground &&
          run != null &&
          ModalRoute.of(context)?.isCurrent != false) {
        _voice.expectReply(run.runId);
        _speakReply();
      }
    }
  }

  Future<void> _attach(String kind) async {
    try {
      final file = kind == 'file'
          ? await _picker.file()
          : await _picker.image(camera: kind == 'camera');
      if (file != null && mounted) {
        await widget.controller.attach(file.name, file.mime, file.bytes);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e is PlatformException
                  ? e.message ?? 'Could not open the picker. Please try again.'
                  : e.toString(),
            ),
          ),
        );
      }
    }
  }

  Future<void> _edit(ChatMessage original) async {
    final value = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      builder: (context) => CloudEditMessageSheet(original: original.text),
    );
    if (value != null && mounted) {
      await widget.controller.edit(original, value);
    }
  }

  Future<void> _share() async {
    final chat = widget.controller;
    final url = await chat.share();
    if (!mounted ||
        widget.controller != chat ||
        !widget.exposed ||
        !_foreground ||
        ModalRoute.of(context)?.isCurrent == false ||
        url == null) {
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      builder: (context) => CloudShareLinkSheet(url: url),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.controller, _voice]),
    builder: (context, _) {
      final chat = widget.controller;
      final visible = chat.visibleMessages;
      final scheme = Theme.of(context).colorScheme;
      final providers =
          chat.models.map((m) => m['provider'] as String).toSet().toList()
            ..sort();
      final canSend =
          chat.composerReady &&
          chat.model != null &&
          !chat.sending &&
          !chat.uploading &&
          !chat.redeemingUsage &&
          !_voice.initializing &&
          !_voice.listening &&
          (_text.text.trim().isNotEmpty || chat.attachments.isNotEmpty);
      return Scaffold(
        appBar: AppBar(
          toolbarHeight: 44,
          clipBehavior: Clip.none,
          leadingWidth: widget.onOpenNavigation == null ? null : 60,
          leading: widget.onOpenNavigation == null
              ? null
              : Padding(
                  padding: const EdgeInsets.only(left: 16),
                  child: CloudNavigationButton(
                    icon: CupertinoIcons.line_horizontal_3,
                    label: 'Open navigation',
                    onPressed: widget.onOpenNavigation!,
                  ),
                ),
          centerTitle: true,
          excludeHeaderSemantics: true,
          title: Tooltip(
            message: 'Model',
            excludeFromSemantics: true,
            child: Semantics(
              key: const Key('cloud.model-picker'),
              button: true,
              label: 'Model',
              value: chat.selectedModel?['displayName'] as String? ?? 'DJL',
              child: PopupMenuButton<String>(
                tooltip: '',
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                enabled:
                    chat.model != null &&
                    chat.models.isNotEmpty &&
                    !chat.sending &&
                    !chat.streaming,
                onSelected: chat.setModel,
                itemBuilder: (_) => [
                  for (final provider in providers) ...[
                    _CloudModelProviderHeader(
                      const {
                            'openai': 'OpenAI',
                            'anthropic': 'Anthropic',
                            'openrouter': 'OpenRouter',
                          }[provider] ??
                          provider,
                      key: Key('cloud.model-provider.$provider'),
                    ),
                    for (final m in chat.models.where(
                      (m) => m['provider'] == provider,
                    ))
                      PopupMenuItem<String>(
                        height: 44,
                        value: m['id'] as String,
                        child: Semantics(
                          key: Key('cloud.model-item.${m['id']}'),
                          selected: m['id'] == chat.model,
                          child: Row(
                            children: [
                              SizedBox(
                                width: 24,
                                child: m['id'] == chat.model
                                    ? ExcludeSemantics(
                                        child: Icon(
                                          Icons.check,
                                          size: 20,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                      )
                                    : null,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  m['displayName'] as String? ??
                                      m['id'] as String,
                                  style: TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w400,
                                    color: scheme.onSurface,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ],
                child: ExcludeSemantics(
                  child: SizedBox(
                    height: 44,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Flexible(
                          child: Builder(
                            builder: (context) => Text(
                              chat.selectedModel?['displayName'] as String? ??
                                  'DJL',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodyLarge
                                  ?.copyWith(
                                    color: scheme.onSurface,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    height: 1.2,
                                    letterSpacing: _systemTracking(
                                      context,
                                      -.23,
                                    ),
                                    fontVariations: _systemFontAxes(
                                      context,
                                      15,
                                      semibold: true,
                                    ),
                                  ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          CupertinoIcons.chevron_down,
                          size: 18,
                          color: scheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          actions: [
            if (chat.conversation != null && visible.isNotEmpty)
              IconButton(
                tooltip: 'Share link',
                onPressed: chat.streaming || chat.sharing ? null : _share,
                icon: chat.sharing
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.ios_share),
              ),
          ],
        ),
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, bounds) => Column(
              children: [
                if (chat.loading) const LinearProgressIndicator(),
                Expanded(
                  child: visible.isEmpty
                      ? Center(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(11),
                                  child: Image.asset(
                                    'assets/djl-logo.png',
                                    width: 44,
                                    height: 44,
                                    excludeFromSemantics: true,
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  chat.mode == 'task'
                                      ? 'What should DJL work on?'
                                      : 'How can I help?',
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.titleLarge
                                      ?.copyWith(
                                        color: scheme.onSurface,
                                        fontSize: 18,
                                        fontWeight: FontWeight.w600,
                                        height: 1.2,
                                        letterSpacing: _systemTracking(
                                          context,
                                          -.44,
                                        ),
                                        fontVariations: _systemFontAxes(
                                          context,
                                          18,
                                          semibold: true,
                                        ),
                                      ),
                                ),
                                if (chat.mode == 'task') ...[
                                  const SizedBox(height: 10),
                                  Text(
                                    "Start a task and return to the result when it's ready.",
                                    textAlign: TextAlign.center,
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodyMedium
                                        ?.copyWith(
                                          fontSize: 14,
                                          height: 1.2,
                                          letterSpacing: _systemTracking(
                                            context,
                                            -.15,
                                          ),
                                          fontVariations: _systemFontAxes(
                                            context,
                                            14,
                                          ),
                                          color: scheme.onSurfaceVariant,
                                        ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                          keyboardDismissBehavior:
                              ScrollViewKeyboardDismissBehavior.onDrag,
                          itemCount: visible.length,
                          itemBuilder: (context, index) {
                            final message = visible[index];
                            return MessageView(
                              message: message,
                              isStreaming:
                                  message.role == 'assistant' &&
                                  chat.streaming &&
                                  message.runId == chat.reducer?.runId,
                              emptyText: chat.emptyMessageText(message),
                              repository: chat.repository,
                              onRegenerate:
                                  message.role == 'assistant' && !chat.streaming
                                  ? () => chat.regenerate(message)
                                  : null,
                              onEdit: message.role == 'user' && !chat.streaming
                                  ? () => _edit(message)
                                  : null,
                              siblings: chat.messages
                                  .where((m) => m.parentId == message.parentId)
                                  .toList(),
                              onSibling: chat.selectBranch,
                              onSpeak: message.role == 'assistant'
                                  ? () => _voice.read(message.id, message.text)
                                  : null,
                              speaking: _voice.speakingMessageId == message.id,
                            );
                          },
                        ),
                ),
                if (chat.steps.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 4,
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.task_alt, size: 16),
                        const SizedBox(width: 8),
                        Text(
                          'Step ${chat.steps.last['step']} of ${chat.steps.last['maxSteps']}',
                        ),
                      ],
                    ),
                  ),
                if (chat.usageBlockedUntil != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                    child: CloudUsageBanner(
                      controller: chat,
                      canAct: () => mounted && widget.exposed && _foreground,
                    ),
                  ),
                if (chat.error != null || chat.notice != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            chat.error ?? chat.notice!,
                            style: TextStyle(
                              color: chat.error == null
                                  ? null
                                  : Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                        if (chat.canRetry)
                          TextButton(
                            onPressed: chat.retry,
                            child: const Text('Retry'),
                          ),
                        if (chat.streaming)
                          TextButton(
                            onPressed: chat.resume,
                            child: const Text('Reconnect'),
                          ),
                      ],
                    ),
                  ),
                if (chat.composerError != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            chat.composerError!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: chat.composerSaving
                              ? null
                              : chat.retryComposerDraft,
                          child: const Text('Retry draft'),
                        ),
                      ],
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
                  child: DjlGlassSurface(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: bounds.maxHeight * .85,
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(26),
                        child: SingleChildScrollView(
                          reverse: true,
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (chat.modelSelectionError != null)
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        chat.modelSelectionError!,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: scheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                    TextButton(
                                      onPressed: chat.modelSelectionSaving
                                          ? null
                                          : chat.retryModelSelection,
                                      child: const Text('Retry model choice'),
                                    ),
                                  ],
                                ),
                              if (chat.attachments.isNotEmpty)
                                SingleChildScrollView(
                                  scrollDirection: Axis.horizontal,
                                  child: Row(
                                    children: chat.attachments
                                        .map(
                                          (a) => Padding(
                                            padding: const EdgeInsets.all(4),
                                            child: InputChip(
                                              label: Text(
                                                a['_displayName'] as String,
                                              ),
                                              onDeleted: () =>
                                                  chat.removeAttachment(a),
                                            ),
                                          ),
                                        )
                                        .toList(),
                                  ),
                                ),
                              if (_voice.error != null)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Text(
                                    _voice.error!,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: scheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              TextField(
                                key: const Key('composer'),
                                controller: _text,
                                enabled: chat.composerReady,
                                minLines: 1,
                                maxLines: 6,
                                style: TextStyle(
                                  fontSize: 15,
                                  height: 1.2,
                                  fontVariations: _systemFontAxes(context, 15),
                                  letterSpacing: _systemTracking(context, -.23),
                                ),
                                decoration: InputDecoration(
                                  hintText: 'Message DJL',
                                  hintStyle: TextStyle(
                                    color: scheme.onSurfaceVariant.withValues(
                                      alpha: .55,
                                    ),
                                  ),
                                  filled: false,
                                  border: InputBorder.none,
                                  enabledBorder: InputBorder.none,
                                  focusedBorder: InputBorder.none,
                                  disabledBorder: InputBorder.none,
                                  isDense: true,
                                  isCollapsed: true,
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 4,
                                    vertical: 0,
                                  ),
                                ),
                                textCapitalization:
                                    TextCapitalization.sentences,
                              ),
                              const SizedBox(height: 8),
                              OverflowBar(
                                alignment: MainAxisAlignment.spaceBetween,
                                overflowAlignment: OverflowBarAlignment.end,
                                overflowSpacing: 8,
                                children: [
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      PopupMenuButton<String>(
                                        tooltip: 'Attach file or image',
                                        style: IconButton.styleFrom(
                                          minimumSize: const Size(34, 34),
                                          maximumSize: const Size(34, 34),
                                          padding: EdgeInsets.zero,
                                          tapTargetSize:
                                              MaterialTapTargetSize.shrinkWrap,
                                        ),
                                        onSelected: (value) => value == 'image'
                                            ? _generateImage()
                                            : _attach(value),
                                        enabled:
                                            !chat.redeemingUsage &&
                                            !chat.uploading &&
                                            !chat.sending &&
                                            !chat.streaming,
                                        itemBuilder: (_) => [
                                          if (chat
                                              .configuration
                                              .imageGeneration)
                                            const PopupMenuItem(
                                              value: 'image',
                                              child: Text('Create image'),
                                            ),
                                          const PopupMenuItem(
                                            value: 'file',
                                            child: Text('Choose file'),
                                          ),
                                          if (chat.acceptsImages)
                                            const PopupMenuItem(
                                              value: 'photo',
                                              child: Text('Photo library'),
                                            ),
                                          if (chat.acceptsImages)
                                            const PopupMenuItem(
                                              value: 'camera',
                                              child: Text('Camera'),
                                            ),
                                        ],
                                        padding: EdgeInsets.zero,
                                        icon: Container(
                                          width: 34,
                                          height: 34,
                                          decoration: BoxDecoration(
                                            color: scheme.surface,
                                            shape: BoxShape.circle,
                                          ),
                                          alignment: Alignment.center,
                                          child: chat.uploading
                                              ? const SizedBox(
                                                  width: 18,
                                                  height: 18,
                                                  child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                      ),
                                                )
                                              : const Icon(
                                                  CupertinoIcons.plus,
                                                  size: 22,
                                                ),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Semantics(
                                        toggled: chat.mode == 'task',
                                        child: Tooltip(
                                          message: 'Task mode',
                                          child: TextButton(
                                            onPressed:
                                                chat.sending || chat.streaming
                                                ? null
                                                : () => chat.setMode(
                                                    chat.mode == 'task'
                                                        ? 'chat'
                                                        : 'task',
                                                  ),
                                            style: TextButton.styleFrom(
                                              padding: EdgeInsets.zero,
                                              minimumSize: const Size(0, 34),
                                              tapTargetSize:
                                                  MaterialTapTargetSize
                                                      .shrinkWrap,
                                            ),
                                            child: Container(
                                              constraints: const BoxConstraints(
                                                minHeight: 34,
                                              ),
                                              padding:
                                                  const EdgeInsets.symmetric(
                                                    horizontal: 12,
                                                    vertical: 6,
                                                  ),
                                              decoration: BoxDecoration(
                                                color: chat.mode == 'task'
                                                    ? cloudActionColor(context)
                                                    : scheme.surface,
                                                borderRadius:
                                                    BorderRadius.circular(24),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Icon(
                                                    Icons.checklist,
                                                    size: 17,
                                                    color: chat.mode == 'task'
                                                        ? Colors.white
                                                        : scheme.onSurface,
                                                  ),
                                                  const SizedBox(width: 8),
                                                  Text(
                                                    'Task',
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      fontVariations:
                                                          _systemFontAxes(
                                                            context,
                                                            12,
                                                            semibold: true,
                                                          ),
                                                      color: chat.mode == 'task'
                                                          ? Colors.white
                                                          : scheme.onSurface,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        constraints:
                                            const BoxConstraints.tightFor(
                                              width: 34,
                                              height: 34,
                                            ),
                                        style: IconButton.styleFrom(
                                          minimumSize: const Size(34, 34),
                                          maximumSize: const Size(34, 34),
                                          tapTargetSize:
                                              MaterialTapTargetSize.shrinkWrap,
                                        ),
                                        padding: EdgeInsets.zero,
                                        color: scheme.onSurface,
                                        tooltip: _voice.listening
                                            ? 'Stop dictation'
                                            : 'Start dictation',
                                        onPressed:
                                            _voice.initializing ||
                                                !chat.composerReady ||
                                                chat.sending ||
                                                chat.streaming
                                            ? null
                                            : () {
                                                if (_voice.listening) {
                                                  _voice.stop();
                                                } else {
                                                  _voice.start(_text.text);
                                                }
                                              },
                                        icon: Icon(
                                          _voice.listening
                                              ? CupertinoIcons.stop_circle
                                              : CupertinoIcons.mic,
                                          size: 20,
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      IconButton(
                                        constraints:
                                            const BoxConstraints.tightFor(
                                              width: 34,
                                              height: 34,
                                            ),
                                        style: IconButton.styleFrom(
                                          minimumSize: const Size(34, 34),
                                          maximumSize: const Size(34, 34),
                                          tapTargetSize:
                                              MaterialTapTargetSize.shrinkWrap,
                                        ),
                                        tooltip: chat.streaming
                                            ? 'Stop response'
                                            : 'Send message',
                                        onPressed: chat.streaming
                                            ? chat.stop
                                            : canSend
                                            ? _send
                                            : null,
                                        padding: EdgeInsets.zero,
                                        icon: Container(
                                          width: 34,
                                          height: 34,
                                          alignment: Alignment.center,
                                          decoration: BoxDecoration(
                                            shape: BoxShape.circle,
                                            color: canSend || chat.streaming
                                                ? scheme.onSurface
                                                : scheme.onSurface.withValues(
                                                    alpha: .2,
                                                  ),
                                          ),
                                          child: chat.sending
                                              ? SizedBox(
                                                  width: 18,
                                                  height: 18,
                                                  child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                        color: scheme.surface,
                                                      ),
                                                )
                                              : Icon(
                                                  chat.streaming
                                                      ? Icons.stop
                                                      : CupertinoIcons.arrow_up,
                                                  size: 20,
                                                  color: scheme.surface,
                                                ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

class _CloudModelProviderHeader extends PopupMenuEntry<String> {
  const _CloudModelProviderHeader(this.label, {super.key});
  final String label;
  @override
  double get height => 28;
  @override
  bool represents(String? value) => false;
  @override
  State<_CloudModelProviderHeader> createState() =>
      _CloudModelProviderHeaderState();
}

class _CloudModelProviderHeaderState extends State<_CloudModelProviderHeader> {
  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    header: true,
    child: SizedBox(
      height: widget.height,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            widget.label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    ),
  );
}
