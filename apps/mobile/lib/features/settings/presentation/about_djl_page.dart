import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/appearance.dart';
import 'settings_group.dart';

import '../../../core/design/djl_icons.dart';

final _support = Uri.parse('https://www.slcor.com/');
final _source = Uri.parse('https://github.com/Anthonysu798/DJL');
final _privacy = Uri.parse('https://slcor.com/privacy');
final _terms = Uri.parse('https://slcor.com/terms');

Future<void> _open(BuildContext context, Uri uri) async {
  var opened = false;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    /* Keep link failure recoverable in Settings. */
  }
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Could not open this link. Try again.')),
    );
  }
}

class LocalAboutCard extends StatelessWidget {
  const LocalAboutCard({super.key});
  @override
  Widget build(BuildContext context) {
    Widget row(String title, IconData icon, VoidCallback action) =>
        SettingsLinkRow(title: title, leading: Icon(icon), onTap: action);
    return SettingsGroup(
      title: 'About',
      footer:
          'Chats are end-to-end encrypted between your phone and paired device.',
      children: [
        row(
          'How DJL Works',
          DjlIcons.info,
          () => Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const AboutDjlPage())),
        ),
        row('Chat & Support', DjlIcons.globe, () => _open(context, _support)),
        row('Privacy Policy', DjlIcons.hand, () => _open(context, _privacy)),
        row('Terms of Use', DjlIcons.document, () => _open(context, _terms)),
      ],
    );
  }
}

class AboutDjlPage extends StatelessWidget {
  const AboutDjlPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final appearance = DjlAppearance.of(context);
    final fill = colors.surfaceContainerLow;
    final secondary = colors.onSurfaceVariant;
    final tertiary = colors.onSurface.withValues(alpha: .3);
    Color surface(double opacity) => fill.withValues(alpha: fill.a * opacity);

    Widget stack(List<Widget> children, {double spacing = 14}) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) SizedBox(height: spacing),
          children[i],
        ],
      ],
    );

    Widget prose(String text, {double size = 14}) => Semantics(
      container: true,
      child: MarkdownBody(
        data: text,
        fitContent: false,
        styleSheet: appearance
            .markdown(context)
            .copyWith(
              p: TextStyle(fontSize: size, color: secondary, height: 1.2),
              code: TextStyle(
                fontFamily: appearance.font.codeFamily,
                fontSize: size,
                color: colors.onSurface,
              ),
            ),
      ),
    );

    Widget heading(String text, {FontWeight weight = FontWeight.w600}) =>
        Semantics(
          container: true,
          header: true,
          child: Text(
            text,
            style: TextStyle(
              fontSize: 15.5,
              fontWeight: weight,
              color: colors.onSurface,
            ),
          ),
        );

    Widget section(String title, List<Widget> children) =>
        stack([heading(title), ...children]);

    Widget bullets(List<String> items) => stack([
      for (final item in items)
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(
              child: SizedBox(
                width: 18,
                child: Text(
                  '->',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: tertiary,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(child: prose(item)),
          ],
        ),
    ], spacing: 8);

    Widget callout(String asset, String text) {
      final color = colors.onSurface;
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: surface(.4),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: color.withValues(alpha: .1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: SizedBox.square(
                dimension: 28,
                child: Center(
                  child: SvgPicture.asset(
                    'assets/icons/guide/$asset.svg',
                    width: 13,
                    height: 13,
                    excludeFromSemantics: true,
                    colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: prose(text, size: 11)),
          ],
        ),
      );
    }

    Widget iconRow(IconData icon, String text) => Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              color: colors.onSurface.withValues(alpha: .05),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(icon, size: 12, color: secondary),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: prose(text)),
      ],
    );

    final largeText = MediaQuery.textScalerOf(context).scale(11) > 16.5;
    Widget endpoint(String text, TextAlign align) => Text(
      text,
      textAlign: align,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: colors.onSurface,
      ),
    );
    Widget connection(String via) => Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(DjlIcons.arrowRight, size: 9, color: tertiary),
        const SizedBox(height: 2),
        Text(
          via,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 10,
            fontStyle: FontStyle.italic,
            color: secondary,
          ),
        ),
      ],
    );
    const routes = [
      ('DJL Mobile', 'WebSocket', 'Bridge on your paired device'),
      ('Bridge', 'JSON-RPC', 'codex app-server'),
      ('Codex', 'JSONL rollout', '~/.codex/sessions'),
    ];

    Widget architecture() => Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: surface(.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          for (var i = 0; i < routes.length; i++) ...[
            Semantics(
              container: true,
              label: '${routes[i].$1} to ${routes[i].$3} via ${routes[i].$2}',
              excludeSemantics: true,
              child: largeText
                  ? stack([
                      endpoint(routes[i].$1, TextAlign.center),
                      connection(routes[i].$2),
                      endpoint(routes[i].$3, TextAlign.center),
                    ], spacing: 6)
                  : Row(
                      children: [
                        Expanded(
                          child: endpoint(routes[i].$1, TextAlign.right),
                        ),
                        const SizedBox(width: 10),
                        SizedBox(width: 90, child: connection(routes[i].$2)),
                        const SizedBox(width: 10),
                        Expanded(child: endpoint(routes[i].$3, TextAlign.left)),
                      ],
                    ),
            ),
            if (i < routes.length - 1)
              ExcludeSemantics(
                child: Container(
                  width: 1,
                  height: 14,
                  color: colors.onSurface.withValues(alpha: .06),
                ),
              ),
          ],
        ],
      ),
    );

    Widget spec(String label, String value) => Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: secondary,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontFamily: appearance.font.codeFamily,
              fontSize: 11,
              color: colors.onSurface,
            ),
          ),
        ),
      ],
    );

    const commands = [
      'status',
      'commit',
      'push',
      'pull',
      'branches',
      'checkout',
      'createBranch',
      'log',
      'stash',
      'stashPop',
      'resetToRemote',
      'remoteUrl',
    ];
    Widget commandColumn(Iterable<String> names) => stack([
      for (final name in names)
        Text(
          'git/$name',
          style: TextStyle(
            fontFamily: appearance.font.codeFamily,
            fontSize: 10,
            color: secondary,
          ),
        ),
    ], spacing: 6);

    final sections = <Widget>[
      stack([
        heading('DJL', weight: FontWeight.bold),
        prose('Control **Codex** from your phone.'),
        callout(
          'central-imac',
          'The Codex runtime stays on your paired device. Your phone is a secure remote control connected through a relay.',
        ),
      ]),
      section('How It Works', [
        prose(
          'Your paired device runs a lightweight **bridge** that connects to a **relay server** over WebSocket.',
        ),
        bullets([
          'You send a prompt from your phone.',
          'It travels through the relay to the bridge on your paired device.',
          'The bridge forwards it to `codex app-server` via JSON-RPC.',
          'Responses stream back along the same path in real time.',
        ]),
        callout(
          'central-shield-check',
          'Workspace tools and file edits run on your paired device. The relay routes encrypted traffic; it does not run your workspace.',
        ),
      ]),
      section('Architecture', [architecture()]),
      section('The Relay', [
        prose(
          'A lightweight WebSocket server routes messages between your phone and paired device.',
        ),
        iconRow(
          DjlIcons.sync,
          "Handles session discovery so your phone finds the device's live session.",
        ),
        iconRow(
          DjlIcons.hiddenFill,
          'Never sees decrypted message contents after the handshake.',
        ),
        iconRow(
          DjlIcons.tag,
          'Observes connection metadata such as session IDs, device IDs, and timing.',
        ),
        const SizedBox(height: 4),
        prose(
          'You can **self-host** the relay or use the hosted endpoint configured by your bridge.',
        ),
      ]),
      section('Codex App-Server', [
        prose(
          'For the Codex runtime, the bridge connects to **`codex app-server`**, the JSON-RPC interface used by Codex clients.',
        ),
        bullets([
          'Phone conversations are first-class Codex sessions.',
          'Codex produces JSONL rollout files under `~/.codex/sessions/`.',
          "Use DJL's desktop handoff action to continue a phone thread on the paired device.",
        ]),
      ]),
      section('Pairing & Security', [
        prose(
          "On first connection, scan the bridge's **QR code**. It identifies the relay, session, paired device, and bridge identity public key.",
        ),
        prose('After the secure handshake:'),
        bullets([
          'Your phone saves the bridge as a **trusted device** in platform-backed secure storage.',
          "The bridge persists your phone's identity locally.",
          'Saved trusted devices can reconnect without scanning again.',
        ]),
        prose(
          'The QR remains a recovery path if trust changes or the current session cannot be resolved. A one-time code is another pairing option when the same relay is configured.',
        ),
      ]),
      section('End-to-End Encryption', [
        prose('After pairing, messages use encrypted envelopes.'),
        spec('Cipher', 'AES-256-GCM'),
        spec('Key derivation', 'HKDF-SHA256, per-direction keys'),
        spec('Key exchange', 'X25519 ephemeral keys'),
        spec('Identity', 'Ed25519 signatures'),
        spec('Replay protection', 'Monotonic counters'),
        spec('Phone cache key', 'Protected by platform-backed secure storage'),
        prose(
          'This describes **paired-device mode**. DJL Cloud is a separate service and account workflow.',
        ),
      ]),
      section('Git & Workspace', [
        prose('The bridge handles Git commands locally on the paired device:'),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: commandColumn(commands.take(6))),
            const SizedBox(width: 24),
            Expanded(child: commandColumn(commands.skip(6))),
          ],
        ),
        const SizedBox(height: 4),
        prose(
          'DJL also supports **workspace revert**: preview and apply reverse patches when you want to undo assistant changes. Review the confirmation before applying changes.',
        ),
      ]),
      section('Connection Resilience', [
        iconRow(DjlIcons.refresh, 'Automatic reconnect uses bounded backoff.'),
        iconRow(
          DjlIcons.mailCode,
          'Encrypted replay cursors help recover missed events. '
          'Uncertain actions are not silently resent after a disconnect.',
        ),
        iconRow(
          DjlIcons.chip,
          'The runtime can keep working through a transient phone connection drop.',
        ),
        iconRow(
          DjlIcons.power,
          'The bridge handles clean shutdown on `SIGINT` and `SIGTERM`.',
        ),
      ]),
      section('Desktop App Integration', [
        prose(
          'Codex persists phone threads as session rollout files on the paired device.',
        ),
        callout(
          'central-devices-2',
          'The desktop app may not live-reload external writes. Use **Continue on desktop** in DJL to hand off the current thread.',
        ),
      ]),
    ];

    final background = colors.brightness == Brightness.dark
        ? Colors.black
        : Colors.white;
    return Scaffold(
      backgroundColor: background,
      appBar: AppBar(
        toolbarHeight: 44,
        backgroundColor: background,
        surfaceTintColor: Colors.transparent,
        centerTitle: true,
        leadingWidth: 76,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Align(
            alignment: Alignment.centerLeft,
            child: SizedBox.square(
              dimension: 44,
              child: DjlGlassSurface(
                radius: 999,
                child: IconButton(
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  onPressed: () => Navigator.maybePop(context),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    fixedSize: const Size.square(44),
                    padding: EdgeInsets.zero,
                    shape: const CircleBorder(),
                  ),
                  icon: Icon(DjlIcons.back, size: 22, color: colors.onSurface),
                ),
              ),
            ),
          ),
        ),
        title: const Text(
          'About DJL',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        titleTextStyle: theme.textTheme.titleMedium?.copyWith(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 40),
          children: [
            for (var i = 0; i < sections.length; i++) ...[
              if (i > 0) ...[
                const SizedBox(height: 36),
                if (i > 1) ...[
                  Divider(
                    height: 1,
                    thickness: .5,
                    color: colors.onSurface.withValues(alpha: .06),
                  ),
                  const SizedBox(height: 36),
                ],
              ],
              sections[i],
            ],
            const SizedBox(height: 44),
            Center(
              child: TextButton.icon(
                onPressed: () => _open(context, _source),
                style: TextButton.styleFrom(
                  foregroundColor: secondary,
                  backgroundColor: surface(.5),
                  side: BorderSide(
                    color: colors.onSurface.withValues(alpha: .06),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                ),
                icon: SvgPicture.asset(
                  'assets/icons/command/GitHub_Invertocat_Black.svg',
                  width: 14,
                  height: 14,
                  colorFilter: ColorFilter.mode(secondary, BlendMode.srcIn),
                ),
                label: const Text(
                  'Open source',
                  style: TextStyle(fontSize: 11),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'MIT License',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: secondary),
            ),
          ],
        ),
      ),
    );
  }
}
