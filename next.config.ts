import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained build at .next/standalone with only the
  // node_modules actually traced as runtime dependencies. Used by the
  // Dockerfile to keep the final image small (~80MB vs ~400MB).
  output: "standalone",
};

export default nextConfig;
