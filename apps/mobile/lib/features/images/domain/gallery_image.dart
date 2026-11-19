import '../../chat/domain/cloud_models.dart';

class GalleryImage {
  const GalleryImage({
    required this.fileId,
    required this.conversationId,
    required this.prompt,
    required this.mimeType,
    required this.width,
    required this.height,
  });
  final String fileId, conversationId, prompt, mimeType;
  final num? width, height;
  Json get part => {
    'type': 'image_ref',
    'fileId': fileId,
    'mimeType': mimeType,
    'width': width,
    'height': height,
  };
  factory GalleryImage.fromJson(Json value) => GalleryImage(
    fileId: value['fileId'] as String,
    conversationId: value['conversationId'] as String,
    prompt: value['prompt'] as String,
    mimeType: value['mimeType'] as String,
    width: value['width'] as num?,
    height: value['height'] as num?,
  );
}
