import '../../../core/network/cloud_client.dart';
import '../../chat/domain/cloud_models.dart';

class ImageRepository {
  const ImageRepository(this.client);
  final CloudClient client;
  Future<Json> page({String? cursor}) =>
      client.request('GET', 'v1/images', query: {'cursor': ?cursor});
}
