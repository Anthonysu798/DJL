# Upstream parity matrix

Pinned source: `5522ca01100a58572de3a652aebd7851f5fa648a`. 110 adapters: 31 dynamic, 42 article, 30 video, 7 podcast. Original SHA-256 hashes are in `packages/multipost/vendor/PROVENANCE.json`.

The table reports embedded public source and registered execution capability, not live platform certification. Automatic preparation is available for all adapters; unattended final submission additionally requires a verified identity, current authorization and successful preparation. Empty/manual upstream paths remain manual.

All 110 Chromium fixtures exercise actual adapter filling, refusal without host consent and authorized deferred/manual behavior. Fixture API/upload responses are controlled; they do not certify live platform servers.

| Adapter                 | Kind    | Platform       | Submission path    | Identity resolver                 | Native schedule | Source                                 |
| ----------------------- | ------- | -------------- | ------------------ | --------------------------------- | --------------- | -------------------------------------- |
| `DYNAMIC_BILIBILI`      | dynamic | bilibili       | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/bilibili.ts`      |
| `DYNAMIC_DOUYIN`        | dynamic | douyin         | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/douyin.ts`        |
| `DYNAMIC_X`             | dynamic | x              | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/x.ts`             |
| `DYNAMIC_REDNOTE`       | dynamic | rednote        | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/rednote.ts`       |
| `DYNAMIC_WEIBO`         | dynamic | weibo          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/weibo.ts`         |
| `DYNAMIC_XUEQIU`        | dynamic | xueqiu         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/xueqiu.ts`        |
| `DYNAMIC_ZHIHU`         | dynamic | zhihu          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/zhihu.ts`         |
| `DYNAMIC_INSTAGRAM`     | dynamic | instagram      | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/instagram.ts`     |
| `DYNAMIC_FACEBOOK`      | dynamic | facebook       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/facebook.ts`      |
| `DYNAMIC_LINKEDIN`      | dynamic | linkedin       | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/linkedin.ts`      |
| `DYNAMIC_OKJIKE`        | dynamic | okjike         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/okjike.ts`        |
| `DYNAMIC_REDDIT`        | dynamic | reddit         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/reddit.ts`        |
| `DYNAMIC_PINTEREST`     | dynamic | pinterest      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/pinterest.ts`     |
| `DYNAMIC_KUAISHOU`      | dynamic | kuaishou       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/kuaishou.ts`      |
| `DYNAMIC_SOHUTV`        | dynamic | sohu           | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/sohutv.ts`        |
| `DYNAMIC_BAIJIAHAO`     | dynamic | baijiahao      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/baijiahao.ts`     |
| `DYNAMIC_TOUTIAO`       | dynamic | toutiao        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/toutiao.ts`       |
| `DYNAMIC_THREADS`       | dynamic | threads        | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/threads.ts`       |
| `DYNAMIC_WEIXINCHANNEL` | dynamic | weixinchannel  | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/weixinchannel.ts` |
| `DYNAMIC_BLUESKY`       | dynamic | bluesky        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/bluesky.ts`       |
| `DYNAMIC_V2EX`          | dynamic | v2ex           | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/v2ex.ts`          |
| `DYNAMIC_DOUBAN`        | dynamic | douban         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/douban.ts`        |
| `DYNAMIC_DEDAO`         | dynamic | dedao          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/dedao.ts`         |
| `DYNAMIC_WEIXIN`        | dynamic | weixin         | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/dynamic/weixin.ts`        |
| `DYNAMIC_WEBHOOK`       | dynamic | webhook        | Host-gated         | Available; runtime check required | No              | `vendor/sync/dynamic/webhook.ts`       |
| `DYNAMIC_ZSXQ`          | dynamic | zsxq           | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/zsxq.ts`          |
| `DYNAMIC_XIAOHEIHE`     | dynamic | xiaoheihe      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/xiaoheihe.ts`     |
| `DYNAMIC_TOUTIAOHAO`    | dynamic | toutiaohao     | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/toutiaohao.ts`    |
| `DYNAMIC_SUBSTACK`      | dynamic | substack       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/substack.ts`      |
| `DYNAMIC_MAIMAI`        | dynamic | maimai         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/maimai.ts`        |
| `DYNAMIC_JUEJIN`        | dynamic | juejin         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/dynamic/juejin.ts`        |
| `ARTICLE_CNBLOGS`       | article | cnblogs        | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/cnblogs.ts`       |
| `ARTICLE_CSDN`          | article | csdn           | Host-gated         | Manual identity/final steps       | Yes             | `vendor/sync/article/csdn.ts`          |
| `ARTICLE_ZHIHU`         | article | zhihu          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/zhihu.ts`         |
| `ARTICLE_JUEJIN`        | article | juejin         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/juejin.ts`        |
| `ARTICLE_JIANSHU`       | article | jianshu        | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/jianshu.ts`       |
| `ARTICLE_SEGMENTFAULT`  | article | segmentfault   | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/segmentfault.ts`  |
| `ARTICLE_ALIYUN`        | article | aliyun         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/aliyun.ts`        |
| `ARTICLE_TENCENTYUN`    | article | tencentyun     | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/tencentyun.ts`    |
| `ARTICLE_VOLCENGINE`    | article | volcengine     | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/volcengine.ts`    |
| `ARTICLE_BAIJIAHAO`     | article | baijiahao      | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/baijiahao.ts`     |
| `ARTICLE_TOUTIAO`       | article | toutiao        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/toutiao.ts`       |
| `ARTICLE_QQ`            | article | qie            | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/qq.ts`            |
| `ARTICLE_DOUBAN`        | article | douban         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/douban.ts`        |
| `ARTICLE_WEIXIN`        | article | weixin         | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/weixin.ts`        |
| `ARTICLE_WORDPRESS`     | article | wordpress      | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/wordpress.ts`     |
| `ARTICLE_BILIBILI`      | article | bilibili       | Manual final steps | Available; runtime check required | No              | `vendor/sync/article/bilibili.ts`      |
| `ARTICLE_SSPAI`         | article | sspai          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/sspai.ts`         |
| `ARTICLE_51CTO`         | article | 51cto          | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/article/51cto.ts`         |
| `ARTICLE_XUEQIU`        | article | xueqiu         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/xueqiu.ts`        |
| `ARTICLE_WEIBO`         | article | weibo          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/weibo.ts`         |
| `ARTICLE_EASTMONEY`     | article | eastmoney      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/eastmoney.ts`     |
| `ARTICLE_SUBSTACK`      | article | substack       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/substack.ts`      |
| `ARTICLE_MEDIUM`        | article | medium         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/medium.ts`        |
| `ARTICLE_OSCHINA`       | article | oschina        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/oschina.ts`       |
| `ARTICLE_INFOQ`         | article | infoq          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/infoq.ts`         |
| `ARTICLE_SMZDM`         | article | smzdm          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/smzdm.ts`         |
| `ARTICLE_WOSHIPM`       | article | woshipm        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/woshipm.ts`       |
| `ARTICLE_GELONGHUI`     | article | gelonghui      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/gelonghui.ts`     |
| `ARTICLE_JIANKANGJIE`   | article | jiankangjie    | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/jiankangjie.ts`   |
| `ARTICLE_KAIDIWANG`     | article | kaidiwang      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/kaidiwang.ts`     |
| `ARTICLE_AUTOHOME`      | article | autohome       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/autohome.ts`      |
| `ARTICLE_JIANPIAN`      | article | jianpian       | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/jianpian.ts`      |
| `ARTICLE_TONGHUASHUN`   | article | tonghuashun    | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/tonghuashun.ts`   |
| `ARTICLE_DONGCHEDI`     | article | dongchedi      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/dongchedi.ts`     |
| `ARTICLE_ZSXQ`          | article | zsxq           | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/zsxq.ts`          |
| `ARTICLE_NETEASE`       | article | netease        | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/netease.ts`       |
| `ARTICLE_SOHU`          | article | sohu           | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/sohu.ts`          |
| `ARTICLE_DAYUHAO`       | article | dayu           | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/dayuhao.ts`       |
| `ARTICLE_DINGDUANHAO`   | article | dingduanhao    | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/dingduanhao.ts`   |
| `ARTICLE_KUAICHUANHAO`  | article | kuaichuanhao   | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/article/kuaichuanhao.ts`  |
| `ARTICLE_YIDIANZIXUN`   | article | yidian         | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/yidianzixun.ts`   |
| `ARTICLE_XARTICLE`      | article | x              | Host-gated         | Available; runtime check required | No              | `vendor/sync/article/xarticle.ts`      |
| `VIDEO_BILIBILI`        | video   | bilibili       | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/bilibili.ts`        |
| `VIDEO_DOUYIN`          | video   | douyin         | Host-gated         | Available; runtime check required | Yes             | `vendor/sync/video/douyin.ts`          |
| `VIDEO_YOUTUBE`         | video   | youtube        | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/youtube.ts`         |
| `VIDEO_REDNOTE`         | video   | rednote        | Host-gated         | Available; runtime check required | Yes             | `vendor/sync/video/rednote.ts`         |
| `VIDEO_TIKTOK`          | video   | tiktok         | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/tiktok.ts`          |
| `VIDEO_WEIXINCHANNEL`   | video   | weixinchannel  | Host-gated         | Manual identity/final steps       | Yes             | `vendor/sync/video/weixinchannel.ts`   |
| `VIDEO_KUAISHOU`        | video   | kuaishou       | Host-gated         | Manual identity/final steps       | Yes             | `vendor/sync/video/kuaishou.ts`        |
| `VIDEO_BAIJIAHAO`       | video   | baijiahao      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/baijiahao.ts`       |
| `VIDEO_WEIBO`           | video   | weibo          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/weibo.ts`           |
| `VIDEO_OKJIKE`          | video   | okjike         | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/okjike.ts`          |
| `VIDEO_BLUESKY`         | video   | bluesky        | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/bluesky.ts`         |
| `VIDEO_ZHIHU`           | video   | zhihu          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/zhihu.ts`           |
| `VIDEO_EASTMONEY`       | video   | eastmoney      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/eastmoney.ts`       |
| `VIDEO_XIAOHEIHE`       | video   | xiaoheihe      | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/xiaoheihe.ts`       |
| `VIDEO_TOUTIAOHAO`      | video   | toutiaohao     | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/toutiaohao.ts`      |
| `VIDEO_QIE`             | video   | qie            | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/qie.ts`             |
| `VIDEO_CHEJIAHAO`       | video   | chejiahao      | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/chejiahao.ts`       |
| `VIDEO_DEWU`            | video   | dewu           | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/dewu.ts`            |
| `VIDEO_YICHE`           | video   | yiche          | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/yiche.ts`           |
| `VIDEO_SOHU`            | video   | sohu           | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/sohu.ts`            |
| `VIDEO_SOHUTV`          | video   | sohu           | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/sohutv.ts`          |
| `VIDEO_NETEASE`         | video   | netease        | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/netease.ts`         |
| `VIDEO_DAYU`            | video   | dayu           | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/dayu.ts`            |
| `VIDEO_ALIPAY`          | video   | alipay         | Host-gated         | Available; runtime check required | No              | `vendor/sync/video/alipay.ts`          |
| `VIDEO_YIDIAN`          | video   | yidian         | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/yidian.ts`          |
| `VIDEO_PINDUODUO`       | video   | pinduoduo      | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/pinduoduo.ts`       |
| `VIDEO_VIVOVIDEO`       | video   | vivovideo      | Manual final steps | Available; runtime check required | No              | `vendor/sync/video/vivovideo.ts`       |
| `VIDEO_IQIYI`           | video   | iqiyi          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/iqiyi.ts`           |
| `VIDEO_YOUKU`           | video   | youku          | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/youku.ts`           |
| `VIDEO_TENCENTVIDEO`    | video   | tencentvideo   | Host-gated         | Manual identity/final steps       | No              | `vendor/sync/video/tencentvideo.ts`    |
| `PODCAST_QQMUSIC`       | podcast | qqmusic        | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/qqmusic.ts`       |
| `PODCAST_LIZHI`         | podcast | lizhi          | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/lizhi.ts`         |
| `PODCAST_XIMALAYA`      | podcast | ximalaya       | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/ximalaya.ts`      |
| `PODCAST_XIAOYUZHOU`    | podcast | xiaoyuzhou     | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/xiaoyuzhou.ts`    |
| `PODCAST_QINGTING`      | podcast | qingting       | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/qingting.ts`      |
| `PODCAST_NETEASE`       | podcast | neteasepodcast | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/netease.ts`       |
| `PODCAST_SPOTIFY`       | podcast | spotify        | Manual final steps | Manual identity/final steps       | No              | `vendor/sync/podcast/spotify.ts`       |

## Public feature mapping

| Public feature                                               | DJL implementation                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four content formats                                         | Shared DTOs; four workbench editors; MCP draft schemas                                                                                              |
| Original media, article HTML/Markdown, covers and Word files | Media ownership/import/preview plus original adapter uploads                                                                                        |
| Tags, categories, original/comment flags, series/collection  | Versioned content fields and platform options                                                                                                       |
| Per-platform content and custom injection destinations       | Per-target overrides/configuration; immutable snapshots                                                                                             |
| WordPress/custom destination and Webhook variants            | Account destination configuration; upstream WordPress adapter; native authenticated Webhook transport with original default/WeCom/DingTalk payloads |
| Jike topic selection                                         | Per-target selectedTopic configuration                                                                                                              |
| Native scheduling where source supports it                   | Explicit native schedule field, distinct acknowledgement and cancellation states                                                                    |
| Browser helpers and identity sources                         | Embedded document-start helpers, original identity resolvers and isolated persistent account partitions                                             |
| Extension runtime messages / remote publish entry            | Authenticated DJL local command API and four-format MCP tools; no private multipost.app API emulation                                               |
| Original extension UI                                        | Replaced with DJL workbench/chat review and bundled Skills                                                                                          |
| Proprietary upstream Agent / hosted backend                  | Not included in public snapshot; DJL implements its own local automation                                                                            |
