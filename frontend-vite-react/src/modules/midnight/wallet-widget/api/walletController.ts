import {
  ConnectedAPI,
  InitialAPI,
  Configuration,
  ConnectionStatus,
} from "@midnight-ntwrk/dapp-connector-api";
import { pipe as fnPipe } from "fp-ts/lib/function.js";
import { type Logger } from "pino";
import {
  filter,
  firstValueFrom,
  interval,
  map,
  take,
  tap,
  throwError,
  timeout,
} from "rxjs";

import {
  DustAddress,
  DustBalance,
  ShieldedAddress,
  ShieldedBalance,
  UnshieldedAddress,
  UnshieldedBalanceDappConnector,
} from "./common-types";
import { checkProofServerStatus } from "../utils/proofServer/utils";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

declare global {
  interface Window {
    midnight?: { [key: string]: InitialAPI };
  }
}

const CONNECT_TIMEOUT_MS = 30_000;
const AUTO_RECONNECT_DETECTION_MS = 5_000;

export class MidnightBrowserWallet {
  private constructor(
    public initialAPI: InitialAPI | undefined,
    public connectedAPI: ConnectedAPI | undefined,
    public serviceUriConfig: Configuration | undefined,
    public status: ConnectionStatus | undefined,
    public dustAddress: DustAddress | undefined,
    public dustBalance: DustBalance | undefined,
    public shieldedAddresses: ShieldedAddress | undefined,
    public shieldedBalances: ShieldedBalance | undefined,
    public unshieldedAddress: UnshieldedAddress | undefined,
    public unshieldedBalances: UnshieldedBalanceDappConnector | undefined,
    public proofServerOnline: boolean = false,
    public logger?: Logger
  ) {}

  static getAvailableWallets(): InitialAPI[] {
    if (window === undefined) return [];
    if (window.midnight === undefined) return [];

    const wallets: InitialAPI[] = [];
    for (const key in window.midnight) {
      try {
        const _wallet = window.midnight[key];
        if (_wallet === undefined) continue;
        if (_wallet.name === undefined) continue;
        if (_wallet.apiVersion === undefined) continue;
        wallets.push({
          name: _wallet.name,
          apiVersion: _wallet.apiVersion,
          connect: _wallet.connect,
          icon: _wallet.icon,
          rdns: _wallet.rdns,
        });
      } catch (e) {
        console.log(e);
      }
    }
    return wallets;
  }

  private static findWalletByNameOrRdns(identifier: string): InitialAPI | undefined {
    if (!window.midnight) return undefined;
    // First try direct key lookup (legacy support)
    if (window.midnight[identifier]) return window.midnight[identifier];
    // Scan by name or rdns (API v4+)
    for (const key in window.midnight) {
      const wallet = window.midnight[key];
      if (wallet?.name === identifier || wallet?.rdns === identifier) {
        return wallet;
      }
    }
    return undefined;
  }

  static getMidnightWalletConnected(): { rdns: string | null; networkID: string | null } {
    const rdns = window.localStorage.getItem("rdns-connected");
    const networkID = window.localStorage.getItem("network-id");
    return { rdns, networkID };
  }

  static setMidnightWalletConnected(rdns: string, networkID: string, logger?: Logger): void {
    if (logger) {
      logger.trace(`Setting wallet auto connect to ${rdns}`);
    }
    window.localStorage.setItem("rdns-connected", rdns);
    window.localStorage.setItem("network-id", networkID);
  }

  static deleteMidnightWalletConnected(logger?: Logger): void {
    if (logger) {
      logger.trace("Deleting wallet auto connect ");
    }
    window.localStorage.removeItem("rdns-connected");
    window.localStorage.removeItem("network-id");
  }

  /**
   * Connect to a wallet whose InitialAPI is already injected in window.midnight.
   *
   * This call MUST be invoked synchronously from the user-gesture click handler so
   * that the browser's transient user activation is still alive when the wallet
   * extension tries to open its authorize popup. Wallets like Lace v4 open a real
   * browser popup window for authorization, which the browser silently blocks if
   * activation has been lost (e.g. via a setTimeout / rxjs interval before the call).
   *
   * For the page-load auto-reconnect path (no user gesture exists), use
   * {@link waitForWalletAndConnect} instead — that path safely polls for the wallet
   * to be injected and then calls this method.
   */
  static async connectToWallet(
    rdns: string,
    networkID: string,
    logger?: Logger
  ): Promise<MidnightBrowserWallet> {
    const initialAPI = MidnightBrowserWallet.findWalletByNameOrRdns(rdns);
    if (!initialAPI) {
      logger?.error({ rdns }, "Wallet not available in window.midnight");
      throw new Error(
        `Wallet "${rdns}" is not available. Make sure the wallet extension is installed and unlocked.`
      );
    }

    logger?.info(
      { rdns, apiVersion: initialAPI.apiVersion, networkID },
      "Compatible wallet initial API found. Connecting (synchronous on click)."
    );

    let connectedAPI: ConnectedAPI;
    try {
      connectedAPI = await Promise.race<ConnectedAPI>([
        initialAPI.connect(networkID),
        new Promise<ConnectedAPI>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Wallet "${rdns}" did not respond within ${CONNECT_TIMEOUT_MS / 1000} s. ` +
                    `The authorize popup may have been blocked, or the wallet is not configured for network "${networkID}".`
                )
              ),
            CONNECT_TIMEOUT_MS
          )
        ),
      ]);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger?.error(
        { rdns, networkID, message: err.message, stack: err.stack },
        "initialAPI.connect() failed"
      );
      throw err;
    }

    if (!connectedAPI) {
      throw new Error("Connected API is undefined");
    }

    const [
      configRes,
      statusRes,
      dustAddressRes,
      dustBalanceRes,
      shieldedAddressesRes,
      shieldedBalancesRes,
      unshieldedAddressRes,
      unshieldedBalancesRes,
    ] = await Promise.allSettled([
      connectedAPI.getConfiguration(),
      connectedAPI.getConnectionStatus(),
      connectedAPI.getDustAddress(),
      connectedAPI.getDustBalance(),
      connectedAPI.getShieldedAddresses(),
      connectedAPI.getShieldedBalances(),
      connectedAPI.getUnshieldedAddress(),
      connectedAPI.getUnshieldedBalances(),
    ]);

    const unwrap = <T,>(label: string, res: PromiseSettledResult<T>): T | undefined => {
      if (res.status === "fulfilled") return res.value;
      logger?.warn({ method: label, reason: res.reason }, "Wallet method failed during connect");
      return undefined;
    };

    const serviceUriConfig = unwrap("getConfiguration", configRes);
    const status = unwrap("getConnectionStatus", statusRes);
    const dustAddress = unwrap("getDustAddress", dustAddressRes);
    const dustBalance = unwrap("getDustBalance", dustBalanceRes);
    const shieldedAddresses = unwrap("getShieldedAddresses", shieldedAddressesRes);
    const shieldedBalances = unwrap("getShieldedBalances", shieldedBalancesRes);
    const unshieldedAddress = unwrap("getUnshieldedAddress", unshieldedAddressRes);
    const unshieldedBalances = unwrap("getUnshieldedBalances", unshieldedBalancesRes);

    if (!serviceUriConfig) {
      throw new Error("Wallet did not return a configuration");
    }
    if (!status) {
      throw new Error("Wallet did not return a connection status");
    }

    const proofServerOnline = serviceUriConfig.proverServerUri
      ? await checkProofServerStatus(serviceUriConfig.proverServerUri)
      : false;

    logger?.info("Connected to wallet");

    const wallet = new MidnightBrowserWallet(
      initialAPI,
      connectedAPI,
      serviceUriConfig,
      status,
      dustAddress,
      dustBalance,
      shieldedAddresses,
      shieldedBalances,
      unshieldedAddress,
      unshieldedBalances,
      proofServerOnline,
      logger
    );

    const networkIdFromStatus = status.status === "connected" ? status.networkId : null;
    if (networkIdFromStatus === null) {
      throw new Error("Network ID is null");
    }
    MidnightBrowserWallet.setMidnightWalletConnected(rdns, networkIdFromStatus, logger);
    setNetworkId(networkIdFromStatus);

    return wallet;
  }

  /**
   * Auto-reconnect helper for the page-load path: poll for the wallet to be
   * injected into window.midnight (extensions sometimes inject slightly after
   * DOMContentLoaded), then delegate to {@link connectToWallet}. No user gesture
   * is required because the wallet has previously authorized this origin and
   * will not need to open an authorize popup.
   */
  static async waitForWalletAndConnect(
    rdns: string,
    networkID: string,
    logger?: Logger,
    detectionTimeoutMs: number = AUTO_RECONNECT_DETECTION_MS
  ): Promise<MidnightBrowserWallet> {
    await firstValueFrom(
      fnPipe(
        interval(100),
        map(() => MidnightBrowserWallet.findWalletByNameOrRdns(rdns)),
        tap((api) => {
          logger?.trace({ found: !!api, rdns }, "auto-reconnect: polling for wallet");
        }),
        filter((api): api is InitialAPI => !!api),
        take(1),
        timeout({
          first: detectionTimeoutMs,
          with: () =>
            throwError(() => {
              logger?.error(
                { rdns, detectionTimeoutMs },
                "auto-reconnect: wallet not detected in time"
              );
              return new Error(
                `Wallet "${rdns}" was not detected within ${detectionTimeoutMs} ms`
              );
            }),
        })
      )
    );

    return MidnightBrowserWallet.connectToWallet(rdns, networkID, logger);
  }

  disconnect(logger?: Logger): void {
    MidnightBrowserWallet.deleteMidnightWalletConnected(logger);
    this.initialAPI = undefined;
    this.connectedAPI = undefined;
    this.serviceUriConfig = undefined;
    this.status = undefined;
    this.dustAddress = undefined;
    this.dustBalance = undefined;
    this.shieldedAddresses = undefined;
    this.shieldedBalances = undefined;
    this.unshieldedAddress = undefined;
    this.unshieldedBalances = undefined;
  }

  async refresh(): Promise<void> {
    if (this.connectedAPI === undefined) return;
    this.serviceUriConfig = await this.connectedAPI.getConfiguration();
    this.status = await this.connectedAPI.getConnectionStatus();
    this.dustAddress = await this.connectedAPI.getDustAddress();
    this.dustBalance = await this.connectedAPI.getDustBalance();
    this.shieldedAddresses = await this.connectedAPI.getShieldedAddresses();
    this.shieldedBalances = await this.connectedAPI.getShieldedBalances();
    this.unshieldedAddress = await this.connectedAPI.getUnshieldedAddress();
    this.unshieldedBalances = await this.connectedAPI.getUnshieldedBalances();
    this.proofServerOnline = await checkProofServerStatus(
      this.serviceUriConfig.proverServerUri
    );
  }
}
