export const AI_TIMEOUT_MS = 15_000;

// Deadline includes fetch AND response-body parsing. The race also settles if a
// proxy/mock ignores AbortSignal. Late responses cannot overwrite the fallback.
export async function requestWithDeadline(run, { signal, timeoutMs = AI_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timer;
  let cancel;
  const stop = new Promise((_, reject) => {
    cancel = () => {
      reject(new DOMException('Request cancelled', 'AbortError'));
      controller.abort();
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      reject(new Error('AI response deadline exceeded'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([stop, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      return run(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
