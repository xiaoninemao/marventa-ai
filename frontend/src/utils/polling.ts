export function startPolling<T>({
  load,
  onResult,
  onError,
  interval = 3000,
}: {
  load: () => Promise<T>;
  onResult: (result: T) => boolean;
  onError: (error: unknown) => void;
  interval?: number;
}): () => void {
  let stopped = false;
  let errorReported = false;
  let timer: ReturnType<typeof setTimeout>;

  const poll = async () => {
    try {
      const result = await load();
      if (stopped) return;
      errorReported = false;
      if (!onResult(result)) return;
    } catch (error) {
      if (stopped) return;
      if (!errorReported) {
        errorReported = true;
        onError(error);
      }
    }
    if (!stopped) timer = setTimeout(() => void poll(), interval);
  };

  timer = setTimeout(() => void poll(), interval);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
