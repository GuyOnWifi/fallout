// soup — a chubby lil guy
// two-ball design: big body sphere + head sphere on top
// units: mm. print at whatever scale you like.

$fn = 80;  // sphere smoothness

// --- tunables ---
body_r   = 40;      // body radius
head_r   = 28;      // head radius (a bit smaller so head sits on top)
head_dz  = 52;      // head center height above body center
ear_r    = 9;       // ear radius
eye_r    = 3.2;     // eye radius
nose_r   = 4.0;     // nose (the middle dark blob)
arm_r    = 10;      // little paw radius
tail_r   = 8;       // tail radius

// --- body (bottom ball) ---
// squish slightly so he sits flat and looks chonky
module body() {
    scale([1.05, 1.0, 0.95])
        sphere(r = body_r);
}

// --- head (top ball) ---
module head() {
    translate([0, 0, head_dz])
        sphere(r = head_r);
}

// --- ears: two little bumps on top of head ---
module ears() {
    for (sx = [-1, 1]) {
        translate([sx * (head_r * 0.55), -head_r * 0.15, head_dz + head_r * 0.75])
            sphere(r = ear_r);
    }
}

// --- face patch: flatter oval on front of head (the darker mask area) ---
// modeled as a very shallow disc pushed into the head front
module face_patch() {
    translate([0, -head_r * 0.85, head_dz - 2])
        scale([1.2, 0.3, 1.0])
            sphere(r = head_r * 0.55);
}

// --- eyes + nose: three little bumps on the face ---
module face_details() {
    // eyes
    for (sx = [-1, 1]) {
        translate([sx * (head_r * 0.35), -head_r * 0.95, head_dz + 2])
            sphere(r = eye_r);
    }
    // nose (center, slightly lower)
    translate([0, -head_r * 0.98, head_dz - 3])
        sphere(r = nose_r);
}

// --- arms: two small paws on the front of the body ---
module arms() {
    for (sx = [-1, 1]) {
        translate([sx * (body_r * 0.55), -body_r * 0.55, body_r * 0.05])
            sphere(r = arm_r);
    }
}

// --- tail: little nub off the back-left ---
module tail() {
    translate([-body_r * 0.85, body_r * 0.4, -body_r * 0.35])
        sphere(r = tail_r);
}

// --- assemble ---
module soup() {
    union() {
        body();
        head();
        ears();
        face_patch();
        face_details();
        arms();
        tail();
    }
}

soup();
