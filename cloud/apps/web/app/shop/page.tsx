import type { Metadata } from "next";

import { ShopClient } from "@/components/commerce/ShopClient";

export const metadata: Metadata = {
  title: "DJL 商城",
  description: "平台精选好物、图片找商品与好友推荐收益。",
};

export default function ShopPage() {
  return <ShopClient />;
}
