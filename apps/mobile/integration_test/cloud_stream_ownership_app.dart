// Native execution of production stream ownership using volatile HTTP responses.
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:flutter/material.dart';
import 'support/cloud_stream_revocation_fixture.dart';

void main() => runApp(
  MaterialApp(
    theme: djlTheme(Brightness.light),
    home: const StreamOwnershipProbe(),
  ),
);

class StreamOwnershipProbe extends StatefulWidget {
  const StreamOwnershipProbe({super.key});
  @override
  State<StreamOwnershipProbe> createState() => _StreamOwnershipProbeState();
}

class _StreamOwnershipProbeState extends State<StreamOwnershipProbe> {
  String status = 'Ready';
  bool started = false;
  Future<void> check() async {
    setState(() {
      started = true;
      status = 'Checking stream ownership';
    });
    try {
      for (final body in [false, true]) {
        for (final replace in [true, false]) {
          final result = await lateRevocation(
            delayedBody: body,
            replaceAccount: replace,
          );
          if (result.session != (replace ? 'replacement' : 'old') ||
              result.ended != 0 ||
              result.result is! List ||
              (result.result as List).isNotEmpty) {
            throw StateError(
              'Stale ${body ? 'body' : 'headers'} changed ${replace ? 'account' : 'cancelled session'}',
            );
          }
        }
      }
      for (final path in ['exchange', 'request', 'stream', 'push']) {
        final result = await revocationDuringWrite(path);
        if (result.session != 'replacement' ||
            result.pairing != 'retained-pairing' ||
            result.ended != 0) {
          throw StateError('Late $path revocation ended a replacement account');
        }
        if (path == 'stream' &&
            (result.result is! List || (result.result as List).isNotEmpty)) {
          throw StateError('Superseded stream did not finish quietly');
        }
      }
      for (final stage in [
        'read-old',
        'read-new',
        'prepared-request',
        'prepared-stream',
        'write-in',
        'write-out',
      ]) {
        final result = await requestDuringPreparation(stage);
        final failure = result.result;
        if (result.dispatches != 0 ||
            result.ended != 0 ||
            result.session != (stage == 'write-out' ? null : 'replacement')) {
          throw StateError('Superseded $stage request escaped');
        }
        if (stage == 'write-in') {
          if (failure != 'jwt-replacement' ||
              result.minted.join(',') != 'replacement') {
            throw StateError('Pending sign-in used an old credential');
          }
        } else if (stage == 'prepared-stream') {
          if (failure is! List || failure.isNotEmpty) {
            throw StateError('Old stream did not stop');
          }
        } else if (failure is! CloudFailure ||
            failure.code !=
                (stage == 'write-out' ? 'no_session' : 'session_changed')) {
          throw StateError('Wrong preparation failure');
        }
      }
      if (mounted) {
        setState(() => status = 'All fourteen session ownership checks passed');
      }
    } catch (error) {
      if (mounted) {
        setState(() => status = 'Stream ownership check failed: $error');
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('DJL stream lifecycle QA')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(status),
          ElevatedButton(
            onPressed: started ? null : check,
            child: const Text('Run stream ownership checks'),
          ),
          const Text(
            'Volatile credentials and HTTP responses only. No real account or saved pairing is used.',
          ),
        ],
      ),
    ),
  );
}
