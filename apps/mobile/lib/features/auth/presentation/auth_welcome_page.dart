import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../data/social_identity.dart';
import 'auth_controller.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

class AuthWelcomePage extends StatefulWidget {
  const AuthWelcomePage({
    super.key,
    required this.controller,
    required this.onEmail,
    required this.onPair,
  });
  final AuthController controller;
  final VoidCallback onEmail, onPair;
  @override
  State<AuthWelcomePage> createState() => _AuthWelcomePageState();
}

class _AuthWelcomePageState extends State<AuthWelcomePage> {
  SocialProvider? _pending;
  Future<void> _social(SocialProvider provider) async {
    setState(() => _pending = provider);
    try {
      await widget.controller.signInWithSocial(provider);
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  Future<void> _policy(Uri uri) async {
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      /* A policy link failure stays recoverable on this screen. */
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open this link. Try again.')),
      );
    }
  }

  Widget _action({
    required String title,
    required IconData icon,
    required VoidCallback? onPressed,
    bool busy = false,
    bool apple = false,
  }) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final foreground = apple
        ? (dark ? Colors.black : Colors.white)
        : Theme.of(context).colorScheme.onSurface;
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        splashFactory: NoSplash.splashFactory,
        animationDuration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : kThemeChangeDuration,
        backgroundColor: apple
            ? (dark ? Colors.white : Colors.black)
            : DjlColors.of(context).surfaceRaised,
        disabledBackgroundColor: DjlColors.of(context).surfaceRaised,
        foregroundColor: foreground,
        disabledForegroundColor: DjlColors.of(context).inkMuted,
        minimumSize: const Size(double.infinity, 52),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        shape: const StadiumBorder(),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        textStyle: Theme.of(context).textTheme.labelLarge?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (busy)
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: foreground,
              ),
            )
          else
            Icon(icon, size: 16),
          const SizedBox(width: 10),
          Flexible(child: Text(title, textAlign: TextAlign.center)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final auth = widget.controller,
          secondary = DjlColors.of(context).inkMuted;
      return Scaffold(
        body: SafeArea(
          child: CustomScrollView(
            slivers: [
              SliverFillRemaining(
                hasScrollBody: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Spacer(),
                      const SizedBox(height: 24),
                      Column(
                        children: [
                          SizedBox.square(
                            dimension: 76,
                            child: Stack(
                              clipBehavior: Clip.none,
                              children: [
                                Transform.translate(
                                  offset: const Offset(0, 6),
                                  child: ImageFiltered(
                                    imageFilter: ui.ImageFilter.blur(
                                      sigmaX: 12,
                                      sigmaY: 12,
                                    ),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(19),
                                      child: Image.asset(
                                        'assets/djl-logo.png',
                                        width: 76,
                                        height: 76,
                                        color: Colors.black.withValues(
                                          alpha: .12,
                                        ),
                                        colorBlendMode: BlendMode.srcIn,
                                        excludeFromSemantics: true,
                                      ),
                                    ),
                                  ),
                                ),
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(19),
                                  child: Image.asset(
                                    'assets/djl-logo.png',
                                    width: 76,
                                    height: 76,
                                    semanticLabel: 'DJL',
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 18),
                          Text(
                            'Welcome to DJL',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.headlineLarge
                                ?.copyWith(
                                  fontSize: 30,
                                  fontWeight: FontWeight.w700,
                                  height: 1.2,
                                  letterSpacing: 0,
                                ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Your ideas, conversations, and Mac.\nTogether in DJL.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 15,
                              height: 1.2,
                              color: secondary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      const Spacer(),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (auth.error != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Text(
                                auth.error!,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: DjlColors.of(context).danger,
                                ),
                              ),
                            ),
                          if (auth.socialConfigurationError != null) ...[
                            Text(
                              auth.socialConfigurationError!,
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 12, color: secondary),
                            ),
                            TextButton(
                              onPressed: auth.socialLoading || auth.busy
                                  ? null
                                  : auth.loadSocialProviders,
                              child: const Text('Retry sign-in options'),
                            ),
                            const SizedBox(height: 12),
                          ],
                          if (auth.socialLoading) ...[
                            Semantics(
                              label: 'Loading sign-in options',
                              child: const Center(
                                child: SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                          ],
                          for (final provider in SocialProvider.values)
                            if (auth.socialProviders.contains(provider)) ...[
                              _action(
                                title: provider == SocialProvider.apple
                                    ? 'Continue with Apple'
                                    : 'Continue with Google',
                                icon: provider == SocialProvider.apple
                                    ? DjlIcons.apple
                                    : DjlIcons.google,
                                apple: provider == SocialProvider.apple,
                                busy: auth.busy && _pending == provider,
                                onPressed: auth.busy
                                    ? null
                                    : () => _social(provider),
                              ),
                              const SizedBox(height: 12),
                            ],
                          _action(
                            title: 'Continue with email',
                            icon: DjlIcons.mail,
                            onPressed: auth.busy ? null : widget.onEmail,
                          ),
                          const SizedBox(height: 12),
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: TextButton(
                              onPressed: widget.onPair,
                              style: TextButton.styleFrom(
                                foregroundColor: secondary,
                                minimumSize: const Size(double.infinity, 44),
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                textStyle: Theme.of(context)
                                    .textTheme
                                    .labelLarge
                                    ?.copyWith(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      height: 1.2,
                                    ),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(DjlIcons.laptop, size: 16),
                                  const SizedBox(width: 8),
                                  Flexible(
                                    child: Text(
                                      'Pair with a Mac',
                                      textAlign: TextAlign.center,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            alignment: WrapAlignment.center,
                            spacing: 16,
                            runSpacing: 8,
                            children: [
                              for (final policy in auth.policyUrls.entries)
                                TextButton(
                                  onPressed: auth.busy
                                      ? null
                                      : () => _policy(policy.value),
                                  style: TextButton.styleFrom(
                                    foregroundColor: secondary,
                                    padding: EdgeInsets.zero,
                                    minimumSize: Size.zero,
                                    tapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                    textStyle: Theme.of(context)
                                        .textTheme
                                        .labelLarge
                                        ?.copyWith(fontSize: 11),
                                  ),
                                  child: Text(
                                    policy.key == 'terms' ? 'Terms' : 'Privacy',
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
            ],
          ),
        ),
      );
    },
  );
}
