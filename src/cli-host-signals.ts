import type { ChildProcess } from "node:child_process";

const forwardedSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;

export interface ForwardCliSignalsOptions {
  exit?: (code: number) => void;
  stuckMs?: number;
}

export function forwardCliProcessSignals(
  child: Pick<ChildProcess, "kill">,
  options: ForwardCliSignalsOptions = {},
): () => void {
  const exit = options.exit ?? ((code) => process.exit(code));
  const stuckMs = options.stuckMs ?? 5000;
  const listeners = forwardedSignals.map((signal) => {
    let forceExit: ReturnType<typeof setTimeout> | undefined;
    const listener = () => {
      child.kill(signal);
      forceExit ??= setTimeout(() => {
        child.kill("SIGKILL");
        exit(128 + signalNumber(signal));
      }, stuckMs);
    };
    process.once(signal, listener);
    return () => {
      if (forceExit) {
        clearTimeout(forceExit);
      }
      process.off(signal, listener);
    };
  });
  return () => {
    for (const cleanup of listeners) {
      cleanup();
    }
  };
}

function signalNumber(signal: NodeJS.Signals) {
  if (signal === "SIGHUP") {
    return 1;
  }
  if (signal === "SIGINT") {
    return 2;
  }
  if (signal === "SIGTERM") {
    return 15;
  }
  return 0;
}
