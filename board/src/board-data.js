import fallbackBoard from './demo-board.json';

export { fallbackBoard };
export const currentUserId = import.meta.env.VITE_BOARD_USER_ID?.trim() || null;

const defaultBaseUrl = import.meta.env.DEV ? 'https://poster-montreal-feedback-von.trycloudflare.com' : '';
const apiBaseUrl = (import.meta.env.VITE_BOARD_API_BASE_URL?.trim()
  || defaultBaseUrl).replace(/\/+$/, '');
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

export function pollBoardData(onSnapshot) {
  async function poll() {
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
