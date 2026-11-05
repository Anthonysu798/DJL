import type { DesktopBridge } from "@synara/contracts";

interface ShopHost {
  location: { href: string };
  desktopBridge?: Pick<DesktopBridge, "openShop"> | undefined;
  open: (url: string, target: string, features: string) => Window | null;
}

/** Opens commerce separately; never navigates or resets the current AI workspace. */
export async function openShop(host: ShopHost = window): Promise<boolean> {
  if (host.desktopBridge?.openShop) return host.desktopBridge.openShop();
  const url = new URL("/shop/index.html", host.location.href).href;
  const popup = host.open(url, "djl-commerce", "popup,width=1180,height=820");
  if (!popup) return false;
  popup.opener = null;
  popup.focus();
  return true;
}
