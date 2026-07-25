import { APP_BASE_NAME, resolveAppDisplayName } from "@synara/shared/branding";

export { APP_BASE_NAME };
export const APP_DISPLAY_NAME = resolveAppDisplayName(import.meta.env.DEV);
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
