export const BRAND_ASSET_PATHS = {
  productionMacIconPng: "assets/prod/djl-macos-1024.png",
  productionMacLegacyIconPng: "assets/prod/djl-macos-legacy-1024.png",
  productionLinuxIconPng: "assets/prod/djl-universal-1024.png",
  productionWindowsIconIco: "assets/prod/djl-windows.ico",
  productionWebFaviconIco: "assets/prod/djl-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/djl-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/djl-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/djl-web-apple-touch-180.png",
  developmentWindowsIconIco: "assets/prod/djl-windows.ico",
  developmentWebFaviconIco: "assets/prod/djl-web-favicon.ico",
  developmentWebFavicon16Png: "assets/prod/djl-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/prod/djl-web-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/prod/djl-web-apple-touch-180.png",
} as const;

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

export const DEVELOPMENT_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];

export const PUBLISH_ICON_OVERRIDES: ReadonlyArray<IconOverride> = [
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
    targetRelativePath: "dist/client/favicon.ico",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    targetRelativePath: "dist/client/favicon-16x16.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    targetRelativePath: "dist/client/favicon-32x32.png",
  },
  {
    sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    targetRelativePath: "dist/client/apple-touch-icon.png",
  },
];
