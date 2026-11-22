'use client';

import { useEffect, useRef, useState } from 'react';

type ProofState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'ready'; version: number };

export function useAuthProof() {
  const token = useRef<string | null>(null);
  const checked = useRef(false);
  const version = useRef(0);
  const [state, setState] = useState<ProofState>({ kind: 'loading' });

  useEffect(() => {
    function readFragment() {
      const { hash, pathname, search } = window.location;
      const params = new URLSearchParams(hash.slice(1));
      if (!params.has('token')) {
        // Strict Mode can re-run this effect after the fragment has been removed.
        if (!checked.current) {
          checked.current = true;
          setState({ kind: 'missing' });
        }
        return;
      }

      checked.current = true;
      // Keep the proof in memory. HTTP URLs, navigation props and persistent storage
      // must never receive it. Strip malformed proofs from the URL too.
      window.history.replaceState(null, '', pathname + search);
      const candidate = params.get('token');
      const valid = params.getAll('token').length === 1 && /^[a-f0-9]{64}$/.test(candidate ?? '');
      token.current = valid ? candidate : null;
      version.current += 1;
      setState(token.current ? { kind: 'ready', version: version.current } : { kind: 'invalid' });
    }

    readFragment();
    window.addEventListener('hashchange', readFragment);
    return () => window.removeEventListener('hashchange', readFragment);
  }, []);

  return {
    state,
    read: () => token.current,
    discard: (submittedToken: string) => {
      if (token.current === submittedToken) token.current = null;
    },
  };
}
