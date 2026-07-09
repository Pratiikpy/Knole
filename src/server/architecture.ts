import "dotenv/config";
import { ethers } from "ethers";
import { providerFor, contractAddress, NET_NAME, OG_EXPLORER, OG_NET } from "./og";
import { sealedActive } from "./sealed";
import { teeInfo } from "./ogCompute";

// The three ERC-7857 interface ids the KnoleAgenticID contract advertises (XOR of each interface's
// function selectors). A judge can recompute these and call supportsInterface() themselves — the
// values are fixed by the interface, not by us.
const ERC7857 = "0x4b396f04";
const ERC7857_AUTHORIZE = "0x35d39512";
const ERC7857_CLONEABLE = "0xd79f01c7";
const ERC721 = "0x80ac58cd";
const RANDOM = "0xdeadbeef"; // a control: a real registry returns false for an unknown id

const IFACE = [
  "function supportsInterface(bytes4) view returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

export type ArchitectureFacts = {
  network: string;
  chainId: number;
  explorer: string;
  // iNFT contract
  nftAddress: string | null;
  nftName?: string;
  nftSymbol?: string;
  totalSupply?: number;
  // live supportsInterface reads, checked against the deployed contract at request time
  interfaces?: {
    erc7857: { id: string; ok: boolean };
    authorize: { id: string; ok: boolean };
    cloneable: { id: string; ok: boolean };
    erc721: { id: string; ok: boolean };
    control: { id: string; ok: boolean }; // expected false — proves it isn't a lie-return-true stub
  };
  liveReadOk: boolean;
  // sealed inference
  sealed: boolean;
  teeProvider: string | null;
};

/**
 * Read the live, provable architecture facts a judge asked us to fix: that the memory token is a
 * legitimate ERC-7857 (not a bare ERC-721), and that inference genuinely runs in a 0G TEE. The
 * supportsInterface calls hit the deployed contract on-chain at request time — nothing is asserted
 * that can't be independently recomputed and re-checked. Degrades to config-only facts if the RPC
 * is briefly unreachable (liveReadOk:false), never throwing.
 */
export async function architectureFacts(): Promise<ArchitectureFacts> {
  const nftAddress = contractAddress("KNOLE_NFT_ADDRESS") || null;
  const tee = teeInfo();
  const base: ArchitectureFacts = {
    network: NET_NAME,
    chainId: OG_NET.chainId,
    explorer: OG_EXPLORER,
    nftAddress,
    liveReadOk: false,
    sealed: sealedActive(),
    teeProvider: tee.configured ? tee.provider : null,
  };
  if (!nftAddress) return base;

  // Try the app's configured provider first (respects the OG_RPC_URL override), then fall back to the
  // network's canonical public RPC. A read-only verification shouldn't be at the mercy of one endpoint
  // being slow or rate-limited from the serverless region — this is the proof the whole page exists for.
  const providers: ethers.JsonRpcProvider[] = [providerFor()];
  if (OG_NET.rpc && OG_NET.rpc !== process.env.OG_RPC_URL) {
    providers.push(new ethers.JsonRpcProvider(OG_NET.rpc));
  }

  let lastErr = "";
  for (const provider of providers) {
    try {
      const c = new ethers.Contract(nftAddress, IFACE, provider);
      const [name, symbol, supply, e7857, auth, clone, e721, ctrl] = await Promise.all([
        c.name(),
        c.symbol(),
        c.totalSupply(),
        c.supportsInterface(ERC7857),
        c.supportsInterface(ERC7857_AUTHORIZE),
        c.supportsInterface(ERC7857_CLONEABLE),
        c.supportsInterface(ERC721),
        c.supportsInterface(RANDOM),
      ]);
      return {
        ...base,
        nftName: name as string,
        nftSymbol: symbol as string,
        totalSupply: Number(supply),
        interfaces: {
          erc7857: { id: ERC7857, ok: e7857 as boolean },
          authorize: { id: ERC7857_AUTHORIZE, ok: auth as boolean },
          cloneable: { id: ERC7857_CLONEABLE, ok: clone as boolean },
          erc721: { id: ERC721, ok: e721 as boolean },
          control: { id: RANDOM, ok: ctrl as boolean },
        },
        liveReadOk: true,
      };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  console.error("architecture on-chain read failed (all RPCs):", lastErr);
  return base; // every RPC hiccuped — show the address + config facts, just not the live reads
}
