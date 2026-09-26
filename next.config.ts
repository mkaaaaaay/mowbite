import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  // lets phones etc. on the lan use the dev server, e.g. DEV_ORIGINS=myhost,192.168.1.20
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(",") ?? [],
};

export default nextConfig;
