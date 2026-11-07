/// <reference lib="webworker" />
// Runs the Monte Carlo off the main thread so sliders stay smooth on phones.
import { simulate, type SimOptions } from "./simulate";
import type { Ledger } from "./types";

self.onmessage = (e: MessageEvent<{ id: number; ledger: Ledger; people: string[]; opts: SimOptions }>) => {
  const { id, ledger, people, opts } = e.data;
  try {
    const result = simulate(ledger, new Set(people), opts);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
