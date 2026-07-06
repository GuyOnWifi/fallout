// Pin sweep diagnostic for XIAO ESP32-C3.
//
// Walks every reasonable pair of exposed GPIOs, reinitializes Wire with
// (SDA=a, SCL=b), and runs an I2C address scan. Prints any hits.
//
// If NOTHING responds across all pairs, the sensor is not receiving power
// or is dead. If SOMETHING responds on some pair, you now know which
// physical pins the SDA/SCL wires actually landed on.
//
// Safe pins on the XIAO C3 (label → GPIO):
//   D0=2  D1=3  D2=4  D3=5  D4=6  D5=7  D6=21  D7=20  D10=10
// Avoided: GPIO8/9 (bootstrap), GPIO18/19 (USB D+/D-).

#include <Arduino.h>
#include <Wire.h>

static const int SAFE_PINS[] = { 2, 3, 4, 5, 6, 7, 10, 20, 21 };
static const int N_PINS = sizeof(SAFE_PINS) / sizeof(SAFE_PINS[0]);

static int labelForGpio(int gpio) {
  switch (gpio) {
    case 2: return 0;   // D0
    case 3: return 1;   // D1
    case 4: return 2;   // D2
    case 5: return 3;   // D3
    case 6: return 4;   // D4
    case 7: return 5;   // D5
    case 21: return 6;  // D6
    case 20: return 7;  // D7
    case 10: return 10; // D10
    default: return -1;
  }
}

static int scan_pair(int sda, int scl) {
  Wire.end();
  delay(10);
  // C3 does not enable internal pull-ups on Wire.begin (issue #6376).
  // Force them on so a breakout with weak/no external pull-ups can still
  // pull the bus low. Also releases any old routing on these pins.
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  delay(2);
  if (!Wire.begin(sda, scl)) {
    return -1;   // could not initialize on this pair
  }
  Wire.setClock(100000);
  // Hard 5ms per-transaction timeout so a floating bus can't stall the sweep.
  Wire.setTimeOut(5);
  delay(5);
  int found = 0;
  int firstAddr = -1;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      if (firstAddr < 0) firstAddr = addr;
      found++;
    }
  }
  return found > 0 ? firstAddr : 0;
}

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 3000) delay(10);
  delay(500);

  Serial.println();
  Serial.println("# ==== C3 pin-sweep diagnostic ====");
  Serial.printf ("# testing %d GPIOs, %d ordered pairs total\n",
                 N_PINS, N_PINS * (N_PINS - 1));
  Serial.println("# format: SDA(label/gpio) SCL(label/gpio) -> N devices, first addr");
  Serial.println();

  int totalHits = 0;
  for (int i = 0; i < N_PINS; i++) {
    for (int j = 0; j < N_PINS; j++) {
      if (i == j) continue;
      int sda = SAFE_PINS[i], scl = SAFE_PINS[j];
      int result = scan_pair(sda, scl);
      if (result > 0) {
        Serial.printf("HIT  SDA=D%d(GPIO%d)  SCL=D%d(GPIO%d)  first_addr=0x%02X\n",
                      labelForGpio(sda), sda,
                      labelForGpio(scl), scl, result);
        totalHits++;
      }
    }
  }

  Serial.println();
  if (totalHits == 0) {
    Serial.println("# ==== NO DEVICES FOUND ON ANY PAIR ====");
    Serial.println("# The MPU is not getting power, has no GND, or the chip is dead.");
    Serial.println("# Next: multimeter check VCC vs GND on the MPU (should be ~3.3V).");
  } else {
    Serial.printf ("# %d pair%s responded. Solder your SDA to the SDA-side label, SCL to the SCL-side label.\n",
                   totalHits, totalHits == 1 ? "" : "s");
  }
  Serial.println("# ==== sweep done ====");
}

void loop() {
  // Idle. Sweep runs once at boot.
  delay(1000);
}
