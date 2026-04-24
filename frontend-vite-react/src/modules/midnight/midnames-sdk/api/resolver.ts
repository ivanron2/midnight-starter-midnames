/**
 * Thin wrapper around `@midnames/sdk` used by the Conference Room page.
 *
 * Two responsibilities:
 *   1. `resolveDomain(name)` — look up a `.night` domain on preprod and
 *      return its profile (owner, target address, custom fields).
 *   2. `verifyOwnership(profile, walletAddresses)` — prove the *connected*
 *      wallet owns the domain by comparing its coin public key against
 *      the domain's target address.
 */
import {
  createDefaultProvider,
  getDomainProfile,
  type DomainProfileData,
} from "@midnames/sdk";
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";

const NETWORK_ID = "preprod";

let providerInstance: PublicDataProvider | null = null;

function getProvider(): PublicDataProvider {
  if (!providerInstance) {
    providerInstance = createDefaultProvider({ networkId: NETWORK_ID });
  }
  return providerInstance;
}

/** Lower-case and append `.night` if the suffix is missing. */
export function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.endsWith(".night") ? trimmed : `${trimmed}.night`;
}

/** Resolve a `.night` domain to its full profile. Throws on network/SDK error. */
export async function resolveDomain(raw: string): Promise<DomainProfileData> {
  const fullDomain = normalizeDomain(raw);
  if (!fullDomain || fullDomain === ".night") {
    throw new Error("Enter a domain name");
  }

  const result = await getDomainProfile(fullDomain, { provider: getProvider() });
  if (!result.success) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error ?? "Failed to resolve domain"));
  }
  return result.data;
}

export type OwnershipCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "no-target" | "no-wallet-key" | "mismatch";
      candidate?: string;
      expected?: string;
    };

/**
 * Compare the connected wallet's key against the domain's target address.
 *
 * The wallet dapp-connector returns the shielded coin public key as raw hex,
 * while Midnames stores it as bech32m (`mn_shield-cpk_preprod1…`). Both encode
 * the same 32 bytes, so we try a fast string compare first and fall back to
 * decoding both sides to bytes before declaring a mismatch.
 */
export function verifyOwnership(
  profile: DomainProfileData,
  walletAddresses: { shielded?: string; unshielded?: string }
): OwnershipCheck {
  const target = profile.info?.target;
  if (!target) return { ok: false, reason: "no-target" };

  const candidate =
    target.type === "shielded"
      ? walletAddresses.shielded
      : target.type === "unshielded"
      ? walletAddresses.unshielded
      : undefined;

  if (!candidate) {
    return { ok: false, reason: "no-wallet-key", expected: target.address };
  }

  if (candidate.trim().toLowerCase() === target.address.trim().toLowerCase()) {
    return { ok: true };
  }

  const ca = decodeKey(candidate);
  const cb = decodeKey(target.address);
  if (ca && cb && bytesEqual(ca, cb)) return { ok: true };

  return {
    ok: false,
    reason: "mismatch",
    candidate,
    expected: target.address,
  };
}

/** Decode bech32m or plain hex into raw bytes. Returns null if neither matches. */
function decodeKey(s: string): Uint8Array | null {
  const clean = s.trim();
  try {
    return MidnightBech32m.parse(clean).data;
  } catch {
    // not bech32m — fall through to hex
  }
  if (/^[0-9a-f]+$/i.test(clean) && clean.length % 2 === 0) {
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type { DomainProfileData };
