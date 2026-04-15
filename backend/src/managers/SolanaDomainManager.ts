import { address, createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi } from '@solana/kit';

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export class SolanaDomainManager {
  /**
   * Resolve a domain name (e.g. `mike.sol`, `mike.skr`) to a Solana wallet address.
   * Returns null when the domain is not registered or cannot be resolved.
   *
   * - `.sol` domains are resolved via @solana-name-service/sns-sdk-kit (SNS-IP 5).
   * - Other TLDs (e.g. `.skr`) are resolved via @onsol/tldparser (AllDomains).
   */
  static async resolve(name: string): Promise<string | null> {
    const domain = name.trim().toLowerCase();
    if (!/^[a-z0-9-]+\.[a-z]+$/.test(domain)) return null;

    const tld = domain.slice(domain.lastIndexOf('.') + 1);

    try {
      if (tld === 'sol') {
        return await SolanaDomainManager.resolveSns(domain);
      }
      return await SolanaDomainManager.resolveAllDomains(domain);
    } catch (err) {
      console.error('SolanaDomainManager.resolve error:', domain, err);
      return null;
    }
  }

  private static async resolveSns(domain: string): Promise<string | null> {
    const { resolveDomain } = await import('@solana-name-service/sns-sdk-kit');
    // Cast rpc to any — sns-sdk-kit bundles its own @solana/kit types which
    // differ structurally from the backend's version but are runtime-compatible.
    const owner = await resolveDomain(rpc as any, domain);
    return owner ? (owner as string) : null;
  }

  private static async resolveAllDomains(domain: string): Promise<string | null> {
    const { TldParser } = await import('@onsol/tldparser');
    const { Connection } = await import('@solana/web3.js');
    const conn = new Connection(rpcUrl);
    const parser = new TldParser(conn);
    const owner = await parser.getOwnerFromDomainTld(domain);
    if (!owner) return null;
    return typeof owner === 'string' ? owner : owner.toBase58();
  }

  /**
   * Reverse-lookup wallet addresses to their primary domain names.
   * Returns a record mapping address → "name.tld" for addresses that have one.
   *
   * - .sol primary domains are read via @solana-name-service/sns-sdk-kit.
   * - Addresses without a .sol primary fall back to @onsol/tldparser (covers .skr and other AllDomains TLDs).
   */
  static async lookup(addresses: string[]): Promise<Record<string, string>> {
    const unique = Array.from(new Set(addresses.map(a => a.trim()).filter(Boolean))).slice(0, 10);
    if (unique.length === 0) return {};

    const result: Record<string, string> = {};

    try {
      const { getPrimaryDomainsBatch } = await import('@solana-name-service/sns-sdk-kit');
      const kitAddresses = unique.map(a => address(a));
      const primaries = await getPrimaryDomainsBatch(rpc as any, kitAddresses as any);
      for (let i = 0; i < unique.length; i++) {
        const name = primaries[i];
        if (name) result[unique[i]] = `${name}.sol`;
      }
    } catch (err) {
      console.error('SolanaDomainManager.lookup SNS error:', err);
    }

    const missing = unique.filter(a => !result[a]);
    if (missing.length === 0) return result;

    try {
      const { TldParser } = await import('@onsol/tldparser');
      const { Connection, PublicKey } = await import('@solana/web3.js');
      const conn = new Connection(rpcUrl);
      const parser = new TldParser(conn);

      try {
        const mainDomains = await parser.getMainDomains(missing);
        for (let i = 0; i < missing.length; i++) {
          const d = mainDomains[i];
          if (d) result[missing[i]] = d;
        }
      } catch {}

      const stillMissing = missing.filter(a => !result[a]);
      await Promise.all(
        stillMissing.map(async (addr) => {
          try {
            const all = await parser.getParsedAllUserDomains(new PublicKey(addr));
            if (all && all.length > 0 && all[0].domain) {
              result[addr] = all[0].domain;
            }
          } catch {}
        }),
      );
    } catch (err) {
      console.error('SolanaDomainManager.lookup AllDomains error:', err);
    }

    return result;
  }
}
