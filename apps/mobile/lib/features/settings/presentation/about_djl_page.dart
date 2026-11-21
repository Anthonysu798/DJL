import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/appearance.dart';
import 'settings_group.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

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
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(context.l10n.settingsLinkFailed)));
  }
}

class LocalAboutCard extends StatelessWidget {
  const LocalAboutCard({super.key});
  @override
  Widget build(BuildContext context) {
    Widget row(String title, IconData icon, VoidCallback action) =>
        SettingsLinkRow(title: title, leading: Icon(icon), onTap: action);
    final l10n = context.l10n;
    return SettingsGroup(
      title: l10n.settingsAbout,
      footer: l10n.settingsAboutFooter,
      children: [
        row(
          l10n.settingsHowDjlWorks,
          DjlIcons.info,
          () => Navigator.of(
            context,
          ).push(MaterialPageRoute<void>(builder: (_) => const AboutDjlPage())),
        ),
        row(
          l10n.settingsChatSupport,
          DjlIcons.globe,
          () => _open(context, _support),
        ),
        row(
          l10n.settingsPrivacyPolicy,
          DjlIcons.hand,
          () => _open(context, _privacy),
        ),
        row(
          l10n.settingsTermsOfUse,
          DjlIcons.document,
          () => _open(context, _terms),
        ),
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
    final l10n = context.l10n;
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
    final routes = [
      ('DJL Mobile', 'WebSocket', l10n.settingsAboutRouteBridgeDevice),
      (l10n.settingsAboutRouteBridge, 'JSON-RPC', 'codex app-server'),
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
              label: l10n.settingsAboutRouteLabel(
                routes[i].$1,
                routes[i].$3,
                routes[i].$2,
              ),
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
        prose(l10n.settingsAboutIntro),
        callout('central-imac', l10n.settingsAboutIntroNote),
      ]),
      section(l10n.settingsAboutHowItWorks, [
        prose(l10n.settingsAboutBridge),
        bullets([
          l10n.settingsAboutStep1,
          l10n.settingsAboutStep2,
          l10n.settingsAboutStep3,
          l10n.settingsAboutStep4,
        ]),
        callout('central-shield-check', l10n.settingsAboutWorkspaceNote),
      ]),
      section(l10n.settingsAboutArchitecture, [architecture()]),
      section(l10n.settingsAboutRelay, [
        prose(l10n.settingsAboutRelayIntro),
        iconRow(DjlIcons.sync, l10n.settingsAboutRelayDiscovery),
        iconRow(DjlIcons.hiddenFill, l10n.settingsAboutRelayPrivate),
        iconRow(DjlIcons.tag, l10n.settingsAboutRelayMetadata),
        const SizedBox(height: 4),
        prose(l10n.settingsAboutRelaySelfHost),
      ]),
      section('Codex App-Server', [
        prose(l10n.settingsAboutAppServerIntro),
        bullets([
          l10n.settingsAboutAppServerSessions,
          l10n.settingsAboutAppServerRollout,
          l10n.settingsAboutAppServerHandoff,
        ]),
      ]),
      section(l10n.settingsAboutPairing, [
        prose(l10n.settingsAboutPairingQr),
        prose(l10n.settingsAboutPairingAfter),
        bullets([
          l10n.settingsAboutPairingTrusted,
          l10n.settingsAboutPairingIdentity,
          l10n.settingsAboutPairingReconnect,
        ]),
        prose(l10n.settingsAboutPairingRecovery),
      ]),
      section(l10n.settingsAboutEncryption, [
        prose(l10n.settingsAboutEncryptionIntro),
        spec(l10n.settingsAboutCipher, 'AES-256-GCM'),
        spec(
          l10n.settingsAboutKeyDerivation,
          l10n.settingsAboutKeyDerivationValue,
        ),
        spec(l10n.settingsAboutKeyExchange, l10n.settingsAboutKeyExchangeValue),
        spec(l10n.settingsAboutIdentity, l10n.settingsAboutIdentityValue),
        spec(
          l10n.settingsAboutReplayProtection,
          l10n.settingsAboutReplayProtectionValue,
        ),
        spec(l10n.settingsAboutCacheKey, l10n.settingsAboutCacheKeyValue),
        prose(l10n.settingsAboutEncryptionNote),
      ]),
      section(l10n.settingsAboutGit, [
        prose(l10n.settingsAboutGitIntro),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: commandColumn(commands.take(6))),
            const SizedBox(width: 24),
            Expanded(child: commandColumn(commands.skip(6))),
          ],
        ),
        const SizedBox(height: 4),
        prose(l10n.settingsAboutGitRevert),
      ]),
      section(l10n.settingsAboutResilience, [
        iconRow(DjlIcons.refresh, l10n.settingsAboutReconnect),
        iconRow(DjlIcons.mailCode, l10n.settingsAboutReplay),
        iconRow(DjlIcons.chip, l10n.settingsAboutRuntimeDrop),
        iconRow(DjlIcons.power, l10n.settingsAboutShutdown),
      ]),
      section(l10n.settingsAboutDesktop, [
        prose(l10n.settingsAboutDesktopRollout),
        callout('central-devices-2', l10n.settingsAboutDesktopHandoff),
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
        title: Text(
          l10n.settingsAboutDjl,
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
                label: Text(
                  l10n.settingsOpenSource,
                  style: const TextStyle(fontSize: 11),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              l10n.settingsMitLicense,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: secondary),
            ),
          ],
        ),
      ),
    );
  }
}
