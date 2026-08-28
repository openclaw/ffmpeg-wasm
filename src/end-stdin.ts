import type { Writable } from "node:stream";

export type StdinPayload = Buffer | Uint8Array | string;

export function endChildStdin(
  stdin: Writable | null | undefined,
  data: StdinPayload,
  onError: (error: Error) => void,
): void {
  if (!stdin) {
    return;
  }
  stdin.on("error", (error: Error) => {
    onError(error);
  });
  stdin.end(data);
}
