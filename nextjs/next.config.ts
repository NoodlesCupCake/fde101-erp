import type { NextConfig } from "next";

// cacheComponents is off on purpose: every page here depends on the signed-in user, so all rendering is dynamic.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
