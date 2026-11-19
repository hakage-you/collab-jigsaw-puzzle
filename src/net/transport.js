import { PeerJsTransport } from './peerJsTransport.js';
import { LocalChannelTransport } from './localChannelTransport.js';

export function getTransportModeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('transport') === 'local' ? 'local' : 'peerjs';
  } catch {
    return 'peerjs';
  }
}

export function createTransport(mode = getTransportModeFromUrl()) {
  if (mode === 'local') {
    return new LocalChannelTransport();
  }
  return new PeerJsTransport();
}
