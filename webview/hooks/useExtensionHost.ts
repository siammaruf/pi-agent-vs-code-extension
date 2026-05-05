import { useEffect, useCallback, useRef } from 'react';
import { getVsCodeApi } from '../vscodeApi';

export function useExtensionHost() {
  const vscodeRef = useRef<ReturnType<typeof getVsCodeApi>>();

  if (!vscodeRef.current) {
    vscodeRef.current = getVsCodeApi();
  }

  const postMessage = useCallback((message: unknown) => {
    vscodeRef.current?.postMessage(message);
  }, []);

  return { postMessage };
}

export function useExtensionMessages<T = unknown>(handler: (message: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MessageEvent<T>) => {
      handlerRef.current(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
}
