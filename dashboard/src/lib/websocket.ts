export function createLiveWatcher(
  sessionId: string,
  onEvents: (events: Record<string, unknown>[]) => void,
  onConnect: () => void,
  onDisconnect: () => void
): WebSocket {
  const ws = new WebSocket(`wss://${location.host}/ws/watch?sid=${sessionId}`);

  ws.onopen = () => onConnect();
  ws.onclose = () => onDisconnect();
  ws.onmessage = (e) => onEvents(JSON.parse(e.data));

  // Ping every 30s to keep alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);

  const originalClose = ws.close.bind(ws);
  ws.close = () => {
    clearInterval(pingInterval);
    originalClose();
  };

  return ws;
}
