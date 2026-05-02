# 🚀 EDDA - Midnight Starter Template
This project is built on the Midnight Network.
- A starter template for building on Midnight Network with React frontend and smart contract integration.
- **[Live Demo → counter.nebula.builders](https://counter.nebula.builders)**

## 📦 Prerequisites

- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v10+)
- [Docker](https://docs.docker.com/get-docker/)
- [Git LFS](https://git-lfs.com/) (for large files)
- [Compact](https://docs.midnight.network/relnotes/compact-tools) (Midnight developer tools)
- [Lace](https://chromewebstore.google.com/detail/hgeekaiplokcnmakghbdfbgnlfheichg?utm_source=item-share-cb) (Browser wallet extension)
- [Faucet](https://faucet.preview.midnight.network/) (Preview Network Faucet)
- [`.night` domain](https://midnight.domains/) (required to enter the Conference Room — see [Midnames Integration](#-midnames-integration-night-domains))

## Known Issues

- N/A

## 🛠️ Setup

### 1️⃣ Install Git LFS

```bash
# Install and initialize Git LFS
sudo dnf install git-lfs  # For Fedora/RHEL
git lfs install
```

### 2️⃣ Install Compact Tools

```bash
# Install the latest Compact tools
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
```
```bash
# Install the latest compiler 
compact update +0.30.0
```

### 3️⃣ Install Node.js, pnpm, and docker
- [Node.js](https://nodejs.org/) & [pnpm](https://pnpm.io/) (`npm install -g pnpm@10`)
- [Docker](https://docs.docker.com/get-docker/)

### 4️⃣ Verify Installation
```bash
# Check versions
node -v  
pnpm -v   
docker -v
git lfs version
compact check  # Should show latest version
```

## 📁 Project Structure

```
├── counter-cli/         # CLI tools
├── counter-contract/    # Smart contracts
└── frontend-vite-react/ # React application
```

## 🔗 Setup Instructions

### Install Project Dependencies and compile contracts
  ```bash
   # In one terminal (from project root)
   pnpm install
   pnpm run build
   ```

### Setup Env variables

1. **Create .env file from template under counter-cli folder**
   - [`counter-cli/.env_template`](./counter-cli/.env_template)

2. **Create .env file from template under frontend-vite-react folder**
   - [`frontend-vite-react/.env_template`](./frontend-vite-react/.env_template)
   

### Start Development In Preview-Preprod-Mainnet Network or
   ```bash   
   # In one terminal (from project root)
   pnpm run dev:frontend
   ```

### Start Development In Undeployed Network
   ```bash   
   # In one terminal (from project root)
   pnpm run setup-standalone
   
   # In another terminal (from project root)
   pnpm run dev:frontend
   ```

## 🌙 Midnames Integration (.night domains)

This template ships with a **Conference Room** page (`/checkin`) that shows how to wire [Midnames](https://midnight.domains/) — Midnight's decentralized identity system — into a counter DApp.

### What is Midnames?

Midnames is Midnight Network's on-chain domain service. Each `.night` domain is a human-readable identity bound to a wallet's shielded coin public key, and carries a profile (name, bio, avatar, twitter, github, website). It resolves to a payment target — either shielded (`mn_shield-cpk_…`) or unshielded (`mn_addr_…`) — so apps can look up *who* is behind a wallet and send funds to a name instead of a raw address.

Think of it as the Midnight analog of ENS on Ethereum, with built-in profile fields.

### ⚠️ Register your domain first

Before running the Conference Room demo you must own a `.night` domain:

1. Go to **[https://midnight.domains/](https://midnight.domains/)**
2. Connect the **same Lace wallet** you will use with this template
3. Make sure you are on the **preprod** network
4. Register `yourname.night` and fill in the profile fields you want to surface (at minimum: name, avatar)

The frontend proves ownership by comparing your connected wallet's shielded coin public key against the domain's target. If they don't match, the Conference Room will block you as an impostor — that's the point.

### Why combine Midnames with this starter template?

| Without Midnames | With Midnames |
|---|---|
| Users are anonymous `mn_shield-cpk_…` keys | Users have human-readable, verifiable identities (`ivan.night`) |
| Any connected wallet can call the contract | Contract interactions can be *gated* on proven domain ownership |
| UI shows raw 32-byte addresses | UI shows avatars, names, bios pulled from the domain's profile |
| No way to attribute on-chain activity to a person | Every increment is attributed to a `.night` identity |
| "Who just incremented the counter?" → shrug | "Who's in the room?" → live roster with avatars |

The Conference Room demonstrates all of this on top of the existing counter contract with zero contract changes: the counter becomes the participant count, and only verified `.night` owners can increment it.

### Try it

1. Register your domain at [midnight.domains](https://midnight.domains/) (see above).
2. `pnpm run dev:frontend`
3. Open the **Conference Room** tab, connect Lace, type `yourname.night`, and click **Enter**.

### Quick sanity check (no frontend needed)

The repo includes a CLI script that calls the Midnames SDK directly:

```bash
cd frontend-vite-react
pnpm resolve yourname.night
```

Prints the resolved profile (target address, owner, fields). Useful to confirm the SDK and preprod indexer are reachable before touching the UI.

### Where the integration lives

```
frontend-vite-react/
├── resolve.ts                                 # CLI smoke test (pnpm resolve <domain>)
└── src/
    ├── modules/midnight/midnames-sdk/
    │   ├── api/resolver.ts                    # resolveDomain + verifyOwnership
    │   └── hooks/useGuestbook.ts              # local-only attendance roster
    └── pages/checkin/index.tsx                # Conference Room page
```

The **non-obvious** part lives in `verifyOwnership`: Lace returns the shielded coin public key as raw hex, while Midnames stores it as bech32m. Both encode the same 32 bytes — the helper decodes both sides to bytes before comparing, which is necessary and easy to get wrong.

---

<div align="center"><p>Built with ❤️ by <a href="https://eddalabs.io">Edda Labs</a></p></div>

