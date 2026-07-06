// Minimal Web Serial line reader.
// Chromium-only (Edge/Chrome). Firefox/Safari do not implement Web Serial.

export async function openSerial({ baud, onLine, onOpen, onClose, onError }) {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial not available. Use Chromium (Chrome/Edge/Brave).');
  }

  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: baud });
  onOpen && onOpen();

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(err => onError && onError(err));
  const reader = decoder.readable.getReader();

  let buf = '';
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) onLine(line);
        }
      }
    } catch (err) {
      onError && onError(err);
    } finally {
      onClose && onClose();
    }
  })();

  return port;
}
