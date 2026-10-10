import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(
          process.env.NODE_ENV === "production",
          process.env.NEXT_PUBLIC_API_BASE_URL,
          process.env.NEXT_PUBLIC_R2_ENDPOINT_ORIGIN,
        ),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
