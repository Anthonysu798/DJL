import UIKit
import ImageIO

@MainActor final class CloudImageCache {
    let costLimit = 20 * 1024 * 1024
    private let cache = NSCache<NSString, UIImage>()
    init() { cache.totalCostLimit = costLimit }
    func image(fileID: String) -> UIImage? { cache.object(forKey: fileID as NSString) }
    func store(_ image: UIImage, fileID: String) {
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        guard cost <= costLimit else { return }
        cache.setObject(image, forKey: fileID as NSString, cost: cost)
    }
    func clear() { cache.removeAllObjects() }
    static func decode(_ data: Data) -> UIImage? {
        guard data.count <= 16 * 1024 * 1024, let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
