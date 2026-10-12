import XCTest
import UIKit
@testable import DJL

final class CloudImageGenerationTests: XCTestCase {
    @MainActor func testRetryPreservesImageIdentityAndGalleryStaysAccountScoped() async throws {
        let me=try CloudFixtures.string("me"),models=try CloudFixtures.string("models"),reply=try CloudFixtures.string("send-message"),conversation=try CloudFixtures.string("conversation")
        var requests=0
        CloudStubURLProtocol.install { request,_ in
            switch request.url?.path {
            case "/v1/me": return .json(200,me)
            case "/v1/models":return .json(200,models)
            case "/v1/client-config":return .json(200,try! CloudFixtures.string("client-config"))
            case "/v1/conversations":return .json(200,request.httpMethod=="POST" ? conversation : #"{"conversations":[],"nextCursor":null}"#)
            case "/v1/conversations/conv_1/images": requests+=1;return requests==1 ? .json(503,#"{"error":{"code":"unavailable","message":"Retry","traceId":"test"}}"#) : .json(200,reply)
            case "/v1/images":return .json(200,try! CloudFixtures.string("images"))
            default:return .json(200,"{}")
            }
        }
        let cloud=CloudService(configuration:CloudAPIConfiguration(baseURL:URL(string:"https://test.invalid")!),sessionStore:CloudMemorySessionStore(token:"session"),urlSession:CloudStubURLProtocol.session(),tokenProvider:CloudCountingTokenProvider(tokens:["jwt"]),draftStore:CloudDraftStore(defaults:UserDefaults(suiteName:"image-qa-\(UUID())")!))
        await cloud.refreshAll();await cloud.refreshClientConfig()
        let session=CloudChatSession(cloud:cloud,conversation:nil)
        let failed=await session.generateImage(prompt:"A desk",aspectRatio:"1:1");XCTAssertFalse(failed)
        let accepted=await session.generateImage(prompt:"A desk",aspectRatio:"1:1");XCTAssertTrue(accepted)
        session.suspendStreaming()
        let bodies=try CloudStubURLProtocol.requests.filter{$0.request.url?.path=="/v1/conversations/conv_1/images"}.map{try JSONDecoder().decode(CloudCreateImageInput.self,from:XCTUnwrap($0.body))}
        XCTAssertEqual(bodies.count,2);XCTAssertEqual(bodies[0].clientMessageId,bodies[1].clientMessageId)
        let gallery=cloud.gallery
        await gallery.refresh();await gallery.refresh()
        XCTAssertEqual(gallery.images.count,1)
        cloud.handle(CloudAPIError.unauthorized)
        XCTAssertTrue(gallery.images.isEmpty)
        let unavailable=await session.generateImage(prompt:"A desk",aspectRatio:"1:1");XCTAssertFalse(unavailable)
    }
    @MainActor func testImageCacheIsBoundedAndClearsOnSignOut() {
        let cache=CloudImageCache()
        let image=UIGraphicsImageRenderer(size:CGSize(width:10,height:10)).image{_ in UIColor.blue.setFill();UIRectFill(CGRect(x:0,y:0,width:10,height:10))}
        cache.store(image,fileID:"selected")
        XCTAssertNotNil(cache.image(fileID:"selected"))
        cache.clear();XCTAssertNil(cache.image(fileID:"selected"))
        XCTAssertEqual(cache.costLimit,20*1024*1024)
    }
}
