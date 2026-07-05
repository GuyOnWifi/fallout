// IMmerseU — wrist unit, day 1
// Streams raw IMU + complementary-filter roll/pitch as CSV over USB serial.
// Works with both MPU6050 (WHO_AM_I=0x68) and MPU6500 (WHO_AM_I=0x70) — the
// GY-521 boards on the market ship with either. Register map is compatible for
// basic accel+gyro so we drive it directly with Wire instead of a vendor lib.
//
// Wiring (XIAO ESP32-S3):
//   SDA -> D4 (GPIO5), SCL -> D5 (GPIO6), VCC -> 3V3, GND -> GND, AD0 floating.
//
// Output (CSV, one line/sample @ 200Hz):
//   t_us,ax,ay,az,gx,gy,gz,roll,pitch
//   accel m/s², gyro deg/s, roll/pitch degrees.

#include <Arduino.h>
#include <Wire.h>

static const uint8_t MPU_ADDR = 0x68;
// Register map (shared between MPU6050 / MPU6500).
static const uint8_t REG_SMPLRT_DIV   = 0x19;
static const uint8_t REG_CONFIG       = 0x1A; // gyro DLPF
static const uint8_t REG_GYRO_CONFIG  = 0x1B; // FS_SEL
static const uint8_t REG_ACCEL_CONFIG = 0x1C; // AFS_SEL
static const uint8_t REG_ACCEL_CONFIG2= 0x1D; // MPU6500 accel DLPF (ignored by 6050)
static const uint8_t REG_ACCEL_XOUT_H = 0x3B;
static const uint8_t REG_PWR_MGMT_1   = 0x6B;
static const uint8_t REG_WHO_AM_I     = 0x75;

// ±16g -> 2048 LSB/g; ±2000 dps -> 16.4 LSB/(dps).
static const float ACCEL_LSB_PER_MS2 = 2048.0f / 9.80665f;
static const float GYRO_LSB_PER_DPS  = 16.4f;

static const uint32_t SAMPLE_HZ = 200;
static const uint32_t SAMPLE_PERIOD_US = 1000000UL / SAMPLE_HZ;
static const float COMP_ALPHA = 0.98f;

static float roll_deg = 0, pitch_deg = 0;
static uint32_t last_us = 0;

static void wr(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}
static uint8_t rd(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0xFF;
}

// Read 14 bytes (accel xyz, temp, gyro xyz) starting at ACCEL_XOUT_H.
static void read_all(int16_t &ax, int16_t &ay, int16_t &az,
                     int16_t &gx, int16_t &gy, int16_t &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(REG_ACCEL_XOUT_H);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (uint8_t)14);
  uint8_t b[14];
  for (int i = 0; i < 14 && Wire.available(); i++) b[i] = Wire.read();
  ax = (int16_t)((b[0]  << 8) | b[1]);
  ay = (int16_t)((b[2]  << 8) | b[3]);
  az = (int16_t)((b[4]  << 8) | b[5]);
  // b[6..7] = temp — skip
  gx = (int16_t)((b[8]  << 8) | b[9]);
  gy = (int16_t)((b[10] << 8) | b[11]);
  gz = (int16_t)((b[12] << 8) | b[13]);
}

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 1500) delay(10);

  Wire.begin();
  Wire.setClock(400000);

  uint8_t who = rd(REG_WHO_AM_I);
  Serial.printf("# WHO_AM_I = 0x%02X (0x68=MPU6050, 0x70=MPU6500, 0x71=MPU9250)\n", who);
  if (who != 0x68 && who != 0x70 && who != 0x71 && who != 0x73) {
    Serial.println("# WARN: unknown chip; register writes will still be attempted.");
  }

  wr(REG_PWR_MGMT_1, 0x80); delay(100);       // reset
  wr(REG_PWR_MGMT_1, 0x01); delay(20);        // wake, PLL on gyro X
  wr(REG_SMPLRT_DIV, 0x00);                   // 1kHz internal / (1+0)
  wr(REG_CONFIG,       0x02);                 // gyro DLPF ~92 Hz — keeps punch edges
  wr(REG_GYRO_CONFIG,  0x18);                 // ±2000 dps
  wr(REG_ACCEL_CONFIG, 0x18);                 // ±16 g
  wr(REG_ACCEL_CONFIG2,0x02);                 // accel DLPF ~92 Hz (MPU6500 only; 6050 ignores)

  // Seed filter from initial accel.
  int16_t ax_r, ay_r, az_r, gx_r, gy_r, gz_r;
  read_all(ax_r, ay_r, az_r, gx_r, gy_r, gz_r);
  float ax = ax_r / ACCEL_LSB_PER_MS2;
  float ay = ay_r / ACCEL_LSB_PER_MS2;
  float az = az_r / ACCEL_LSB_PER_MS2;
  roll_deg  = atan2f(ay, az) * 180.0f / PI;
  pitch_deg = atan2f(-ax, sqrtf(ay*ay + az*az)) * 180.0f / PI;

  last_us = micros();
  Serial.println("# IMmerseU wrist feature stream");
  Serial.println("# columns: t_us,ax,ay,az,gx,gy,gz,roll,pitch");
}

void loop() {
  uint32_t now = micros();
  if ((uint32_t)(now - last_us) < SAMPLE_PERIOD_US) return;
  float dt = (now - last_us) * 1e-6f;
  last_us = now;

  int16_t ax_r, ay_r, az_r, gx_r, gy_r, gz_r;
  read_all(ax_r, ay_r, az_r, gx_r, gy_r, gz_r);

  float ax = ax_r / ACCEL_LSB_PER_MS2;
  float ay = ay_r / ACCEL_LSB_PER_MS2;
  float az = az_r / ACCEL_LSB_PER_MS2;
  float gx = gx_r / GYRO_LSB_PER_DPS;
  float gy = gy_r / GYRO_LSB_PER_DPS;
  float gz = gz_r / GYRO_LSB_PER_DPS;

  float roll_acc  = atan2f(ay, az) * 180.0f / PI;
  float pitch_acc = atan2f(-ax, sqrtf(ay*ay + az*az)) * 180.0f / PI;

  roll_deg  = COMP_ALPHA * (roll_deg  + gx * dt) + (1.0f - COMP_ALPHA) * roll_acc;
  pitch_deg = COMP_ALPHA * (pitch_deg + gy * dt) + (1.0f - COMP_ALPHA) * pitch_acc;

  Serial.printf("%lu,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.2f,%.2f\n",
                (unsigned long)now, ax, ay, az, gx, gy, gz, roll_deg, pitch_deg);
}
