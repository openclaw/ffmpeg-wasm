import type { Writable } from "node:stream";

export type StdioStream = Writable | null | undefined;

export function ignoreStdioEpipe(stream: StdioStream): void {
  if (!stream) {
    return;
  }
  stream.on("error", (error: Error) => {
    if ("code" in error && error.code === "EPIPE") {
      return;
    }
    throw error;
  });
}
