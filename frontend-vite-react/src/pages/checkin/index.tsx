/**
 * Conference Room — reference integration of `@midnames/sdk` with an on-chain
 * counter contract.
 *
 * Flow demonstrated:
 *   1. Connect a Midnight wallet (via the existing wallet-widget).
 *   2. User types a `.night` domain; we resolve it with the Midnames SDK.
 *   3. We verify the connected wallet actually owns the domain by comparing
 *      its shielded coin public key against the domain's target address.
 *   4. On verification, clicking "Enter" calls the counter contract's
 *      `increment()` circuit — the counter becomes the participant count.
 *   5. Verified identities are appended to a local roster (`useGuestbook`)
 *      so the UI can show avatars/bios alongside the count.
 */
import { useEffect, useMemo, useState } from "react";
import {
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlusCircle,
  Shield,
  Pencil,
  Send,
  Clock,
  Users,
  Globe,
  Twitter,
  Github,
  Trash2,
  Sparkles,
  ShieldAlert,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useContractSubscription } from "@/modules/midnight/counter-sdk/hooks/use-contract-subscription";
import {
  useTransactionProgress,
  type TransactionStage,
} from "@/modules/midnight/counter-sdk/hooks/use-transaction-progress";
import { useWallet } from "@/modules/midnight/wallet-widget/hooks/useWallet";
import {
  normalizeDomain,
  resolveDomain,
  verifyOwnership,
  type DomainProfileData,
} from "@/modules/midnight/midnames-sdk/api/resolver";
import {
  useGuestbook,
  type GuestbookEntry,
} from "@/modules/midnight/midnames-sdk/hooks/useGuestbook";

type Verification =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "error"; message: string }
  | { status: "verified"; profile: DomainProfileData }
  | {
      status: "mismatch";
      profile: DomainProfileData;
      candidate?: string;
      expected?: string;
    }
  | { status: "no-wallet-key"; profile: DomainProfileData };

const stageConfig: { stage: TransactionStage; icon: typeof Shield; label: string }[] = [
  { stage: "proving", icon: Shield, label: "Prove" },
  { stage: "signing", icon: Pencil, label: "Sign" },
  { stage: "submitting", icon: Send, label: "Submit" },
  { stage: "finalizing", icon: Clock, label: "Confirm" },
];

const stageOrder: Record<string, number> = {
  proving: 0,
  signing: 1,
  submitting: 2,
  finalizing: 3,
};

function truncate(addr: string, head = 10, tail = 6) {
  if (!addr) return "";
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const CheckIn = () => {
  const { deployedContractAPI, derivedState, onDeploy, providers } =
    useContractSubscription();
  const {
    progress,
    setStage,
    setStageFromFlowMessage,
    startTracking,
    reset: resetProgress,
  } = useTransactionProgress();
  const { shieldedAddresses, unshieldedAddress, status: walletStatus } = useWallet();
  const { entries, addEntry, clear } = useGuestbook();

  const [domainInput, setDomainInput] = useState("");
  const [verification, setVerification] = useState<Verification>({ status: "idle" });
  const [txError, setTxError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStageFromFlowMessage(providers?.flowMessage);
  }, [providers?.flowMessage, setStageFromFlowMessage]);

  const shielded = shieldedAddresses?.shieldedCoinPublicKey;
  const unshielded = unshieldedAddress?.unshieldedAddress;
  const walletConnected = Boolean(shielded || unshielded);
  const walletLabel =
    shieldedAddresses?.shieldedAddress ?? unshielded ?? "";

  const round = derivedState?.round;
  const count = round === undefined ? null : Number(round);
  const busy = progress.isActive || verification.status === "resolving";

  const normalizedPreview = useMemo(
    () => (domainInput.trim() ? normalizeDomain(domainInput) : ""),
    [domainInput]
  );

  const resetVerification = () => {
    setVerification({ status: "idle" });
    setDomainInput("");
  };

  const copyAddress = async () => {
    if (deployedAddress) {
      await navigator.clipboard.writeText(deployedAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResolve = async () => {
    if (!walletConnected) return;
    setTxError(null);
    setVerification({ status: "resolving" });
    try {
      const profile = await resolveDomain(domainInput);
      const check = verifyOwnership(profile, { shielded, unshielded });
      if (check.ok) {
        setVerification({ status: "verified", profile });
      } else if (check.reason === "no-wallet-key") {
        setVerification({ status: "no-wallet-key", profile });
      } else {
        setVerification({
          status: "mismatch",
          profile,
          candidate: check.candidate,
          expected: check.expected,
        });
      }
    } catch (e) {
      setVerification({
        status: "error",
        message: e instanceof Error ? e.message : "Could not resolve domain",
      });
    }
  };

  const performIncrement = async (): Promise<number | null> => {
    if (!deployedContractAPI || round === undefined) return null;
    setTxError(null);
    startTracking(round);
    try {
      await deployedContractAPI.increment();
      setStage("confirmed");
      return Number(round) + 1;
    } catch (e) {
      console.error("Increment failed:", e);
      const detail =
        e instanceof Error
          ? e.message
          : typeof e === "string"
          ? e
          : "Unknown error";
      setTxError(`Transaction failed: ${detail}`);
      resetProgress();
      return null;
    }
  };

  const handleVerifiedCheckIn = async () => {
    if (verification.status !== "verified") return;
    const n = await performIncrement();
    if (n === null) return;
    const f = verification.profile.fields;
    addEntry({
      wallet: walletLabel,
      checkInNumber: n,
      identity: {
        kind: "verified",
        domain: verification.profile.fullDomain,
        name: f.get("name"),
        bio: f.get("bio"),
        avatar: f.get("avatar"),
        twitter: f.get("twitter"),
        github: f.get("github"),
        website: f.get("website"),
      },
    });
    resetVerification();
    // Show "Transaction confirmed!" briefly, then clear progress so the form
    // unlocks for the next domain without requiring a page refresh.
    setTimeout(() => resetProgress(), 1500);
  };

  const deployNew = async () => {
    try {
      const { address } = await onDeploy();
      if (address) {
        console.log('=== CONTRACT DEPLOYED ===');
        console.log('Contract Address:', address);
        console.log('========================');
        setDeployedAddress(address);
      }
    } catch (e) {
      console.error("Deploy failed:", e);
      setTxError("Deploy failed. Check the console and try again.");
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Conference Room
              </h1>
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium">
                Members only · .night
              </span>
            </div>
            <p className="text-muted-foreground">
              Only verified <span className="font-mono">.night</span> owners can
              enter. The on-chain counter tracks everyone currently in the room.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!deployedContractAPI && walletConnected && (
              <Button onClick={deployNew} variant="outline" className="gap-2">
                <PlusCircle className="h-4 w-4" />
                Deploy Counter
              </Button>
            )}
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-2">
              <div className="flex items-center justify-center h-9 w-9 rounded-md bg-primary/10 shrink-0">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  In the room
                </p>
                <p className="text-2xl font-bold font-mono leading-tight">
                  {count === null ? "—" : count}
                </p>
              </div>
            </div>
          </div>
        </div>

        {deployedAddress && (
          <Card className="mb-6 border-border/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-muted-foreground">Deployed to</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={copyAddress}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs font-mono break-all text-foreground select-all">{deployedAddress}</p>
            </CardContent>
          </Card>
        )}

        {!walletConnected && (
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-5 pb-5 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-0.5">
                  Connect your wallet to enter the room
                </p>
                <p className="text-muted-foreground">
                  Open the Wallet page and connect Lace. You'll need a{" "}
                  <span className="font-mono">.night</span> domain pointing at
                  your wallet to join.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* Check-in panel */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              Enter the room
            </CardTitle>
            <CardDescription>
              Type your <span className="font-mono">.night</span> domain. We'll
              resolve it on <span className="font-mono">preprod</span> and verify
              it points at your connected wallet before letting you in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => {
                  setDomainInput(e.target.value);
                  if (verification.status !== "idle" && verification.status !== "resolving") {
                    setVerification({ status: "idle" });
                  }
                }}
                placeholder="alice.night"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy || !walletConnected}
                className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring disabled:opacity-50"
              />
              <Button
                onClick={handleResolve}
                disabled={
                  !walletConnected || !domainInput.trim() || busy
                }
                className="gap-2"
              >
                {verification.status === "resolving" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Resolve & Verify
              </Button>
            </div>

            {normalizedPreview && normalizedPreview !== domainInput.trim().toLowerCase() && (
              <p className="text-xs text-muted-foreground">
                Will resolve as{" "}
                <span className="font-mono">{normalizedPreview}</span>
              </p>
            )}

            {verification.status === "error" && (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {verification.message}
                </p>
              </div>
            )}

            {verification.status === "mismatch" && (
              <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg space-y-2">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-red-600 dark:text-red-400 mb-0.5">
                      Impostor blocked
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-mono">
                        {verification.profile.fullDomain}
                      </span>{" "}
                      exists, but it resolves to a different wallet than the one
                      you're connected with. Only the owner can enter the room
                      under this name.
                    </p>
                  </div>
                </div>
                <div className="pl-7 space-y-1">
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    <span className="text-muted-foreground/70">domain:</span>{" "}
                    {verification.expected
                      ? truncate(verification.expected, 22, 12)
                      : "(no target)"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    <span className="text-muted-foreground/70">wallet:</span>{" "}
                    {verification.candidate
                      ? truncate(verification.candidate, 22, 12)
                      : "(wallet returned no key)"}
                  </p>
                </div>
              </div>
            )}

            {verification.status === "no-wallet-key" && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-600 dark:text-amber-400 mb-0.5">
                      Wallet didn't return a {verification.profile.info?.target?.type ?? "shielded"}{" "}
                      key
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-mono">
                        {verification.profile.fullDomain}
                      </span>{" "}
                      points at a{" "}
                      {verification.profile.info?.target?.type ?? "shielded"}{" "}
                      address, but your connected wallet didn't expose one.
                      Reconnect Lace from the Wallet page and try again.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {verification.status === "verified" && (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/30 rounded-lg space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-emerald-600 dark:text-emerald-400 mb-0.5">
                      Ownership verified
                    </p>
                    <p className="text-muted-foreground">
                      This <span className="font-mono">.night</span> resolves to
                      your connected wallet.
                    </p>
                  </div>
                </div>
                <ProfilePreview profile={verification.profile} />
                <Button
                  onClick={handleVerifiedCheckIn}
                  disabled={!deployedContractAPI || progress.isActive}
                  className="w-full gap-2"
                >
                  <UserCheck className="h-4 w-4" />
                  Enter as{" "}
                  <span className="font-mono">
                    {verification.profile.fullDomain}
                  </span>
                </Button>
              </div>
            )}

            {txError && (
              <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{txError}</p>
              </div>
            )}

            {progress.isActive && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  {stageConfig.map((cfg) => {
                    const currentIdx = stageOrder[progress.stage] ?? -1;
                    const cfgIdx = stageOrder[cfg.stage] ?? -1;
                    const isCompleted =
                      progress.stage === "confirmed" || currentIdx > cfgIdx;
                    const isCurrent =
                      currentIdx === cfgIdx && progress.stage !== "confirmed";
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={cfg.stage}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors ${
                          isCompleted
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : isCurrent
                            ? "border-blue-500/30 bg-blue-500/5"
                            : "border-border/40 bg-muted/30"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                        ) : isCurrent ? (
                          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5 text-muted-foreground/40" />
                        )}
                        <span
                          className={`text-xs font-medium ${
                            isCompleted
                              ? "text-emerald-600 dark:text-emerald-400"
                              : isCurrent
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-muted-foreground/50"
                          }`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out bg-blue-500"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  {progress.message}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendees */}
        <Card className="border-border/60 lg:sticky lg:top-20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base">Attendees</CardTitle>
                <CardDescription>
                  Entered on this browser. Stored locally.
                </CardDescription>
              </div>
              {entries.length > 0 && (
                <Button
                  onClick={clear}
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="max-h-[calc(100vh-280px)] overflow-y-auto">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nobody is here yet. Be the first to enter.
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <GuestbookRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        </div>

        {walletStatus && !walletConnected && (
          <p className="mt-6 text-xs text-muted-foreground text-center">
            Wallet status: <span className="font-mono">{String(walletStatus)}</span>
          </p>
        )}
      </div>
    </div>
  );
};

function ProfilePreview({ profile }: { profile: DomainProfileData }) {
  const f = profile.fields;
  const name = f.get("name");
  const bio = f.get("bio");
  const avatar = f.get("avatar");
  const twitter = f.get("twitter");
  const github = f.get("github");
  const website = f.get("website");

  return (
    <div className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg border border-border/50">
      <Avatar src={avatar} fallback={name ?? profile.fullDomain} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate">
          {name || profile.fullDomain}
        </p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {profile.fullDomain}
        </p>
        {bio && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{bio}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          {website && (
            <a
              href={website.startsWith("http") ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Globe className="h-3 w-3" /> site
            </a>
          )}
          {twitter && (
            <a
              href={`https://twitter.com/${twitter.replace(/^@/, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Twitter className="h-3 w-3" /> {twitter.replace(/^@/, "")}
            </a>
          )}
          {github && (
            <a
              href={`https://github.com/${github.replace(/^@/, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Github className="h-3 w-3" /> {github.replace(/^@/, "")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function GuestbookRow({ entry }: { entry: GuestbookEntry }) {
  const id = entry.identity;
  const displayName = id.name || id.domain;

  return (
    <li className="flex items-start gap-3 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
      <Avatar src={id.avatar} fallback={id.name ?? id.domain} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm truncate">{displayName}</p>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            <CheckCircle2 className="h-3 w-3" /> verified
          </span>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {id.domain}
        </p>
        {id.bio && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {id.bio}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        {entry.checkInNumber !== null && (
          <p className="font-mono text-sm font-semibold">
            #{entry.checkInNumber}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {formatTime(entry.timestamp)}
        </p>
      </div>
    </li>
  );
}

function Avatar({ src, fallback }: { src?: string; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={fallback}
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover border border-border/60 bg-muted"
      />
    );
  }
  const initials = fallback
    .replace(/\.night$/i, "")
    .split(/[\s-_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center">
      {initials || "?"}
    </div>
  );
}
