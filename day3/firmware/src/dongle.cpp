// IMmerseU dongle — day 3.
//
// Listens for ESP-NOW broadcasts on channel 1 and writes each payload to USB
// serial with a '\n' terminator. The wrist units send ready-to-parse CSV
// lines, so this sketch does zero parsing — it's a dumb, transparent
// wireless-to-USB relay (pattern lifted from Mark's esp32c6_relay).
//
// Any XIAO ESP32-S3 works. Plug into the laptop, open the boxing demo, click
// "Connect wrist," pick this dongle's /dev/ttyACM* port.

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

static const uint8_t ESPNOW_WIFI_CHANNEL = 1;
static const int LED_PIN = LED_BUILTIN;
static const int LED_ON_LEVEL = LOW;   // XIAO S3 onboard LED is active-LOW
static const uint32_t LED_BLINK_MS = 40;

static bool espnow_ready = false;
static uint32_t packets_recv = 0;
static uint32_t led_off_at = 0;
static bool led_lit = false;
static uint32_t last_recv_at = 0;
static uint32_t next_heartbeat_at = 0;

static void on_recv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len <= 0) return;
  packets_recv++;
  last_recv_at = millis();

  digitalWrite(LED_PIN, LED_ON_LEVEL);
  led_lit = true;
  led_off_at = millis() + LED_BLINK_MS;

  // Payload is plain ASCII CSV from the wrist. Pass it through verbatim +
  // append a newline; the browser reader splits on '\n'.
  Serial.write(data, len);
  Serial.write('\n');
}

void setup() {
  Serial.begin(115200);
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

  if (led_lit && (int32_t)(now - led_off_at) >= 0) {
    digitalWrite(LED_PIN, !LED_ON_LEVEL);
    led_lit = false;
  }

  if ((int32_t)(now - next_heartbeat_at) >= 0) {
    next_heartbeat_at += 2000;
    if (packets_recv > 0) {
      Serial.printf("# dongle alive  packets=%lu  since_last=%.1fs\n",
                    (unsigned long)packets_recv,
                    (now - last_recv_at) / 1000.0f);
    } else {
      Serial.printf("# dongle alive  no wrist packets seen yet (channel=%d)\n",
                    ESPNOW_WIFI_CHANNEL);
    }
  }
}
