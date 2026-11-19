import '../../../core/network/cloud_client.dart';
import '../domain/account_snapshot.dart';

class AccountRepository {
  const AccountRepository(this.client);
  final CloudClient client;
  Future<AccountSnapshot> load() async {
    final values = await Future.wait([
      client.request('GET', 'v1/me'),
      client.request('GET', 'v1/credits'),
      client.request('GET', 'v1/usage/windows'),
    ]);
    return AccountSnapshot.fromJson(values[0], values[1], values[2]);
  }

  Future<void> redeem(String idempotencyKey) async {
    await client.request(
      'POST',
      'v1/usage/resets/redeem',
      body: {'idempotencyKey': idempotencyKey},
    );
  }

  Future<void> delete() async {
    await client.request('DELETE', 'v1/me');
  }
}
