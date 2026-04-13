# Agentic Engineering Grant — Cashflow

**Submit here**: https://superteam.fun/earn/grants/agentic-engineering
**Grant amount**: 200 USDG
**Deadline target**: May 11, 2026 (Asia/Calcutta)

---

## Step 1: Basics

**Project Title**
> Cashflow

**One Line Description**
> A Solana Mobile smart-account wallet with programmable spending limits, multisig-secured vaults, and one-tap access to on-chain yield.

**TG username**
> t.me/heymike777

**Wallet Address**
> RdWYVPCxqeJC7pviFuPmUz6Cru5qGGYmwPXCZhMJ5dZ

---

## Step 2: Details

**Project Details**
> Self-custody on Solana today forces users to choose between security and convenience. Hardware wallets are cumbersome on mobile, hot wallets leak keys, and recovery is a nightmare — one lost seed phrase and funds are gone forever. Meanwhile, accessing yield (Drift, Kamino, Jupiter) means bouncing between dapps with no safety rails on daily spend.
>
> Cashflow is a mobile-native smart-account wallet for Solana, built on Squads v4 multisig infrastructure. Users get a programmable account with configurable spending limits (e.g., 1 SOL/day for casual spend), social/passkey-based recovery via multiple recovery keys, and native integrations to earn yield on idle balances through Drift and Kamino — all in a single React Native app optimized for Solana Mobile / Seeker.
>
> Under the hood, Cashflow uses `@solana/kit` for all RPC and transaction building, `@solana-mobile/mobile-wallet-adapter-protocol` for wallet connections, Privy for embedded auth, Helius Sender + Jito bundles for reliable landing, Jupiter for swaps, and SNS + ANS for domain resolution. The backend (Node/Express + MongoDB) handles token metadata, price feeds, domain lookups, notifications via Firebase, and waitlist/invite management.
>
> The agentic engineering angle: the entire stack — mobile app, backend, Solana program integration layer, and infra plumbing — has been built in roughly 8 weeks via Claude Code-driven iteration, with AI pair-programming for everything from Squads multisig instruction composition to React Native liquid-glass UI animations to SNS/ANS resolver logic. The attached session transcript is proof of the AI-assisted development workflow.

**Deadline**
> May 11, 2026 (Asia/Calcutta)

**Proof of Work**
> - **GitHub repo**: https://github.com/cashflow-protocol/cashflow-app
> - **Commits**: 409 commits from 2026-02-15 to 2026-04-13 (~8 weeks of active agentic development)
> - **Core features shipped**:
>   - Squads v4 multisig-backed smart accounts with programmable spending limits (`SpendingLimitsScreen`, `squadsService.ts`)
>   - Vault recovery flow with multiple recovery keys (`VaultRecoveryScreen`, `VaultRecoveryExecutionScreen`, `KeysRecoveryScreen`)
>   - Mobile Wallet Adapter integration for Solana Mobile / Seeker
>   - Drift + Kamino earn integrations (`DriftManager`, `KaminoManager` on backend)
>   - Jupiter swap routing + Jito bundle submission + Helius Sender
>   - SNS + ANS domain resolution (`SolanaDomainManager`)
>   - Push notifications via Firebase Cloud Messaging
>   - Privy embedded auth + passkeys + PIN + secure keychain storage
>   - Liquid-glass UI, onboarding, invite/waitlist system
> - **Tech stack**: React Native 0.83 + Expo 55, `@solana/kit`, `@sqds/multisig`, Node 22 + Express 5, MongoDB, TypeScript end-to-end
> - **AI session transcript**: `claude-session.jsonl` (attached) — full Claude Code session demonstrating agentic development workflow
> - **Recent shipped work** (last 2 weeks): SNS + ANS resolution, spending limit controls, notifications system, liquid-glass UI polish, toast system overhaul, send SDK integration, signer fixes
> - **Prior work**: Author has previously shipped `@heymike/send` SDK (used in this project) — demonstrated track record of shipping Solana primitives

**Personal X Profile**
> x.com/heymike777

**Personal GitHub Profile**
> github.com/heymike777

**Colosseum Crowdedness Score**
> https://drive.google.com/file/d/11F9JlrV0scRNex_Kw5luo91NNJblPHmV/view?usp=sharing

**AI Session Transcript**
> Attached: `claude-session.jsonl` (in project root)

---

## Step 3: Milestones

**Goals and Milestones**

> **Milestone 1 — Public beta on Seeker (by 2026-04-20)**
> Ship signed Android release build for Solana Seeker with full smart-account flow: onboarding → PIN → vault creation → spending limit setup → first transaction. Close alpha tester feedback loop.
>
> **Milestone 2 — Earn integrations live (by 2026-04-27)**
> Ship Drift + Kamino earn flows in-app: one-tap deposit/withdraw to lending and perpetuals with safety rails enforced by spending limits. Include Jupiter-routed swap-and-deposit.
>
> **Milestone 3 — Recovery + notifications GA (by 2026-05-04)**
> Complete vault recovery flow with multiple recovery keys, guardian approval UX, and recovery-execution screen. Ship Firebase push notifications for incoming transfers, recovery requests, and spending-limit alerts.
>
> **Milestone 4 — Public launch + waitlist conversion (by 2026-05-11)**
> Open waitlist → public, ship invite-code redemption flow, launch marketing site with demo video, and submit to Google Play + Solana dApp Store. Target: 1,000 MAUs within 30 days of launch.

**Primary KPI**
> 1,000 Monthly Active Users (MAU) within 30 days of public launch

**Final tranche checkbox**
> ✅ I acknowledge that to receive the final tranche I must submit: (1) the Colosseum project link, (2) the GitHub repo link, and (3) the AI subscription receipt.

---

## Submission Checklist

1. ✅ Copy-paste each section above into the matching form step
2. ✅ Attach `./claude-session.jsonl` (exported to project root)
3. ✅ Colosseum Drive link — confirm sharing is set to **"Anyone with the link can view"**
4. ✅ TG, wallet, X, GitHub handles filled in

**Submit at**: https://superteam.fun/earn/grants/agentic-engineering
