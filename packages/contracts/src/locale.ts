import { Schema } from "effect";
import {
  APP_LOCALES,
  APP_LOCALE_PREFERENCES,
  SOURCE_APP_LOCALE,
  type AppLocalePreferenceValue,
  type AppLocaleValue,
} from "./localeValues";

export { APP_LOCALES, APP_LOCALE_PREFERENCES, SOURCE_APP_LOCALE } from "./localeValues";

export const AppLocale = Schema.Literals(APP_LOCALES);
export type AppLocale = AppLocaleValue;

export const AppLocalePreference = Schema.Literals(APP_LOCALE_PREFERENCES);
export type AppLocalePreference = AppLocalePreferenceValue;
