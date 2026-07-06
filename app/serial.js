// Minimal Web Serial line reader. Chromium-only.
//
// Two entry points:
//   openSerial(...)      — user gesture, opens the picker if we don't have a
//                          previously-authorized port. Called from the click
//                          handler on the "connect hub" button.
//   autoOpenSerial(...)  — no user gesture, silently opens the first port we
//                          already have permission for. Returns null if
//                          nothing is authorized yet (fall back to a picker).
//
// The auto path means "connect hub" is only needed the first time. Every
// game after that will reconnect on its own when the page loads.

function pipeReader(port, onLine, onClose, onError) {
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
}

// Try to open a previously-granted port without prompting. Returns the port
// on success, null if none are authorized yet.
export async function autoOpenSerial({ baud, onLine, onOpen, onClose, onError }) {
  if (!('serial' in navigator)) return null;
  const ports = await navigator.serial.getPorts();
  if (!ports.length) return null;
  const port = ports[0];
  try {
    await port.open({ baudRate: baud });
  } catch (err) {
    // Port already open in another tab, or transiently unavailable.
    onError && onError(err);
    return null;
  }
  onOpen && onOpen();
  pipeReader(port, onLine, onClose, onError);
  return port;
}

// Explicit user-driven connect. Opens the picker if no ports are known.
export async function openSerial({ baud, onLine, onOpen, onClose, onError }) {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial not available. Use Chromium (Chrome/Edge/Brave).');
  }
  // Prefer a previously-authorized port so the picker doesn't pop up every time.
  const known = await navigator.serial.getPorts();
  const port = known[0] || await navigator.serial.requestPort();
  await port.open({ baudRate: baud });
  onOpen && onOpen();
  pipeReader(port, onLine, onClose, onError);
  return port;
}
