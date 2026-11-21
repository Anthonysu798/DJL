import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:re_editor/re_editor.dart';
import 'package:re_highlight/languages/bash.dart';
import 'package:re_highlight/languages/c.dart';
import 'package:re_highlight/languages/cpp.dart';
import 'package:re_highlight/languages/csharp.dart';
import 'package:re_highlight/languages/css.dart';
import 'package:re_highlight/languages/go.dart';
import 'package:re_highlight/languages/ini.dart';
import 'package:re_highlight/languages/java.dart';
import 'package:re_highlight/languages/javascript.dart';
import 'package:re_highlight/languages/json.dart';
import 'package:re_highlight/languages/markdown.dart';
import 'package:re_highlight/languages/python.dart';
import 'package:re_highlight/languages/ruby.dart';
import 'package:re_highlight/languages/rust.dart';
import 'package:re_highlight/languages/sql.dart';
import 'package:re_highlight/languages/swift.dart';
import 'package:re_highlight/languages/typescript.dart';
import 'package:re_highlight/languages/xml.dart';
import 'package:re_highlight/languages/yaml.dart';
import '../domain/workspace_models.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

String workspaceCodeLanguage(String name) {
  if (name.toLowerCase() == 'dockerfile') return 'bash';
  final suffix = name.contains('.') ? name.split('.').last.toLowerCase() : '';
  return switch (suffix) {
    'bash' || 'sh' || 'zsh' => 'bash',
    'c' || 'h' || 'm' => 'c',
    'cc' || 'cpp' || 'cxx' || 'hh' || 'hpp' || 'hxx' || 'mm' => 'cpp',
    'cs' => 'csharp',
    'css' || 'scss' => 'css',
    'go' => 'go',
    'html' || 'htm' => 'html',
    'java' || 'kt' => 'java',
    'js' || 'mjs' || 'cjs' => 'javascript',
    'jsx' => 'jsx',
    'json' => 'json',
    'md' || 'markdown' => 'markdown',
    'py' => 'python',
    'rb' => 'ruby',
    'rs' => 'rust',
    'sql' => 'sql',
    'swift' => 'swift',
    'toml' => 'toml',
    'tsx' => 'tsx',
    'ts' => 'typescript',
    'yaml' || 'yml' => 'yaml',
    _ => 'plain',
  };
}

String? workspaceLanguageLabel(String name) =>
    switch (workspaceCodeLanguage(name)) {
      'plain' => null,
      'cpp' => 'C++',
      'csharp' => 'C#',
      'javascript' => 'JavaScript',
      'typescript' => 'TypeScript',
      'jsx' => 'JSX',
      'tsx' => 'TSX',
      'html' => 'HTML',
      'css' => 'CSS',
      'json' => 'JSON',
      'sql' => 'SQL',
      'yaml' => 'YAML',
      'toml' => 'TOML',
      final id => '${id[0].toUpperCase()}${id.substring(1)}',
    };

Color workspaceCodeBackground(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xff121417)
    : const Color(0xfff5f6f8);

class WorkspaceCodeView extends StatefulWidget {
  const WorkspaceCodeView({
    super.key,
    required this.file,
    required this.findRevision,
  });
  final WorkspaceTextFile file;
  final int findRevision;
  @override
  State<WorkspaceCodeView> createState() => _WorkspaceCodeViewState();
}

class _WorkspaceCodeViewState extends State<WorkspaceCodeView> {
  late final _editing = CodeLineEditingController.fromText(
    widget.file.content,
    CodeLineOptions(
      lineBreak: widget.file.content.contains('\r\n')
          ? TextLineBreak.crlf
          : TextLineBreak.lf,
    ),
  );
  late final _find = CodeFindController(_editing);
  final _focus = FocusNode();
  late final _toolbar = MobileSelectionToolbarController(
    builder:
        ({
          required context,
          required anchors,
          required controller,
          required onDismiss,
          required onRefresh,
        }) => AdaptiveTextSelectionToolbar.buttonItems(
          anchors: anchors,
          buttonItems: [
            ContextMenuButtonItem(
              type: ContextMenuButtonType.copy,
              onPressed: () {
                unawaited(controller.copy());
                onDismiss();
              },
            ),
            ContextMenuButtonItem(
              type: ContextMenuButtonType.selectAll,
              onPressed: () {
                controller.selectAll();
                onRefresh();
              },
            ),
            ContextMenuButtonItem(
              label: context.l10n.workspaceFindInFile,
              onPressed: () {
                onDismiss();
                _find.findMode();
              },
            ),
          ],
        ),
  );
  CodeHighlightTheme? _codeTheme;

  @override
  void initState() {
    super.initState();
    FocusManager.instance.addEarlyKeyEventHandler(_readOnlyHardwareKey);
  }

  // re_editor0.10.0's mobile legacy handler calls edit methods for these two
  // hardware keys even in readOnly mode. Intercept only while this view owns focus.
  KeyEventResult _readOnlyHardwareKey(KeyEvent event) =>
      _focus.hasFocus &&
          {
            LogicalKeyboardKey.backspace,
            LogicalKeyboardKey.enter,
            LogicalKeyboardKey.numpadEnter,
          }.contains(event.logicalKey)
      ? KeyEventResult.handled
      : KeyEventResult.ignored;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = workspaceCodeLanguage(widget.file.name);
    final modes = {
      'bash': langBash,
      'c': langC,
      'cpp': langCpp,
      'csharp': langCsharp,
      'css': langCss,
      'go': langGo,
      'html': langXml,
      'java': langJava,
      'javascript': langJavascript,
      'jsx': langJavascript,
      'json': langJson,
      'markdown': langMarkdown,
      'python': langPython,
      'ruby': langRuby,
      'rust': langRust,
      'sql': langSql,
      'swift': langSwift,
      'toml': langIni,
      'typescript': langTypescript,
      'tsx': langTypescript,
      'yaml': langYaml,
    };
    final mode = modes[language];
    if (mode == null || utf8.encode(widget.file.content).length > 512 * 1024) {
      _codeTheme = null;
      return;
    }
    final dark = Theme.of(context).brightness == Brightness.dark;
    TextStyle token(int light, int night, {bool bold = false}) => TextStyle(
      color: Color(dark ? night : light),
      fontWeight: bold ? FontWeight.bold : null,
    );
    _codeTheme = CodeHighlightTheme(
      languages: {
        language: CodeHighlightThemeMode(mode: mode, maxSize: 512 * 1024),
      },
      theme: {
        'comment': token(0xff737d8c, 0xff738aa1),
        'keyword': token(0xffba2e73, 0xfff08fc2, bold: true),
        'operator': token(0xffba2e73, 0xfff08fc2),
        'string': token(0xff2b8c52, 0xffc2d68c),
        'number': token(0xffb8611f, 0xfff2ab75),
        'literal': token(0xffb8611f, 0xfff2ab75),
        'title': token(0xff005ebd, 0xff80bdff),
        'function': token(0xff005ebd, 0xff80bdff),
        'type': token(0xff148580, 0xff8fdbc7, bold: true),
        'attr': token(0xff6e40bd, 0xffd6b3ff),
        'property': token(0xff6e40bd, 0xffd6b3ff),
        'built_in': token(0xffb35414, 0xffffbd78),
      },
    );
  }

  @override
  void didUpdateWidget(WorkspaceCodeView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.findRevision != oldWidget.findRevision) _find.findMode();
  }

  @override
  void dispose() {
    FocusManager.instance.removeEarlyKeyEventHandler(_readOnlyHardwareKey);
    _find.dispose();
    _editing.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      label: context.l10n.workspaceFileContents,
      value: widget.file.content,
      textField: true,
      readOnly: true,
      multiline: true,
      child: CodeEditor(
        controller: _editing,
        findController: _find,
        focusNode: _focus,
        toolbarController: _toolbar,
        readOnly: true,
        wordWrap: false,
        autofocus: false,
        showCursorWhenReadOnly: false,
        // Null renders the entire line, including long Unicode grapheme sequences.
        maxLengthSingleLineRendering: null,
        chunkAnalyzer: const NonCodeChunkAnalyzer(),
        padding: const EdgeInsets.fromLTRB(10, 14, 18, 14),
        style: CodeEditorStyle(
          fontSize: MediaQuery.textScalerOf(context).scale(13),
          fontHeight: 1.22,
          fontFamily: 'GeistMono',
          textColor: colors.onSurface,
          backgroundColor: workspaceCodeBackground(context),
          selectionColor: colors.primary.withValues(alpha: .22),
          highlightColor: colors.primary.withValues(alpha: .18),
          codeTheme: _codeTheme,
        ),
        leadingDivider: VerticalDivider(
          width: 1,
          thickness: .5,
          color: colors.outlineVariant,
        ),
        indicatorBuilder: (context, controller, chunks, notifier) =>
            DefaultCodeLineNumber(
              controller: controller,
              notifier: notifier,
              textStyle: TextStyle(
                fontFamily: 'GeistMono',
                fontSize: MediaQuery.textScalerOf(context).scale(12),
                color: colors.onSurfaceVariant.withValues(alpha: .8),
              ),
            ),
        findBuilder: (context, controller, readOnly) => PreferredSize(
          preferredSize: Size.fromHeight(controller.value == null ? 0 : 52),
          child: controller.value == null
              ? const SizedBox.shrink()
              : ColoredBox(
                  color: colors.surface,
                  child: Row(
                    children: [
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          key: const Key('workspace_find_input'),
                          controller: controller.findInputController,
                          focusNode: controller.findInputFocusNode,
                          decoration: InputDecoration(
                            hintText: context.l10n.workspaceFindInFile,
                            border: InputBorder.none,
                          ),
                          onSubmitted: (_) => controller.nextMatch(),
                        ),
                      ),
                      Text(
                        controller.value!.searching
                            ? context.l10n.workspaceSearching
                            : context.l10n.workspaceMatchPosition(
                                (controller.value!.result?.index ?? -1) + 1,
                                controller.value!.result?.matches.length ?? 0,
                              ),
                        style: const TextStyle(fontSize: 11),
                      ),
                      IconButton(
                        tooltip: context.l10n.workspacePreviousMatch,
                        icon: const Icon(DjlIcons.chevronUp),
                        onPressed: controller.previousMatch,
                      ),
                      IconButton(
                        tooltip: context.l10n.workspaceNextMatch,
                        icon: const Icon(DjlIcons.chevronDown),
                        onPressed: controller.nextMatch,
                      ),
                      IconButton(
                        tooltip: context.l10n.workspaceCloseFind,
                        icon: const Icon(DjlIcons.close),
                        onPressed: () {
                          controller.findInputFocusNode.unfocus();
                          controller.close();
                        },
                      ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}
