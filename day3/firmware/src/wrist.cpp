// IMmerseU wrist unit — day 3 wireless build.
//
// Reads MPU6050/6500 at 200Hz, complementary-filters roll/pitch, broadcasts each
// sample as an ASCII CSV line over ESP-NOW. Any dongle on the same channel picks
// it up and writes it to USB serial for the browser to consume.
//
// Compile-time ARM_ID (0 = right arm, 1 = left arm) is prefixed to every line
// so a single dongle can multiplex two wristbands into one serial stream.
//
// Line format (identical to day1 except for the leading ARM_ID):
//   arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch
//   accel m/s², gyro deg/s, roll/pitch degrees.
//
// Set ARM_ID via platformio.ini build_flags (-DARM_ID=0 or 1).

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_mac.h>
#include "mpu.h"

// Chip-unique arm identifier derived from the last 2 bytes of the WiFi MAC.
// One firmware image → any wristband. Pairing on the browser side treats the
// integer as opaque and assigns slot A/B by order-of-shake.
static uint32_t arm_id = 0;

// Both wrist units and the dongle must agree on this channel.
static const uint8_t ESPNOW_WIFI_CHANNEL = 1;
static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

static const uint32_t SAMPLE_HZ = 200;
static const uint32_t SAMPLE_PERIOD_US = 1000000UL / SAMPLE_HZ;
static const float COMP_ALPHA = 0.98f;

static float roll_deg = 0, pitch_deg = 0;
static uint32_t last_us = 0;
static bool espnow_ready = false;

// Fired when a send completes — used only to notice persistent failure.
static uint32_t send_fail_count = 0;
// Newer arduino-esp32 changed the callback signature: mac address is now
// inside wifi_tx_info_t. Keep support for both by using the current one.
static void on_send(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  (void)info;
  if (status != ESP_NOW_SEND_SUCCESS) send_fail_count++;
}

static bool init_espnow() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  // Turn off WiFi power-save. On the S3 the default modem-sleep drops
  // ~half of a sustained 200 Hz ESP-NOW stream — the C3 doesn't seem to
  // hit this because its power-save timings are different. Cost is a
  // few extra mA of idle current, well worth the reliability.
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(ESPNOW_WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_send_cb(on_send);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = ESPNOW_WIFI_CHANNEL;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;
  return true;
}

static uint32_t broadcast_count = 0;
static uint32_t next_heartbeat_ms = 0;

// Send an already-formatted line (payload should NOT include trailing '\n' —
// the dongle appends one when it prints).
static void broadcast(const char *payload, size_t len) {
  if (!espnow_ready) return;
  // ESP-NOW max payload is 250 bytes; our lines are ~70 chars — well under.
  esp_now_send(BROADCAST_MAC, (const uint8_t *)payload, len);
}

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 1500) delay(10);

  // Derive our arm_id from the chip's WiFi MAC — unique per board, no
  // compile-time env needed. Last 2 bytes give us a 16-bit slot; collisions
  // are astronomically unlikely at demo scale (~1 in 65k across 2 boards).
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  arm_id = ((uint32_t)mac[4] << 8) | mac[5];

  uint8_t who = mpu::begin_full_range();
  Serial.printf("# arm=%u mac=%02X:%02X:%02X:%02X:%02X:%02X WHO_AM_I=0x%02X (0x68=MPU6050, 0x70=MPU6500, 0xFF=nothing on bus)\n",
                arm_id, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], who);

  // I2C bus scan so we can tell "wrong pin" from "no device" at a glance.
  Serial.print("# i2c scan:");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" 0x%02X", addr);
      found++;
    }
  }
  Serial.printf("  (%d device%s found)\n", found, found == 1 ? "" : "s");

  espnow_ready = init_espnow();
  Serial.printf("# ESP-NOW %s on channel %d\n",
                espnow_ready ? "ready" : "FAILED",
                ESPNOW_WIFI_CHANNEL);

  // Seed roll/pitch from initial accel so the filter starts sensible.
  int16_t ax_r, ay_r, az_r, gx_r, gy_r, gz_r;
  mpu::read_all(ax_r, ay_r, az_r, gx_r, gy_r, gz_r);
  float ax = ax_r / mpu::ACCEL_LSB_PER_MS2;
  float ay = ay_r / mpu::ACCEL_LSB_PER_MS2;
  float az = az_r / mpu::ACCEL_LSB_PER_MS2;
  roll_deg  = atan2f(ay, az) * 180.0f / PI;
  pitch_deg = atan2f(-ax, sqrtf(ay*ay + az*az)) * 180.0f / PI;

  last_us = micros();
  Serial.printf("# columns: arm,t_us,ax,ay,az,gx,gy,gz,roll,pitch\n");
  Serial.printf("# arm_id is the last two MAC bytes; same firmware runs on every wristband.\n");
}

static char line_buf[96];

void loop() {
  uint32_t now = micros();
  if ((uint32_t)(now - last_us) < SAMPLE_PERIOD_US) return;
  float dt = (now - last_us) * 1e-6f;
  last_us = now;

  int16_t ax_r, ay_r, az_r, gx_r, gy_r, gz_r;
  mpu::read_all(ax_r, ay_r, az_r, gx_r, gy_r, gz_r);

  float ax = ax_r / mpu::ACCEL_LSB_PER_MS2;
  float ay = ay_r / mpu::ACCEL_LSB_PER_MS2;
  float az = az_r / mpu::ACCEL_LSB_PER_MS2;
  float gx = gx_r / mpu::GYRO_LSB_PER_DPS;
  float gy = gy_r / mpu::GYRO_LSB_PER_DPS;
  float gz = gz_r / mpu::GYRO_LSB_PER_DPS;

  float roll_acc  = atan2f(ay, az) * 180.0f / PI;
  float pitch_acc = atan2f(-ax, sqrtf(ay*ay + az*az)) * 180.0f / PI;

  roll_deg  = COMP_ALPHA * (roll_deg  + gx * dt) + (1.0f - COMP_ALPHA) * roll_acc;
  pitch_deg = COMP_ALPHA * (pitch_deg + gy * dt) + (1.0f - COMP_ALPHA) * pitch_acc;

  int n = snprintf(line_buf, sizeof(line_buf),
                   "%u,%lu,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.2f,%.2f",
                   (unsigned)arm_id, (unsigned long)now,
                   ax, ay, az, gx, gy, gz, roll_deg, pitch_deg);
  if (n > 0 && n < (int)sizeof(line_buf)) {
    broadcast(line_buf, (size_t)n);
    broadcast_count++;
  }

  // Heartbeat every 2 s — but ONLY when a USB host has actually opened the
  // CDC port. Otherwise Serial.printf writes into a soft ring buffer that
  // blocks the loop the moment it fills, which starves ESP-NOW broadcasts
  // and shows up as "the S3 wristband takes forever to pair" untethered.
  // The C3's built-in USB-JTAG bridge doesn't have this failure mode.
  uint32_t now_ms = millis();
  if ((int32_t)(now_ms - next_heartbeat_ms) >= 0) {
    next_heartbeat_ms = now_ms + 2000;
    if (Serial) {
      Serial.printf("# wrist alive arm=%u sent=%lu fails=%lu\n",
                    (unsigned)arm_id,
                    (unsigned long)broadcast_count,
                    (unsigned long)send_fail_count);
    }
  }
}
