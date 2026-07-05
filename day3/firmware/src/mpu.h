// MPU6050/6500 minimal driver — raw I2C, no vendor lib.
// Works with either chip (register-compatible for basic accel + gyro).
//
// Wiring (XIAO ESP32-S3): SDA=D4/GPIO5, SCL=D5/GPIO6, VCC=3V3, AD0 float -> 0x68.
#pragma once

#include <Arduino.h>
#include <Wire.h>

namespace mpu {

static const uint8_t ADDR = 0x68;
static const uint8_t REG_SMPLRT_DIV    = 0x19;
static const uint8_t REG_CONFIG        = 0x1A;
static const uint8_t REG_GYRO_CONFIG   = 0x1B;
static const uint8_t REG_ACCEL_CONFIG  = 0x1C;
static const uint8_t REG_ACCEL_CONFIG2 = 0x1D;
static const uint8_t REG_ACCEL_XOUT_H  = 0x3B;
static const uint8_t REG_PWR_MGMT_1    = 0x6B;
static const uint8_t REG_WHO_AM_I      = 0x75;

// ±16g full-scale -> 2048 LSB/g; ±2000 dps -> 16.4 LSB/dps.
static const float ACCEL_LSB_PER_MS2 = 2048.0f / 9.80665f;
static const float GYRO_LSB_PER_DPS  = 16.4f;

inline void wr(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}
inline uint8_t rd(uint8_t reg) {
  Wire.beginTransmission(ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(ADDR, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0xFF;
}

// Read the 14-byte accel+temp+gyro block starting at ACCEL_XOUT_H.
inline void read_all(int16_t &ax, int16_t &ay, int16_t &az,
                     int16_t &gx, int16_t &gy, int16_t &gz) {
  Wire.beginTransmission(ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom(ADDR, (uint8_t)14);
  uint8_t b[14];
  for (int i = 0; i < 14 && Wire.available(); i++) b[i] = Wire.read();
  ax = (int16_t)((b[0]  << 8) | b[1]);
  ay = (int16_t)((b[2]  << 8) | b[3]);
  az = (int16_t)((b[4]  << 8) | b[5]);
  gx = (int16_t)((b[8]  << 8) | b[9]);
  gy = (int16_t)((b[10] << 8) | b[11]);
  gz = (int16_t)((b[12] << 8) | b[13]);
}

// Init sequence — same for MPU6050 and MPU6500. Returns WHO_AM_I byte.
//
// Pins can be overridden per-env in platformio.ini via build_flags:
//   -DMPU_SDA_PIN=<gpio> -DMPU_SCL_PIN=<gpio>
// If not defined, Wire uses whatever the board variant declares as default
// (SDA/SCL on the pin labeled D4 / D5 on both XIAO S3 and XIAO C3).
inline uint8_t begin_full_range() {
#if defined(MPU_SDA_PIN) && defined(MPU_SCL_PIN)
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
#else
  Wire.begin();
#endif
  Wire.setClock(400000);
  uint8_t who = rd(REG_WHO_AM_I);
  wr(REG_PWR_MGMT_1, 0x80); delay(100);   // reset
  wr(REG_PWR_MGMT_1, 0x01); delay(20);    // wake, PLL on gyro X
  wr(REG_SMPLRT_DIV,    0x00);            // 1kHz / (1+0)
  wr(REG_CONFIG,        0x02);            // gyro DLPF ~92 Hz
  wr(REG_GYRO_CONFIG,   0x18);            // ±2000 dps
  wr(REG_ACCEL_CONFIG,  0x18);            // ±16 g
  wr(REG_ACCEL_CONFIG2, 0x02);            // accel DLPF ~92 Hz (6500 only, 6050 ignores)
  return who;
}

} // namespace mpu
