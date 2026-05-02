/**
 * CLI smoke test for the `@midnames/sdk` resolver.
 *
 *   pnpm resolve ivan.night
 *   npx tsx resolve.ts ivan.night
 *
 * Prints the resolved profile on the preprod network. Useful to verify SDK
 * and network wiring without loading the full frontend.
 */
import { createDefaultProvider, getDomainProfile } from "@midnames/sdk";

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: npx tsx resolve.ts <domain>");
  process.exit(1);
}

const provider = createDefaultProvider({ networkId: "preprod" });

const result = await getDomainProfile(domain, { provider });

console.log(result.data);
