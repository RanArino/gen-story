import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isLanguage,
  parseAcceptLanguage,
} from "./config";
import enMessages from "./messages/en.json";
import jaMessages from "./messages/ja.json";

const MESSAGES = {
  en: enMessages,
  ja: jaMessages,
} as const;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LANGUAGE_COOKIE)?.value;
  if (isLanguage(cookieLocale)) {
    return { locale: cookieLocale, messages: MESSAGES[cookieLocale] };
  }

  const headerList = await headers();
  const headerLocale = parseAcceptLanguage(headerList.get("accept-language"));
  if (headerLocale) {
    return { locale: headerLocale, messages: MESSAGES[headerLocale] };
  }

  return {
    locale: DEFAULT_LANGUAGE,
    messages: MESSAGES[DEFAULT_LANGUAGE],
  };
});
