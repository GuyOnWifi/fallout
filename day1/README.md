# day1 — feature stream + data collection

Goal of day 1: a trustworthy IMU feature stream from one wrist unit, and enough
labeled reps to set classifier thresholds from real numbers instead of guessing.

## Wiring (XIAO ESP32-S3 + GY-521 / MPU6050)

| MPU6050 pin | XIAO pin        |
|-------------|-----------------|
| VCC         | 3V3 (3.3V-OUT)  |
| GND         | GND             |
| SDA         | D4 / GPIO5      |
| SCL         | D5 / GPIO6      |
| AD0         | floating (0x68) |
| INT/XDA/XCL/FSYNC | leave open |

Board flat against the dorsal (back) side of the forearm, USB-C pointing
toward the elbow. Axis convention documented at the top of the project brief.

## Flash the wrist firmware

```
cd day1/firmware
pio run -e wrist -t upload
pio device monitor -e wrist
```

You should see CSV like:

```
# IMmerseU wrist feature stream
# columns: t_us,ax,ay,az,gx,gy,gz,roll,pitch
12345678,0.12,-0.04,9.79,0.31,-0.10,0.02,-0.24,0.71
...
```

If `Serial` prints nothing, verify `ARDUINO_USB_CDC_ON_BOOT=1` is in
`platformio.ini` (it is) and the device shows up as `/dev/ttyACM0`.

## Collect labeled reps

Close the serial monitor first (only one process can open the port).

```
cd day1/tools
python -m venv .venv && source .venv/bin/activate
pip install pyserial numpy pandas matplotlib

python collect.py --port /dev/ttyACM0 --label jab      --n 20 --out data/jab.csv
python collect.py --port /dev/ttyACM0 --label hook     --n 20 --out data/hook.csv
python collect.py --port /dev/ttyACM0 --label uppercut --n 20 --out data/uppercut.csv
python collect.py --port /dev/ttyACM0 --label block    --n 20 --out data/block.csv
python collect.py --port /dev/ttyACM0 --label idle     --n 20 --out data/idle.csv
```

Press ENTER *at* the moment of the gesture — the tool grabs a window around
that press (~0.2 s before, ~0.4 s after).

## Look at the data

```
python plot.py data/jab.csv data/hook.csv data/uppercut.csv data/block.csv data/idle.csv
```

Prints per-rep peak magnitudes and shows time-series overlays + box plots.
Use those numbers to set the classifier thresholds in the next step.
