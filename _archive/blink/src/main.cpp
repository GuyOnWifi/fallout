#include <Arduino.h>
#include "driver/gpio.h"

// XIAO ESP32-S3 onboard user LED: GPIO 21, ACTIVE LOW (LOW = on).
static constexpr gpio_num_t LED = GPIO_NUM_21;

void setup() {
  Serial.begin(115200);
  gpio_set_direction(LED, GPIO_MODE_OUTPUT);
}

void loop() {
  gpio_set_level(LED, 0);   // on
  delay(500);
  gpio_set_level(LED, 1);   // off
  delay(500);
  Serial.println("blink");
}
