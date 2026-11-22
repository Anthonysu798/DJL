import {
  IconBrandBilibili,
  IconBrandBluesky,
  IconBrandDouban,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandMedium,
  IconBrandPinterest,
  IconBrandReddit,
  IconBrandThreads,
  IconBrandTiktok,
  IconBrandWechat,
  IconBrandWeibo,
  IconBrandWordpress,
  IconBrandX,
  IconBrandYoutube,
  IconBrandZhihu,
  IconWebhook,
} from "@tabler/icons-react";
import { useState } from "react";
import { resolveSiteFaviconUrl, siteFaviconStatusCache } from "~/lib/siteFavicon";

const icons: Record<string, typeof IconBrandX> = {
  bilibili: IconBrandBilibili,
  bluesky: IconBrandBluesky,
  douban: IconBrandDouban,
  douyin: IconBrandTiktok,
  facebook: IconBrandFacebook,
  instagram: IconBrandInstagram,
  linkedin: IconBrandLinkedin,
  medium: IconBrandMedium,
  pinterest: IconBrandPinterest,
  reddit: IconBrandReddit,
  threads: IconBrandThreads,
  tiktok: IconBrandTiktok,
  weixin: IconBrandWechat,
  weixinchannel: IconBrandWechat,
  weibo: IconBrandWeibo,
  wordpress: IconBrandWordpress,
  x: IconBrandX,
  youtube: IconBrandYoutube,
  zhihu: IconBrandZhihu,
  webhook: IconWebhook,
};

/**
 * Where each platform's real logo comes from: its own website, read through DJL's site-icon
 * route. A few creator studios show another company's logo (YouTube Studio shows Google's),
 * so those point at the main site. SegmentFault, Kaidiwang and Dingduanhao publish no icon
 * the lookup can reach, and a webhook is not a brand; they keep a drawn mark.
 */
export const PLATFORM_LOGO_SITES: Record<string, string> = {
  bilibili: "t.bilibili.com",
  douyin: "creator.douyin.com",
  x: "x.com",
  rednote: "www.xiaohongshu.com",
  weibo: "weibo.com",
  xueqiu: "xueqiu.com",
  zhihu: "www.zhihu.com",
  instagram: "www.instagram.com",
  facebook: "www.facebook.com",
  linkedin: "www.linkedin.com",
  okjike: "web.okjike.com",
  reddit: "www.reddit.com",
  pinterest: "www.pinterest.com",
  kuaishou: "cp.kuaishou.com",
  sohu: "tv.sohu.com",
  baijiahao: "baijiahao.baidu.com",
  toutiao: "mp.toutiao.com",
  threads: "www.threads.net",
  weixinchannel: "channels.weixin.qq.com",
  bluesky: "bsky.app",
  v2ex: "www.v2ex.com",
  douban: "www.douban.com",
  dedao: "www.dedao.cn",
  weixin: "mp.weixin.qq.com",
  zsxq: "wx.zsxq.com",
  xiaoheihe: "www.xiaoheihe.cn",
  toutiaohao: "www.toutiao.com",
  substack: "substack.com",
  maimai: "maimai.cn",
  juejin: "juejin.cn",
  cnblogs: "www.cnblogs.com",
  csdn: "mp.csdn.net",
  jianshu: "www.jianshu.com",
  aliyun: "developer.aliyun.com",
  tencentyun: "cloud.tencent.com",
  volcengine: "developer.volcengine.com",
  qie: "om.qq.com",
  wordpress: "wordpress.com",
  sspai: "sspai.com",
  "51cto": "blog.51cto.com",
  eastmoney: "www.eastmoney.com",
  medium: "medium.com",
  oschina: "www.oschina.net",
  infoq: "www.infoq.cn",
  smzdm: "www.smzdm.com",
  woshipm: "www.woshipm.com",
  gelonghui: "www.gelonghui.com",
  jiankangjie: "www.cn-healthcare.com",
  autohome: "www.autohome.com.cn",
  jianpian: "www.jianpian.cn",
  tonghuashun: "www.10jqka.com.cn",
  dongchedi: "mp.dcdapp.com",
  netease: "mp.163.com",
  dayu: "mp.dayu.com",
  kuaichuanhao: "www.360kuai.com",
  yidian: "www.yidianzixun.com",
  youtube: "www.youtube.com",
  tiktok: "www.tiktok.com",
  chejiahao: "creator.autohome.com.cn",
  dewu: "creator.dewu.com",
  yiche: "mp.yiche.com",
  alipay: "sweb.alipay.com",
  pinduoduo: "live.pinduoduo.com",
  vivovideo: "kaixinkan.vivo.com.cn",
  iqiyi: "mp.iqiyi.com",
  youku: "mp.youku.com",
  tencentvideo: "v.qq.com",
  qqmusic: "mp.tencentmusic.com",
  lizhi: "nj.lizhi.fm",
  ximalaya: "www.ximalaya.com",
  xiaoyuzhou: "podcaster.xiaoyuzhoufm.com",
  qingting: "www.qingting.fm",
  neteasepodcast: "music.163.com",
  spotify: "open.spotify.com",
};

/** Decorative: always shown beside the platform's or account's readable name. */
export function PlatformMark({ platformKey, name }: { platformKey: string; name: string }) {
  const site = PLATFORM_LOGO_SITES[platformKey];
  const logo = site ? resolveSiteFaviconUrl(site) : null;
  const [failed, setFailed] = useState(() =>
    logo ? siteFaviconStatusCache.get(logo) === "fail" : false,
  );
  const Icon = icons[platformKey];
  const showLogo = logo && !failed;
  return (
    <span
      className="mp-mark"
      data-platform={platformKey}
      data-logo={showLogo ? "" : undefined}
      aria-hidden="true"
    >
      {showLogo ? (
        <img
          src={logo}
          alt=""
          draggable={false}
          onError={() => {
            siteFaviconStatusCache.set(logo, "fail");
            setFailed(true);
          }}
        />
      ) : Icon ? (
        <Icon size={18} stroke={1.7} />
      ) : (
        name.trim().slice(0, 2)
      )}
    </span>
  );
}
