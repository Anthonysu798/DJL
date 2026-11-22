import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'auth_controller.dart';
import 'auth_method_selector.dart';
import 'auth_form_rules.dart';
import 'auth_form_widgets.dart';
import '../../../l10n/l10n.dart';

enum AuthMethod { password, code, create }

class AuthPage extends StatefulWidget {
  const AuthPage({super.key, required this.controller});
  final AuthController controller;
  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _email = TextEditingController(),
      _password = TextEditingController(),
      _name = TextEditingController(),
      _code = TextEditingController();
  final _emailFocus = FocusNode(), _codeFocus = FocusNode();
  AuthMethod _method = AuthMethod.code;
  String? _sentTo, _error;
  bool _busy = false;
  int _revision = 0, _remaining = 0;
  Timer? _cooldown;
  bool get _working => _busy || widget.controller.busy;
  String get _normalizedEmail => AuthFormRules.normalizedEmail(_email.text);
  bool get _canSubmit =>
      !_working &&
      (_sentTo != null
          ? AuthFormRules.validCode(_code.text)
          : AuthFormRules.validEmail(_email.text) &&
                switch (_method) {
                  AuthMethod.code => true,
                  AuthMethod.password => _password.text.isNotEmpty,
                  AuthMethod.create =>
                    _name.text.trim().isNotEmpty &&
                        AuthFormRules.validPassword(_password.text),
                });
  String get _primary => _sentTo != null
      ? context.l10n.authVerifyAndContinue
      : switch (_method) {
          AuthMethod.password => context.l10n.authSignIn,
          AuthMethod.code => context.l10n.authEmailMeCode,
          AuthMethod.create => context.l10n.authCreateAccount,
        };
  @override
  void initState() {
    super.initState();
    for (final field in [_email, _password, _name, _code]) {
      field.addListener(_edited);
    }
  }

  void _edited() {
    _revision++;
    if (mounted) setState(() {});
  }

  void _startCooldown() {
    _cooldown?.cancel();
    _remaining = 60;
    _cooldown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _remaining = math.max(0, 60 - timer.tick));
      if (_remaining == 0) timer.cancel();
    });
  }

  void _methodChanged(AuthMethod? value) {
    if (value == null || _working || value == _method) return;
    _revision++;
    _cooldown?.cancel();
    _code.clear();
    setState(() {
      _method = value;
      _sentTo = null;
      _error = null;
      _remaining = 0;
    });
    _emailFocus.requestFocus();
  }

  void _anotherEmail() {
    if (_working) return;
    _revision++;
    _cooldown?.cancel();
    _code.clear();
    setState(() {
      _sentTo = null;
      _error = null;
      _remaining = 0;
    });
    _emailFocus.requestFocus();
  }

  Future<void> _submit({bool resend = false}) async {
    if (_working ||
        (!resend && !_canSubmit) ||
        resend && (_sentTo == null || _remaining != 0)) {
      return;
    }
    final auth = widget.controller,
        method = _method,
        sentTo = _sentTo,
        email = _sentTo ?? _normalizedEmail;
    final codeRequest = resend || method == AuthMethod.code && sentTo == null;
    final (route, body) = codeRequest
        ? (
            'email-otp/send-verification-otp',
            <String, dynamic>{
              'email': email,
              'type': method == AuthMethod.create
                  ? 'email-verification'
                  : 'sign-in',
            },
          )
        : switch (method) {
            AuthMethod.password => (
              'sign-in/email',
              <String, dynamic>{'email': email, 'password': _password.text},
            ),
            AuthMethod.code => (
              'sign-in/email-otp',
              <String, dynamic>{'email': email, 'otp': _code.text},
            ),
            AuthMethod.create when sentTo == null => (
              'sign-up/email',
              <String, dynamic>{
                'name': _name.text.trim(),
                'email': email,
                'password': _password.text,
              },
            ),
            AuthMethod.create => (
              'email-otp/verify-email',
              <String, dynamic>{'email': email, 'otp': _code.text},
            ),
          };
    final revision = _revision;
    bool current() =>
        mounted &&
        revision == _revision &&
        ModalRoute.of(context)?.isCurrent == true;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await auth.submit(
        route,
        body,
        requiresToken: !codeRequest,
        formIsCurrent: current,
      );
      if (!mounted || !current()) return;
      if (auth.signedIn) {
        Navigator.pop(context);
        return;
      }
      if (auth.error != null) {
        setState(() => _error = auth.error);
      } else if (codeRequest && result ||
          method == AuthMethod.create &&
              sentTo == null &&
              auth.notice != null) {
        _code.clear();
        setState(() {
          _sentTo = email;
          _startCooldown();
        });
        _codeFocus.requestFocus();
      } else if (!result) {
        setState(() => _error = context.l10n.authSignInIncomplete);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _recover() async {
    if (_working) return;
    _revision++;
    final email = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        builder: (_) => PasswordRecoveryPage(
          controller: widget.controller,
          email: _normalizedEmail,
        ),
      ),
    );
    if (!mounted || email == null) return;
    _email.text = email;
    _password.clear();
    _code.clear();
    _cooldown?.cancel();
    setState(() {
      _method = AuthMethod.password;
      _sentTo = null;
      _remaining = 0;
      _error = null;
    });
  }

  Widget _methods(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final style = TextStyle(
        fontFamily: Theme.of(context).textTheme.bodyMedium?.fontFamily,
        fontSize: 13,
      );
      final labels = {
        AuthMethod.password: context.l10n.authPassword,
        AuthMethod.code: context.l10n.authEmailCode,
        AuthMethod.create: context.l10n.authCreateAccount,
      };
      final painter = TextPainter(
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      );
      var widest = 0.0;
      for (final label in labels.values) {
        painter.text = TextSpan(
          text: label,
          style: style.copyWith(fontWeight: FontWeight.w600),
        );
        painter.layout();
        widest = math.max(widest, painter.width);
      }
      painter.dispose();
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          // Include the capsule track's two-pixel inset on each side.
          width: math.max(constraints.maxWidth, (widest + 20) * 3 + 4),
          child: AuthMethodSelector<AuthMethod>(
            value: _method,
            onChanged: _working ? null : _methodChanged,
            children: {
              for (final item in labels.entries)
                item.key: Text(
                  item.value,
                  style: style.copyWith(
                    fontWeight: item.key == _method
                        ? FontWeight.w600
                        : FontWeight.w400,
                  ),
                ),
            },
          ),
        ),
      );
    },
  );
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) => AuthFormScaffold(
      title: context.l10n.authContinueWithEmail,
      children: [
        _methods(context),
        const SizedBox(height: 44),
        AutofillGroup(
          child: AuthFieldGroup(
            children: [
              if (_method == AuthMethod.create && _sentTo == null)
                authTextField(
                  fieldKey: const Key('name'),
                  controller: _name,
                  placeholder: context.l10n.authName,
                  enabled: !_working,
                  autofillHints: const [AutofillHints.name],
                ),
              authTextField(
                fieldKey: const Key('email'),
                controller: _email,
                placeholder: context.l10n.authEmail,
                focusNode: _emailFocus,
                autofocus: true,
                enabled: !_working && _sentTo == null,
                keyboard: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
              ),
              if (_method != AuthMethod.code && _sentTo == null)
                authTextField(
                  fieldKey: const Key('password'),
                  controller: _password,
                  placeholder: context.l10n.authPassword,
                  enabled: !_working,
                  password: true,
                  autofillHints: [
                    _method == AuthMethod.password
                        ? AutofillHints.password
                        : AutofillHints.newPassword,
                  ],
                ),
              if (_sentTo != null)
                authTextField(
                  fieldKey: const Key('code'),
                  controller: _code,
                  placeholder: context.l10n.authSixDigitCode,
                  focusNode: _codeFocus,
                  enabled: !_working,
                  keyboard: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                ),
            ],
          ),
        ),
        if (_error != null)
          AuthFormFooter(_error!, error: true)
        else if (_sentTo != null)
          AuthFormFooter(context.l10n.authCodeSent(_sentTo!))
        else if (_method == AuthMethod.create)
          AuthFormFooter(context.l10n.authCreateAccountHint),
        const SizedBox(height: 36),
        AuthFieldGroup(
          children: [
            AuthFormButton(
              buttonKey: const Key('auth_primary'),
              title: _primary,
              busy: _busy,
              onPressed: _canSubmit ? () => _submit() : null,
            ),
            if (_sentTo != null) ...[
              AuthFormButton(
                title: _remaining == 0
                    ? context.l10n.authResendCode
                    : context.l10n.authResendIn(_remaining),
                onPressed: !_working && _remaining == 0
                    ? () => _submit(resend: true)
                    : null,
              ),
              AuthFormButton(
                title: context.l10n.authUseAnotherEmail,
                onPressed: !_working ? _anotherEmail : null,
              ),
            ] else if (_method == AuthMethod.password)
              AuthFormButton(
                title: context.l10n.authForgotPassword,
                onPressed: !_working ? _recover : null,
              ),
          ],
        ),
      ],
    ),
  );
  @override
  void dispose() {
    _revision++;
    _cooldown?.cancel();
    for (final field in [_email, _password, _name, _code]) {
      field.removeListener(_edited);
      field.dispose();
    }
    _emailFocus.dispose();
    _codeFocus.dispose();
    super.dispose();
  }
}

class PasswordRecoveryPage extends StatefulWidget {
  const PasswordRecoveryPage({
    super.key,
    required this.controller,
    required this.email,
  });
  final AuthController controller;
  final String email;
  @override
  State<PasswordRecoveryPage> createState() => _PasswordRecoveryPageState();
}

class _PasswordRecoveryPageState extends State<PasswordRecoveryPage> {
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController(), _password = TextEditingController();
  bool _busy = false, _completed = false;
  String? _sentTo, _error;
  int _revision = 0, _remaining = 0;
  Timer? _cooldown;
  bool get _working => _busy || widget.controller.busy;
  bool get _valid =>
      !_working &&
      AuthFormRules.validEmail(_email.text) &&
      (_sentTo == null ||
          AuthFormRules.validCode(_code.text) &&
              AuthFormRules.validPassword(_password.text));
  @override
  void initState() {
    super.initState();
    for (final field in [_email, _code, _password]) {
      field.addListener(_edited);
    }
  }

  void _edited() {
    _revision++;
    if (mounted) setState(() {});
  }

  void _startCooldown() {
    _cooldown?.cancel();
    _remaining = 60;
    _cooldown = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _remaining = math.max(0, 60 - timer.tick));
      if (_remaining == 0) timer.cancel();
    });
  }

  Future<void> _submit({bool resend = false}) async {
    if (_working ||
        (!_valid && !resend) ||
        resend && (_sentTo == null || _remaining != 0)) {
      return;
    }
    final requestCode = _sentTo == null || resend,
        email = _sentTo ?? AuthFormRules.normalizedEmail(_email.text),
        revision = _revision;
    bool current() =>
        mounted &&
        revision == _revision &&
        ModalRoute.of(context)?.isCurrent == true;
    final body = <String, dynamic>{
      'email': email,
      if (!requestCode) 'otp': _code.text,
      if (!requestCode) 'password': _password.text,
    };
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.controller.submit(
        requestCode
            ? 'email-otp/request-password-reset'
            : 'email-otp/reset-password',
        body,
        requiresToken: false,
        formIsCurrent: current,
      );
      if (!mounted || !current()) return;
      if (!result || widget.controller.error != null) {
        setState(() => _error = widget.controller.error);
        return;
      }
      _code.clear();
      setState(() {
        if (requestCode) {
          _sentTo = email;
          _startCooldown();
        } else {
          _password.clear();
          _completed = true;
          _cooldown?.cancel();
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _anotherEmail() {
    if (_working) return;
    _revision++;
    _cooldown?.cancel();
    _code.clear();
    _password.clear();
    setState(() {
      _sentTo = null;
      _error = null;
      _remaining = 0;
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) => AuthFormScaffold(
      title: context.l10n.authResetPassword,
      children: [
        if (_completed)
          AuthFieldGroup(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(context.l10n.authPasswordUpdated),
                    const SizedBox(height: 8),
                    Text(context.l10n.authSignInWithNewPassword),
                  ],
                ),
              ),
              AuthFormButton(
                title: context.l10n.authBackToSignIn,
                onPressed: () => Navigator.pop(context, _sentTo),
              ),
            ],
          )
        else ...[
          AutofillGroup(
            child: AuthFieldGroup(
              children: [
                authTextField(
                  fieldKey: const Key('email'),
                  controller: _email,
                  placeholder: context.l10n.authEmail,
                  enabled: !_working && _sentTo == null,
                  keyboard: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                ),
                if (_sentTo != null) ...[
                  authTextField(
                    fieldKey: const Key('code'),
                    controller: _code,
                    placeholder: context.l10n.authSixDigitCode,
                    enabled: !_working,
                    keyboard: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ],
                  ),
                  authTextField(
                    fieldKey: const Key('password'),
                    controller: _password,
                    placeholder: context.l10n.authNewPassword,
                    enabled: !_working,
                    password: true,
                    autofillHints: const [AutofillHints.newPassword],
                  ),
                ],
              ],
            ),
          ),
          AuthFormFooter(
            _sentTo == null
                ? context.l10n.authRecoveryHint
                : context.l10n.authRecoveryCodeHint,
          ),
          const SizedBox(height: 36),
          AuthFieldGroup(
            children: [
              AuthFormButton(
                buttonKey: const Key('auth_primary'),
                title: _sentTo == null
                    ? context.l10n.authSendRecoveryCode
                    : context.l10n.authResetPassword,
                busy: _busy,
                onPressed: _valid ? () => _submit() : null,
              ),
              if (_sentTo != null) ...[
                AuthFormButton(
                  title: _remaining == 0
                      ? context.l10n.authResendCode
                      : context.l10n.authResendIn(_remaining),
                  onPressed: !_working && _remaining == 0
                      ? () => _submit(resend: true)
                      : null,
                ),
                AuthFormButton(
                  title: context.l10n.authUseAnotherEmail,
                  onPressed: !_working ? _anotherEmail : null,
                ),
              ],
            ],
          ),
          if (_error != null) AuthFormFooter(_error!, error: true),
        ],
      ],
    ),
  );
  @override
  void dispose() {
    _revision++;
    _cooldown?.cancel();
    for (final field in [_email, _code, _password]) {
      field.removeListener(_edited);
      field.dispose();
    }
    super.dispose();
  }
}
