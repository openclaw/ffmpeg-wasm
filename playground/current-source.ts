export function isCurrentSource(source: File, current: File | null): boolean {
  return current === source;
}

export function resultForCurrentSource<T>(source: File, current: File | null, result: T): T | null {
  return isCurrentSource(source, current) ? result : null;
}

export function statusForRenderProgress(
  source: File,
  current: File | null,
  progress: { phase?: string; outTimeSeconds?: number },
  durationSeconds: number | null,
): string | null {
  if (!isCurrentSource(source, current)) {
    return null;
  }
  if (progress.phase === "end") {
    return "Rendering 100%";
  }
  if (durationSeconds === null || progress.outTimeSeconds === undefined) {
    return null;
  }
  const ratio = Math.min(Math.max(progress.outTimeSeconds / durationSeconds, 0), 0.99);
  return `Rendering ${Math.round(ratio * 100)}%`;
}
