import '../../../core/network/cloud_client.dart';
import '../../chat/domain/cloud_models.dart';

class NotificationRepository {
  const NotificationRepository(this.client);
  final CloudClient client;
  Future<Json> page({String? cursor}) =>
      client.request('GET', 'v1/notifications', query: {'cursor': ?cursor});
  Future<int> markRead(List<String> ids) async =>
      (await client.request(
            'POST',
            'v1/notifications/read',
            body: {'ids': ids},
          ))['unreadCount']
          as int;
}
