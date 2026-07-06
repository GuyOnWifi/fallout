# Soup Sports

Nothing like spending your last days on Earth soup! I mean just look at him!!

## Minigames

### Boxing

Fight soup

![Boxing](docs/img/boxing.png)

![Jab Block](docs/img/boxing-jab-block.png)

### Tennis

Fight each other in this classic ball sport!

![Tennis](docs/img/tennis.png)

![Tennis shoot](docs/img/tennis-shoot.png)

### Badminton

Like tennis but Asian! For those wanting a slower game.

![Badminton](docs/img/badminton.png)

### Ping Pong

Like tennis but smaller! For people wanting a quicker reflex game.

![PingPong](docs/img/pingpong.png)

### Soup Ninja

Like fruit ninja but avoid cutting soup D:

![SoupNinja](docs/img/soup-ninja.png)

### Soup Bomb

Try to beat soup as many times before he get angi D:<

![SoupBomb](docs/img/soup-bomb.png)

## Hardware

Soup Sports is played using motion trackers made of a Seeed Studio Xiao ESP32 C3 and an MPU 5060 accelerometer. The tracker is powered using a 1500mAh LiPo cell, managed by the ESP. The tracker is mounted inside a 3D printed case mounted onto the users arm, just below the wrist. It mounts easily using wide zip ties, but is designed for velcro or other reusable methods that insert into the gap and easily stay there.

![Motion Tracker](docs/img/motion-tracker.png)

## Architecture

```
   ┌─────────────┐         ┌─────────────┐
   │  wristband  │         │  wristband  │     XIAO ESP32-S3 (or C3)
   │   (any)     │         │   (any)     │     + MPU6500 IMU
   │  ▄▄▄▄▄▄▄▄▄  │         │  ▄▄▄▄▄▄▄▄▄  │     + LiPo
   └──────┬──────┘         └──────┬──────┘
          │                       │
          │   ESP-NOW broadcast   │             2.4 GHz, channel 1
          │   200 Hz IMU samples  │             no pairing, no Wi-Fi
          │                       │
          └───────────┬───────────┘
                      ▼
              ┌───────────────┐
              │    dongle     │                 XIAO ESP32-S3
              │   (USB CDC)   │                 no sensor
              └───────┬───────┘
                      │  serial CSV
                      ▼
              ┌───────────────┐
              │    browser    │                 Chromium, Web Serial
              │  Three.js UI  │                 six minigames
              └───────────────┘
```

Wire format: `arm_id, t_us, ax, ay, az, gx, gy, gz, roll, pitch\n`. Newline-terminated ASCII. `arm_id` is the low 16 bits of the chip's WiFi MAC — chip-unique, no compile-time provisioning.

## How to run

```bash
# 1. Flash the firmware. One binary works on any wristband — the arm_id
#    derives from the chip's MAC at boot.
cd firmware
pio run -e wrist    -t upload --upload-port /dev/ttyACM0   # S3 wristband
pio run -e wrist_c3 -t upload --upload-port /dev/ttyACM0   # C3 wristband
pio run -e dongle   -t upload --upload-port /dev/ttyACM0   # dongle

# 2. Start the browser side.
cd ../app
python3 -m http.server 8123
# open http://localhost:8123 in Chromium (needs Web Serial)

# 3. Click "connect hub", pick the dongle's /dev/ttyACM* port, wave a
#    wristband. It claims slot A. Wave another one to claim slot B.
#    Pick a game from the grid.
```

## Repo layout

```
app/            browser games + shared modules (classifier, pairing, sfx, loader)
firmware/       platformio project — one env per role (wrist, wrist_c3, dongle)
tools/          Python data collector + Node replay harness
enclosure/      3D-printable STL files for the wristband cases
docs/img/       screenshots used in this README
_archive/       personal/internal docs, older snapshots, mascot workshop
GESTURES.md     what each game needs from the wristband
```
