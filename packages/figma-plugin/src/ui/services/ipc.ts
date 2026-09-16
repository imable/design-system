import type { MainToUIMessage, UIToMainMessage } from '../../shared/types';

type Listener = (message: MainToUIMessage) => void;

const listeners = new Set<Listener>();

window.onmessage = (event: MessageEvent) => {
  const message = event.data?.pluginMessage as MainToUIMessage | undefined;
  if (!message) return;
  listeners.forEach((listener) => listener(message));
};

export function postToMain(message: UIToMainMessage): void {
  // `message` may hold a Vue reactive Proxy (e.g. the Pinia settings state sent
  // via 'save-settings') - `postMessage` structured-clones its payload, and a
  // Proxy fails that clone (`DataCloneError: ... could not be cloned`), which
  // silently drops the message before it ever reaches main. Stripping
  // reactivity through a JSON round-trip first guarantees a plain, cloneable
  // payload.
  parent.postMessage({ pluginMessage: JSON.parse(JSON.stringify(message)) }, '*');
}

/** Subscribes to every message from the main thread. Returns an unsubscribe function. */
export function onMainMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let nextRequestId = 0;

/** Sends a message to main and resolves once a message matching `match` arrives. */
export function requestFromMain<T extends MainToUIMessage>(
  message: UIToMainMessage,
  match: (response: MainToUIMessage) => response is T,
): Promise<T> {
  return new Promise((resolve) => {
    const unsubscribe = onMainMessage((response) => {
      if (match(response)) {
        unsubscribe();
        resolve(response);
      }
    });
    postToMain(message);
  });
}

export function createRequestId(): string {
  nextRequestId += 1;
  return `req_${Date.now()}_${nextRequestId}`;
}
