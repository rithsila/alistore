const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        // Production image CDN host (INTEGRATION-09): the R2 bucket served
        // through Cloudflare CDN on img.<domain> (CLARIFY-08 = alistore.com;
        // provisional until the domain purchase closes CLARIFY-08-REOPEN and
        // SETUP-11 points DNS at R2).
        protocol: "https",
        hostname: "img.alistore.com",
      },
      {
        // Cloudflare R2 dev public host (SETUP-05). Product images load from
        // this bucket in dev until SETUP-11 swaps to img.<domain> above.
        protocol: "https",
        hostname: "pub-1dedea628ee74e9399932493df26e28e.r2.dev",
      },
      {
        protocol: "https",
        hostname: "medusa-public-images.s3.eu-west-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "medusa-server-testing.s3.us-east-1.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
}

module.exports = nextConfig
