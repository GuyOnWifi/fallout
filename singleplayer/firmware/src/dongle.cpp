// Soup Sports dongle, day 3.
//
// Listens for ESP-NOW broadcasts on channel 1, writes each payload to USB
// serial with a '\n' terminator. This sketch does zero parsing, the wrist
// units send ready-to-parse CSV lines.
//
// Design note. The ESP-NOW receive callback runs in the WiFi driver task.
// Calling Serial.write directly from that callback can block if USB CDC
// hasn't been drained by the host, which piles up latency, starves the
// WiFi driver, and eventually trips the task watchdog. Under sustained
// 200 Hz traffic that shows up as "the dongle crashes sometimes."
//
// Fix: on_recv copies each payload into a fixed-size ring buffer and
// returns immediately. loop() drains the ring to Serial in the main task,
// where blocking on Serial.write is safe.

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>

static const uint8_t  ESPNOW_WIFI_CHANNEL = 1;
static const int      LED_PIN       = LED_BUILTIN;
static const int      LED_ON_LEVEL  = LOW;    // XIAO S3 onboard LED is active-LOW
static const uint32_t LED_BLINK_MS  = 40;

// Ring buffer of pending payloads.
static const size_t RING_SLOTS = 32;   // 32 slots × 250 bytes = 8 KB, safe.
static const size_t MAX_PAYLOAD = 250; // ESP-NOW max
struct Slot { uint16_t len; uint8_t data[MAX_PAYLOAD]; };
static Slot ring[RING_SLOTS];
static volatile uint16_t head = 0;   // producer writes here
static volatile uint16_t tail = 0;   // consumer reads here
static portMUX_TYPE ringMux = portMUX_INITIALIZER_UNLOCKED;

static bool     espnow_ready = false;
static uint32_t packets_recv = 0;
static uint32_t packets_dropped = 0;
static uint32_t led_off_at = 0;
static bool     led_lit = false;
static uint32_t last_recv_at = 0;
static uint32_t next_heartbeat_at = 0;

static inline uint16_t ring_next(uint16_t i) {
  return (i + 1) % RING_SLOTS;
}

static void on_recv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len <= 0) return;
  packets_recv++;
  last_recv_at = millis();

  size_t copyLen = (size_t)len;
  if (copyLen > MAX_PAYLOAD) copyLen = MAX_PAYLOAD;

  // Producer side of the ring. Fast, no Serial calls, no delay.
  portENTER_CRITICAL_ISR(&ringMux);
  uint16_t nextHead = ring_next(head);
  if (nextHead == tail) {
    // Ring full. Drop this packet rather than block the WiFi task.
    packets_dropped++;
  } else {
    Slot &s = ring[head];
    s.len = (uint16_t)copyLen;
    memcpy(s.data, data, copyLen);
    head = nextHead;
  }
  portEXIT_CRITICAL_ISR(&ringMux);
}

void setup() {
  Serial.begin(115200);
  // Bump the USB CDC TX buffer so short bursts don't spill.
  Serial.setTxBufferSize(2048);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 3000) delay(10);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, !LED_ON_LEVEL);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(ESPNOW_WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    Serial.println("# ESP-NOW init FAILED");
    return;
  }
  esp_now_register_recv_cb(on_recv);
  espnow_ready = true;
  Serial.printf("# dongle ready, listening on channel %d\n", ESPNOW_WIFI_CHANNEL);
  next_heartbeat_at = millis() + 2000;
}

void loop() {
  uint32_t now = millis();

  // Drain the ring. Consumer side, runs in the main task where blocking
  // Serial.write is safe. Drains up to 16 slots per loop pass to avoid
  // starving other work if a big burst just landed.
  for (int drained = 0; drained < 16; drained++) {
    uint16_t localTail;
    portENTER_CRITICAL(&ringMux);
    if (tail == head) { portEXIT_CRITICAL(&ringMux); break; }
    localTail = tail;
    portEXIT_CRITICAL(&ringMux);

    const Slot &s = ring[localTail];
    Serial.write(s.data, s.len);
    Serial.write('\n');

    portENTER_CRITICAL(&ringMux);
    tail = ring_next(tail);
    portEXIT_CRITICAL(&ringMux);

    // Blink the LED off the drain path, one flash per drained packet.
    digitalWrite(LED_PIN, LED_ON_LEVEL);
    led_lit = true;
    led_off_at = now + LED_BLINK_MS;
  }

  if (led_lit && (int32_t)(now - led_off_at) >= 0) {
    digitalWrite(LED_PIN, !LED_ON_LEVEL);
    led_lit = false;
  }

  if ((int32_t)(now - next_heartbeat_at) >= 0) {
    next_heartbeat_at += 2000;
    uint16_t depth;
    portENTER_CRITICAL(&ringMux);
    depth = (head + RING_SLOTS - tail) % RING_SLOTS;
    portEXIT_CRITICAL(&ringMux);
    if (packets_recv > 0) {
      Serial.printf("# dongle alive  packets=%lu  dropped=%lu  ring=%u/%u  since_last=%.1fs\n",
                    (unsigned long)packets_recv,
                    (unsigned long)packets_dropped,
                    (unsigned)depth, (unsigned)RING_SLOTS,
                    (now - last_recv_at) / 1000.0f);
    } else {
      Serial.printf("# dongle alive  no wrist packets seen yet (channel=%d)\n",
                    ESPNOW_WIFI_CHANNEL);
    }
  }
}
