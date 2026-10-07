// Experiment definitions. Each is versioned; the server hashes the definition and every
// observation records which exact protocol version it followed.

export const SHADOW_ANGLE = {
  slug: 'shadow-angle',
  version: 1,
  title: 'The Shadow Stick',
  kicker: 'Eratosthenes, with a phone',
  question:
    'At the same moment, do shadows around the world point to a distant Sun over a round Earth — or to a nearby Sun over a flat one?',
  summary:
    'Plant a vertical stick. Measure its shadow. The angle of the Sun at your location is a number you can check against a model — and against everyone else on Earth.',
  unit: 'degrees',
  hypotheses: [
    'Round Earth, distant Sun: shadow angle = angular distance from you to the subsolar point.',
    'Flat Earth, nearby Sun at height H: shadow angle = atan(ground distance ÷ H).',
    'Your own model: register parameters now; get scored on observations that arrive afterwards.',
  ],
  equipment: ['A straight stick or pole (any height, ≥ 30 cm)', 'A ruler or tape measure', 'A flat, level patch of ground in direct sun', 'A phone (for GPS, clock, level & optional compass)'],
  safety: 'Never look at the Sun. You only ever need to look at the shadow.',
  steps: [
    { title: 'Find a level spot in full sun', body: 'Pavement or flat ground. The shadow tip must be sharp enough to mark.' },
    { title: 'Stand the stick perfectly vertical', body: 'Use the phone level on the stick, or a plumb line. Tilt is the biggest hidden error — we record it.' },
    { title: 'Mark the shadow tip at an exact moment', body: 'Tap “Mark now” as you mark the tip. Your phone clock is checked against ours.' },
    { title: 'Measure stick height and shadow length', body: 'Ground to top of stick; base of stick to the shadow tip. Same units.' },
    { title: 'Note which way the shadow points', body: 'North, south, east, west… The compass helps. Near local noon this lets us do the classic Eratosthenes pair calculation.' },
  ],
  measurements: ['stick height', 'shadow length', 'shadow direction', 'stick tilt', 'UTC time', 'GPS position & accuracy', 'optional photo'],
  assumptions: [
    'Sun position comes from the NOAA/Meeus ephemeris — a model used as a yardstick, not as truth.',
    'Positions come from GPS; ground distances are computed with a 6,371 km mean-radius sphere (±0.5 %).',
    'Atmospheric refraction is corrected with the Bennett formula (matters only for a low Sun).',
    'Ruler error, the Sun’s ½° disc (penumbra at the shadow tip) and stick tilt are propagated into every observation’s uncertainty.',
  ],
  tags: ['Earth geometry', 'solar position'],
};

export const SUNSET_SYNC = {
  slug: 'sunset-sync',
  version: 1,
  title: 'One Sunset, Everywhere',
  kicker: 'A synchronized observatory',
  question: 'Can we watch the terminator sweep the planet — and how well does a model predict the exact second the Sun disappears for you?',
  summary:
    'Everyone presses one button the instant the Sun’s last sliver drops below the horizon. Plotted on a map, it is a live wave of light retreating around the globe — and each press is a measurement.',
  unit: 'seconds',
  hypotheses: [
    'Standard astronomy: the upper limb vanishes at e₀ ≈ −0.83° (refraction + solar radius), lowered by horizon dip for your height.',
    'Geometric horizon: e₀ = 0°. No refraction, no radius.',
    'Your own e₀: refraction varies with weather. Bet on a number.',
  ],
  equipment: ['A clear view of the sunset horizon (sea or flat land is best)', 'A phone'],
  safety: 'Do not stare at the Sun or use binoculars or a camera zoom on it. Look only once the Sun is dim and low — or not at all: watch the sky colour and the shadow-line instead.',
  steps: [
    { title: 'Pick a spot with a low, clear horizon', body: 'Note roughly how high your eyes are above the sea or flat ground.' },
    { title: 'Sync your clock', body: 'The app measures your phone’s clock error against the server and records it.' },
    { title: 'Predict the second', body: 'Commit to a time before the sunset. The prediction is locked and timestamped.' },
    { title: 'Watch. Tap the instant it is gone', body: 'The last sliver of the upper limb. One tap. Your reaction delay is recorded as an uncertainty.' },
  ],
  measurements: ['UTC time of disappearance', 'GPS position', 'eye height above horizon plane', 'sky conditions'],
  assumptions: [
    'Reaction time ≈ 0.4 s (±0.25 s) is subtracted and included in the uncertainty.',
    'Horizon is assumed unobstructed at sea level; hills, buildings and haze are logged and can be challenged.',
    'Phone clock error is estimated by a round-trip handshake with the server (accuracy ≈ ±RTT/2).',
  ],
  tags: ['solar position', 'refraction', 'time'],
};

export const EXPERIMENTS = { 'shadow-angle': SHADOW_ANGLE, 'sunset-sync': SUNSET_SYNC };

// Honest roadmap. These are *proposals* — not live — and the UI says so.
export const PROPOSED = [
  { slug: 'polaris-altitude', title: 'Polaris vs Latitude', kicker: 'Star altitude', blurb: 'The altitude of the pole star above your horizon equals your latitude on a sphere. Measure it with a phone tilt sensor from anywhere in the northern hemisphere.', needs: 'Clear night · phone' },
  { slug: 'moon-parallax', title: 'Moon Parallax', kicker: 'Distance by triangulation', blurb: 'Two people, 1000+ km apart, photograph the Moon against the same stars at the same minute. The shift gives its distance.', needs: 'Two distant observers · camera' },
  { slug: 'horizon-dip', title: 'How Far Is The Horizon?', kicker: 'Elevation vs visibility', blurb: 'Measure the dip of the horizon from different heights. It encodes the curvature (and refraction) of the surface you stand on.', needs: 'A stairwell, a hill, a sea cliff' },
  { slug: 'speed-of-sound', title: 'Speed of Sound', kicker: 'Time-of-flight', blurb: 'Clap, echo, phone microphone. Distributed measurements across temperature and altitude.', needs: 'Open wall · phone mic' },
  { slug: 'pressure-altitude', title: 'Pressure vs Altitude', kicker: 'Barometer atlas', blurb: 'Many phones have barometers. Climb something. Build an empirical pressure–height curve.', needs: 'Barometer phone · a climb' },
  { slug: 'star-trails', title: 'Star Trails, Two Hemispheres', kicker: 'Earth’s rotation', blurb: 'A 20-minute long-exposure from north and south shows opposite rotation about two different poles.', needs: 'Tripod · camera' },
];
