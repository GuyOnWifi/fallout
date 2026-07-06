# Soup Sports: 90-second talk track

## The pitch (30 seconds)

This is Soup Sports. Wii Sports without the Wii. You strap a wristband on,
you punch, you bowl, you swing a tennis racket, and a cartoon soup mascot
on screen does the same thing back. The wristband is a three-dollar
microcontroller and a one-dollar motion sensor. No console. No camera.
The whole arcade is a browser tab and a USB stick. Two players grab a
wristband, wave, and start playing. The cabinet is cardboard, a phone
mount, and a soup on the front. Costs less than lunch.

## The tech (45 seconds)

The clever bit is how we classify punches. The wristband streams two
hundred samples a second. But sensor axes rotate with your wrist, so a
hook one way looks like a jab another way. Raw axes are hopeless. So on
every sample we low-pass the accelerometer to find which way is down, and
project the reading into up, horizontal, and rotational parts. Those
features don't care how the strap sits. Then a peak-tracking state
machine arms on big motion, watches the peak grow, and commits the moment
the peak starts dropping. That catches the extension of a punch and
ignores the retraction. Thresholds were tuned against twenty recorded
reps per gesture, replayed offline. It runs entirely in the browser, in
about two hundred lines of JavaScript.

## The near future (15 seconds)

Next up is the cardboard cabinet build, cross-cabinet play by adding a
MAC filter in the USB dongle so neighboring machines stop cross-talking,
and a four-player game. The wire format and the pairing scheme already
handle it. We just need the fourth wristband.
