import type { MetadataRoute } from "next";

/**
 * This is a private staff portal. Block ALL crawlers — search engines,
 * AI training bots, link previewers, the lot.
 *
 * Layered with `X-Robots-Tag` (proxy.ts) and `<meta name="robots">`
 * (app/layout.tsx) so that even if a crawler ignores robots.txt the
 * page itself still says "do not index".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
