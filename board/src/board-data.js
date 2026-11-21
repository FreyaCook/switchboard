import fallbackBoard from './demo-board.json';

export { fallbackBoard };

function readCurrentUserId() {
  try {
    const stored = window.localStorage.getItem('switchboardPersonId')?.trim();
    if (stored) return stored;
  } catch {
    // localStorage can be unavailable; fall back to the build-time id.
  }
  return import.meta.env.VITE_BOARD_USER_ID?.trim() || null;
}

// Live binding: re-read from localStorage on every poll.
export let currentUserId = readCurrentUserId();

const apiBaseUrl = (import.meta.env.VITE_BOARD_API_BASE_URL?.trim() || '').replace(/\/+$/, '');
const pollInterval = 2000;

export async function loadBoardData() {
  const response = await fetch(`${apiBaseUrl}/api/board`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error(`Board API returned ${response.status}`);
  const snapshot = await response.json();
  if (!Array.isArray(snapshot?.people) || !Array.isArray(snapshot.connections)
      || !Array.isArray(snapshot.lines)) {
    throw new Error('Invalid board snapshot');
  }
  return snapshot;
}

export async function loadPulse() {
  const response = await fetch(`${apiBaseUrl}/api/pulse`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error(`Pulse API returned ${response.status}`);
  const pulse = await response.json();
  if (!pulse || typeof pulse.onAirByLine !== 'object' || pulse.onAirByLine === null) {
    throw new Error('Invalid pulse');
  }
  return pulse;
}

export function pollBoardData(onSnapshot) {
  async function poll() {
    currentUserId = readCurrentUserId();
    try {
      // Retain the displayed snapshot during outages, including the startup fixture if needed.
      const snapshot = await loadBoardData().catch(() => null);
      if (snapshot) onSnapshot(snapshot);
    } finally {
      window.setTimeout(poll, pollInterval);
    }
  }

  window.setTimeout(poll, pollInterval);
}
