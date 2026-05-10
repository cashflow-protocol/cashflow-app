# Jupiter DX Report — Building Cashflow

**Project:** [Cashflow](https://cashflow.fun) — a personal finance app on Solana Mobile that lets users deposit stables/SOL into Jupiter Lend, Kamino, and Drift, and swap between assets — all from inside a Squads V4 multisig vault that they fully own.

**Author:** Mike Timashov ([@heymike777](https://x.com/heymike777) · mike@dangervalley.com)
**Date:** May 2026
**Stack:** Node.js + TypeScript backend, React Native (Solana Mobile) frontend, MongoDB, `@solana/kit`

---

## TL;DR

Cashflow integrates **four Jupiter APIs** in production:

| API | Endpoint(s) | Where |
|---|---|---|
| Lend Earn — list vaults | `GET /lend/v1/earn/tokens` | [JupiterManager.ts:178](backend/src/managers/JupiterManager.ts#L178) |
| Lend Earn — positions | `GET /lend/v1/earn/positions` | [JupiterManager.ts:196](backend/src/managers/JupiterManager.ts#L196) |
| Lend Earn — deposit/withdraw ixs | `POST /lend/v1/earn/{deposit,withdraw}-instructions` | [JupiterManager.ts:212](backend/src/managers/JupiterManager.ts#L212) |
| Swap | `GET /swap/v1/quote`, `POST /swap/v1/swap-instructions` | [JupiterManager.ts:348](backend/src/managers/JupiterManager.ts#L348), [:414](backend/src/managers/JupiterManager.ts#L414) |
| Tokens V2 | `GET /tokens/v2/search` | [JupiterManager.ts:551](backend/src/managers/JupiterManager.ts#L551) |

**Overall verdict:** Best-in-class on Solana for breadth and reliability. The Swap API is genuinely a delight. The Lend API is powerful but has a handful of undocumented sharp edges that cost us multiple days when integrating with a Squads vault flow. The Tokens V2 API replaced three separate vendors for us. Below is the unfiltered, line-by-line developer experience.

---

## 1. What's brilliant

### 1.1 Swap API just works

Once we got past the Squads wiring (more on that below), `/swap/v1/quote` → `/swap/v1/swap-instructions` is the cleanest Solana DEX aggregator integration we've ever shipped. Highlights:

- **`dynamicSlippage: true`** is the kind of feature you only appreciate after maintaining your own slippage logic for a year. Just turn it on and stop thinking about it.
- **`dynamicComputeUnitLimit: true`** removes the manual CU estimation game.
- **`platformFeeBps`** + **`feeAccount`** mean monetisation is a 5-minute job.
- **Route stability:** the same `quoteResponse` blob can be passed straight through to `/swap-instructions` with no parsing on our side.
- **`restrictIntermediateTokens: true`** + **`maxAccounts: 20`** are the right knobs in the right place — exactly what we needed to fit our route inside Squads' inner + execute transaction (both must be ≤ 1232 bytes).

### 1.2 Tokens V2 replaces three vendors

Before Cashflow we used Birdeye for stats, CoinGecko for price, and the SPL token list for metadata. `/tokens/v2/search?query=mint1,mint2,...` returned everything in one response: name, symbol, icon, decimals, holderCount, organicScore, audit flags (mint authority disabled, freeze authority disabled, top-holder concentration), 5m/1h/6h/24h volume + price stats, FDV, mcap, liquidity. We deleted three integrations and one cron job. See [TokenManager.ts](backend/src/managers/TokenManager.ts) — we cache for 60s in MongoDB and serve from there.

The 100-mint batch cap is documented and easy to handle with `Promise.all`:

```ts
// JupiterManager.ts:551
const BATCH_SIZE = 100;
const chunks: string[][] = [];
for (let i = 0; i < mints.length; i += BATCH_SIZE) {
  chunks.push(mints.slice(i, i + BATCH_SIZE));
}
const results = await Promise.all(
  chunks.map((chunk) =>
    this.api.get('/tokens/v2/search', { params: { query: chunk.join(',') } }),
  ),
);
```

### 1.3 Lend Earn API surface area is exactly right

`/lend/v1/earn/tokens` returns `totalRate` (already including supply rate + rewards rate), `convertToShares`, `convertToAssets`, and `liquiditySupplyData.withdrawable` — every field a frontend actually needs. We don't have to do off-chain math to display APY or check withdrawal limits. Saving us from doing share-↔-asset math in our app is a bigger deal than it sounds.

`/lend/v1/earn/positions?users=` returning `underlyingAssets` (in raw token units) directly is the right call — most lending APIs return shares and force you to derive the underlying yourself.

---

## 2. Where we lost time (the sharp edges)

These are the things that cost us a day or more each. None of them are blockers, but documenting them would have saved us about a week total.

### 2.1 Lend rejects PDAs as `signer`; Swap accepts them

**The setup:** Cashflow's onchain architecture is a Squads V4 multisig with one user-controlled member and one cloud-key member. Every protocol interaction is a CPI from the user's vault PDA. The vault PDA has no private key; it signs by virtue of Squads' `vault_transaction_execute` invoking with the right seeds.

**The trap:**

```
POST /lend/v1/earn/deposit-instructions
{ asset, signer: "<vault PDA>", amount }
→ 400 Bad Request: signer must be a wallet
```

Meanwhile, the same PDA in `userPublicKey` for `/swap/v1/swap-instructions` is accepted with no complaint. The asymmetry isn't documented anywhere we could find.

**Our workaround** ([JupiterManager.ts:668](backend/src/managers/JupiterManager.ts#L668)): pass a "template signer" (the user's cloud-key wallet, which is a real ed25519 keypair), then post-process the returned instructions to substitute the template signer's pubkey — and any ATAs derived from it — with the vault PDA's pubkey and ATAs. This works for Lend because the deposit/withdraw instruction *data* doesn't encode the signer (only accounts do). We confirmed this empirically by diffing instruction bytes across two template signers — same data, different accounts.

```ts
// JupiterManager.ts:668-744 (excerpt)
private async replaceAuthority(
  instructions: SerializedInstruction[],
  oldAuthority: string,
  newAuthority: string,
  depositMint: string,
): Promise<SerializedInstruction[]> {
  const replacements = new Map([[oldAuthority, newAuthority]]);

  // For every address in any instruction, check whether it's an ATA
  // derived from oldAuthority. Try BOTH Token and Token-2022 programs —
  // fTokens may use either.
  for (const mint of potentialMints) {
    for (const tokenProgram of [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]) {
      const [oldAta] = await findAssociatedTokenPda({
        owner: address(oldAuthority), tokenProgram, mint: address(mint),
      });
      if (allAddresses.has(oldAta as string)) {
        const [newAta] = await findAssociatedTokenPda({
          owner: address(newAuthority), tokenProgram, mint: address(mint),
        });
        replacements.set(oldAta as string, newAta as string);
      }
    }
  }
  // ... rewrite all account pubkeys
}
```

**Ask:** Either (a) accept arbitrary pubkeys in `signer` like Swap does, or (b) document the restriction prominently. The ideal would be a `userPublicKey: "any"` mode that builds instructions assuming the caller will inject signers.

### 2.2 Lend returns *non-idempotent* ATA-create instructions

**The trap:** Lend's `setupInstructions` includes a `createAssociatedTokenAccount` (0-byte data) for the depositor token account. If that ATA already exists — which it usually does for a returning user — the instruction fails with `IllegalOwner` and the whole CPI bundle aborts.

**Our workaround** ([JupiterManager.ts:752](backend/src/managers/JupiterManager.ts#L752)): convert any 0-byte ATA-program instruction to its idempotent variant (1-byte discriminator = 1). Six lines of code, took half a day to identify.

```ts
private makeAtaIdempotent(ix: SerializedInstruction): SerializedInstruction {
  const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  if (ix.programId === ATA_PROGRAM_ID && Buffer.from(ix.data, 'base64').length === 0) {
    return { ...ix, data: Buffer.from([1]).toString('base64') };
  }
  return ix;
}
```

**Ask:** Just default to idempotent. There's zero downside — idempotent has identical semantics on first creation, and no failure on second.

### 2.3 SOL is not auto-wrapped in Lend

**The trap:** Sending `asset: So11111111111111111111111111111111111111112` to `/lend/v1/earn/deposit-instructions` returns instructions that assume the depositor's wSOL ATA already exists *and is funded*. There's no `wrapAndUnwrapSol` flag.

**Our workaround** ([JupiterManager.ts:233](backend/src/managers/JupiterManager.ts#L233)): manually prepend `createATAIdempotent + transferSol + syncNative` for SOL deposits, and append `closeAccount` for SOL withdrawals to unwrap back.

```ts
if (mint === SOL_MINT) {
  const [wsolAta] = await findAssociatedTokenPda({ owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: solMint });
  const wrapIxs = [
    getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: wsolAta, owner, mint: solMint }),
    getTransferSolInstruction({ source: signer, destination: wsolAta, amount: BigInt(amount) }),
    getSyncNativeInstruction({ account: wsolAta }),
  ];
  return [...wrapIxs, ...jupiterIxs];
}
```

**Ask:** Add `wrapAndUnwrapSol: true` to `/lend/v1/earn/{deposit,withdraw}-instructions`, mirroring Swap. This is an obvious feature and would let everyone delete this boilerplate.

### 2.4 fTokens can be Token-2022 — but you can't tell from the API

The Lend API returns `token.address` (the fToken mint) but doesn't tell you which token program owns it. Some are Token, some are Token-2022. We have to call `getAccountInfo(mint)` and check `owner === TOKEN_2022_PROGRAM_ADDRESS` to derive the right ATA. See [JupiterManager.ts:454](backend/src/managers/JupiterManager.ts#L454).

**Ask:** Add `tokenProgram: "token" | "token-2022"` to the response.

### 2.5 Swap `computeBudgetInstructions` are dead-on-arrival inside a CPI

**The trap:** `/swap/v1/swap-instructions` returns a `computeBudgetInstructions` array. We initially included them — and our Squads-CPI'd swaps silently capped at 200k CU and failed with `ExceededComputeBudget`.

The compute budget program only honors `SetComputeUnitLimit` / `SetComputeUnitPrice` at the **top level** of a transaction. If you're invoking the swap via CPI (which you are when going through any vault/multisig), those instructions are no-ops. Our Squads execute TX sets its own compute budget at the outer level.

**Our workaround** ([JupiterManager.ts:481](backend/src/managers/JupiterManager.ts#L481)): drop `computeBudgetInstructions` entirely.

```ts
// Skip computeBudgetInstructions — they only work at the top-level
// transaction, not via CPI. The Squads execute TX sets its own compute budget.
const jupiterIxs: SerializedInstruction[] = [];
if (data.setupInstructions) for (const ix of data.setupInstructions) jupiterIxs.push(...);
if (data.swapInstruction) jupiterIxs.push(...);
if (data.cleanupInstruction) jupiterIxs.push(...);
```

**Ask:** Add a `forCpi: true` flag (or document this clearly). Right now anyone integrating Jupiter Swap through Squads / Sphere / a custom vault is going to hit this and not know why their swap died.

### 2.6 Stake-pool DEXes break Jito bundles

**The trap:** Cashflow lands all transactions through Jito to keep MEV exposure tight. Jupiter's router happily includes stake-pool DEXes (Stakedex, SPL Stake Pool, Sanctum, Sanctum Infinity, Marinade, Solayer, FluxBeam Stake) — but their instructions write-lock validator **vote accounts**, and Jito rejects bundles with: `bundles cannot lock any vote accounts`. Same problem with some validator-linked RFQ DEXes (HumidiFi, AlphaQ).

**Our workaround** ([JupiterManager.ts:373](backend/src/managers/JupiterManager.ts#L373)): permanent `excludeDexes` list:

```ts
excludeDexes: [
  'Stakedex', 'SPL Stake Pool', 'Sanctum', 'Sanctum Infinity',
  'Marinade', 'Solayer', 'FluxBeam Stake',
  'HumidiFi', 'AlphaQ',
].join(',')
```

**Ask:** A query parameter like `excludeVoteAccountDexes: true` (or just `jitoCompatible: true`) that future-proofs us as new DEXes get added. Today our exclude list is a maintenance burden — every time a new stake-pool DEX is added we'll silently get failures until we notice.

### 2.7 Platform fee ATA must exist before swap

**The trap:** `feeAccount` must point to an ATA that already exists onchain. Jupiter doesn't create it. First swap of any new output token reverts.

**Our workaround** ([JupiterManager.ts:466](backend/src/managers/JupiterManager.ts#L466)): on every swap, `getAccountInfo(feeAta)` and lazily create it via the admin fee payer if missing — and detect Token vs Token-2022 from the mint's owner.

```ts
const mintInfo = await this.rpc.getAccountInfo(feeMint, { encoding: 'base64' }).send();
const feeTokenProgram = mintInfo.value?.owner === TOKEN_2022_PROGRAM_ADDRESS
  ? TOKEN_2022_PROGRAM_ADDRESS
  : TOKEN_PROGRAM_ADDRESS;
const [feeAta] = await findAssociatedTokenPda({ owner: feeOwner, tokenProgram: feeTokenProgram, mint: feeMint });
const ataInfo = await this.rpc.getAccountInfo(feeAta).send();
if (!ataInfo.value) await this.createFeeAta(...);
```

**Ask:** Either auto-create the fee ATA inside `/swap/v1/swap-instructions` (charging the user a tiny rent) or document this in the platform-fee guide. The current behavior is a foot-gun for anyone implementing fees for the first time.

### 2.8 No way to set a referral code via API

**The trap:** We wanted every Cashflow user to be tagged as referred by our main account, so swap volume routed through us would credit our referral balance. The Swap API exposes `platformFeeBps` + `feeAccount` for direct platform fees, but there is no `referralAccount` / `referralCode` parameter on `/swap/v1/quote` or `/swap/v1/swap-instructions`. Setting up referrals appears to require the Referral Program UI / dashboard flow, with no programmatic way to attach a referral identifier to API-built swaps at user creation time.

**What we wanted:**

```ts
// Hypothetical
const params = {
  inputMint, outputMint, amount,
  referralAccount: 'CASHzUQYANbpGyVMkn6SCkuXKKP4qbE4mywD699sXapz', // our main acct
  // ... or:
  referralCode: 'cashflow',
};
```

**Why it matters:** Cashflow creates a new Squads vault per user. Every user is functionally a new "wallet" from Jupiter's POV. Without an API-attachable referral, we have no clean way to credit one master account for all the swap volume our app generates. The only options today are (a) build our own fee accounting on top of `platformFeeBps` (which we did, but this is fee-not-referral and shows up differently in Jupiter's program), or (b) onboard each user manually through the Referral UI, which is a non-starter for a mobile app.

**Ask:** Add `referralAccount` (a pubkey) and/or `referralCode` (a slug registered to a master account) as optional parameters on `/swap/v1/quote` and `/swap/v1/swap-instructions`. Same for Lend if/when referrals expand there. This is the single biggest missing piece for any app that wants to monetise Jupiter integration at scale without forcing every end-user through a separate signup.

---

## 3. Wishlist

Things we'd build with on day one if they shipped:

1. **`forCpi: true`** on Swap — strips compute-budget ixs, returns CPI-safe instructions only.
2. **`wrapAndUnwrapSol`** on Lend — same semantics as Swap.
3. **`tokenProgram`** field on Lend's token response.
4. **`jitoCompatible: true`** on Swap — auto-excludes vote-account-locking DEXes.
5. **Lend `signer: any-pubkey`** mode — accepts PDAs.
6. **Idempotent ATA creates by default** — across Lend and Swap.
7. **`referralAccount` / `referralCode` parameters** on Swap — let an app credit one master referral account for every swap built via the API, without onboarding each end-user through the Referral UI. The single biggest monetisation gap today.
8. **A "fees" config endpoint** — `POST /platform/fee-account` that creates the fee ATA for a (wallet, mint) pair so apps don't have to embed admin keypairs to bootstrap.
9. **Lend simulation endpoint** — `/lend/v1/earn/simulate-deposit` that returns expected shares + post-deposit state without building instructions. We'd skip `convertToShares` math entirely.
10. **Lend rate history** — `/lend/v1/earn/rates?mint=&period=7d` — we currently scrape and store our own history.
11. **A websocket for position updates** — currently we poll `/positions` every 30s per active user.

---

## 4. The good kind of API

The reason we kept building on Jupiter despite the friction in §2 is that the **defaults are right**, the **fields are right**, and **routes don't break**. We've had Lend and Swap in production across roughly 1,500 deposits and 800 swaps with **zero unscheduled API breakages** during our 4-month integration window. Compare this to the SDKs we removed from this codebase:

- Birdeye (rate-limit churn, breaking response shape changes twice in a quarter)
- CoinGecko (cold-start latency, missing Solana-native tokens)
- Several lending SDKs that ship with onchain SDK objects forcing you to inherit their entire object model

Jupiter ships HTTP. Just HTTP. JSON in, instructions out. That's the right shape for an aggregator.

---

## 5. One concrete architectural note

The pattern that emerged for us — and that I'd recommend to anyone integrating Jupiter into a vault/multisig flow — is a small adapter that:

1. Calls Jupiter with a real-keypair "template signer".
2. Post-processes the response: substitute signer + derived ATAs, idempotent-ize ATA creates, drop compute-budget ixs, splice in wSOL wrap/unwrap if needed.
3. Returns clean `SerializedInstruction[]` that the app then composes inside whatever vault/program/multisig harness it uses.

The whole adapter is ~800 lines including types and is in [`backend/src/managers/JupiterManager.ts`](backend/src/managers/JupiterManager.ts). If this is a common pattern, an officially-blessed `@jup-ag/cpi-adapter` package would be welcome.

---

## 6. Net-net

Jupiter is the API I'd build against tomorrow if I were starting a new Solana product, and I'd be wary of competitors who haven't matched its breadth. The bumps in §2 are real but every one of them is fixable, and several have obvious one-flag solutions. If even half of §3 ships in 2026, Jupiter goes from "best DEX + lending API on Solana" to "obvious default for any onchain app that needs liquidity or yield."

Happy to chat with anyone on the team — DMs open at [@heymike777](https://x.com/heymike777) or email mike@dangervalley.com.
