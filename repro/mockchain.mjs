// A tiny in-memory "chain" for offline repros: a viem PublicClient whose
// eth_call answers are produced by handlers keyed on (contract, function name).
// Encoding/decoding uses the SDK's own read ABIs, so the SDK code under test
// sees byte-for-byte what a real node would return.
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, encodeErrorResult } from "viem";
import * as ReadsAbi from "../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js";

const ABIS = [ReadsAbi.marginBankReadAbi, ReadsAbi.perpPoolReadAbi];

export class Revert extends Error {
  constructor(data) {
    super("execution reverted");
    this.data = data;
  }
}

/**
 * handlers: { [lowercasedAddress]: { [functionName]: (args) => result } }
 * Throw `new Revert(hexData)` from a handler to simulate a contract revert.
 */
export function mockChain(handlers, { block = 1000n } = {}) {
  const calls = [];
  const transport = custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xc4cf"; // 50383, Hideki
      if (method === "eth_blockNumber") return `0x${block.toString(16)}`;
      if (method === "eth_call") {
        const [{ to, data }] = params;
        const on = handlers[to.toLowerCase()];
        if (!on) throw new Error(`mockChain: no contract at ${to}`);
        for (const abi of ABIS) {
          let decoded;
          try {
            decoded = decodeFunctionData({ abi, data });
          } catch {
            continue;
          }
          const fn = on[decoded.functionName];
          if (!fn) throw new Error(`mockChain: ${to} has no handler for ${decoded.functionName}`);
          calls.push(`${to.slice(0, 8)}….${decoded.functionName}`);
          try {
            const result = fn(decoded.args ?? []);
            return encodeFunctionResult({ abi, functionName: decoded.functionName, result });
          } catch (e) {
            if (e instanceof Revert) {
              const err = new Error("execution reverted");
              err.code = 3;
              err.data = e.data;
              throw err;
            }
            throw e;
          }
        }
        throw new Error(`mockChain: unknown selector ${data.slice(0, 10)}`);
      }
      throw new Error(`mockChain: unsupported method ${method}`);
    },
  });
  return { client: createPublicClient({ transport }), calls };
}

/** Revert data for a generic custom error, so the revert path is a real one. */
export const STALE_REVERT = encodeErrorResult({
  abi: [{ type: "error", name: "StalePrice", inputs: [] }],
  errorName: "StalePrice",
});
