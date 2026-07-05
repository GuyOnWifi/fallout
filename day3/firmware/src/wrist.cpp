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
#include "mpu.h"

#ifndef ARM_ID
#define ARM_ID 0
#endif

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

  uint8_t who = mpu::begin_full_range();
  Serial.printf("# arm=%d WHO_AM_I=0x%02X (0x68=MPU6050, 0x70=MPU6500)\n", ARM_ID, who);

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
                   "%d,%lu,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.2f,%.2f",
                   ARM_ID, (unsigned long)now,
                   ax, ay, az, gx, gy, gz, roll_deg, pitch_deg);
  if (n > 0 && n < (int)sizeof(line_buf)) {
    broadcast(line_buf, (size_t)n);
  }
}
