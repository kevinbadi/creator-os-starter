"use client";

import { useEffect } from "react";

/**
 * Wallet extensions (Phantom, MetaMask, …) fight over window.ethereum and throw
 * "Cannot redefine property: ethereum". Next's dev overlay surfaces that as if
 * Marketing OS crashed. Swallow chrome-extension / ethereum redefine noise only.
 */
function isExtensionNoise(msg: string, source?: string, stack?: string): boolean {
  const m = msg || "";
  const s = source || "";
  const st = stack || "";
  if (/chrome-extension:\/\//i.test(s) || /moz-extension:\/\//i.test(s)) return true;
  if (/chrome-extension:\/\//i.test(st) || /moz-extension:\/\//i.test(st)) return true;
  if (/Cannot redefine property:\s*ethereum/i.test(m)) return true;
  if (/evmAsk\.js/i.test(s) || /evmAsk\.js/i.test(m)) return true;
  // Wallet extensions probing pages they were never asked to connect to
  // (Kevin 2026-09-19: "we dont have to connect to any crypto wallets").
  if (/metamask|phantom|coinbase wallet|walletconnect|web3 provider/i.test(m)) return true;
  return false;
}

export function ExtensionNoiseGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (!isExtensionNoise(e.message, e.filename, e.error instanceof Error ? e.error.stack : undefined)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
            ? reason.message
            : String(reason ?? "");
      const stack = reason instanceof Error ? `${reason.stack ?? ""}\n${(reason.cause as Error | undefined)?.stack ?? ""}` : "";
      if (!isExtensionNoise(msg, undefined, stack)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);
  return null;
}
