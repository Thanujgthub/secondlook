// Sample photos, preset complaints, cases, presenter script and the canned reviews used in Demo mode.

export const COMPLAINTS = {
  single: 'The streetlight beside Gate 2 stays dark at night.',
  row: 'The entire row of lights by Gate 2 stays dark.',
};

export const SAMPLES = {
  'gate2-day': { file: './samples/gate2-day.jpg', mimeType: 'image/jpeg', label: 'Gate 2 pole, daytime' },
  'gate2-night': { file: './samples/gate2-night.jpg', mimeType: 'image/jpeg', label: 'Gate 2 lamp, night' },
  'gate3-night': { file: './samples/gate3-night.jpg', mimeType: 'image/jpeg', label: 'Gate 3 lamp, night' },
  'row-partial': { file: './samples/row-partial.jpg', mimeType: 'image/jpeg', label: 'Gate 2 row, 3 of 5 lit' },
  'row-full': { file: './samples/row-full.jpg', mimeType: 'image/jpeg', label: 'Gate 2 row, all 5 lit' },
};

export const CASES = [
  {
    id: 'SL-1042',
    title: 'Streetlight out beside Gate 2',
    complaintId: 'single',
    location: 'Gate 2, Market Road, Ward 14',
    reportedBy: 'Resident via grievance portal',
    reportedAt: '2026-11-18T21:40:00+05:30',
    crewMarkedAt: '2026-11-20T11:30:00+05:30',
    crewNote: 'Lamp replaced. Marked fixed.',
    photos: ['gate2-day', 'gate2-night'],
  },
  {
    id: 'SL-1043',
    title: 'Whole row dark by Gate 2',
    complaintId: 'row',
    location: 'Gate 2 boundary wall, Market Road, Ward 14',
    reportedBy: 'Ward councillor office',
    reportedAt: '2026-11-19T20:15:00+05:30',
    crewMarkedAt: '2026-11-21T10:05:00+05:30',
    crewNote: 'Row checked, lamps replaced. Marked fixed.',
    photos: ['gate2-night', 'row-partial', 'row-full'],
  },
  {
    id: 'SL-1047',
    title: 'Lamp out at Gate 2 entrance',
    complaintId: 'single',
    location: 'Gate 2 entrance, Market Road, Ward 14',
    reportedBy: 'Shopkeeper via helpline call',
    reportedAt: '2026-11-20T22:05:00+05:30',
    crewMarkedAt: '2026-11-21T16:45:00+05:30',
    crewNote: 'Fused bulb swapped at the gate. Marked fixed.',
    photos: ['gate3-night', 'gate2-night'],
  },
];

// Presenter script: each step selects a case + photo and runs the review.
export const DEMO_STEPS = [
  { caseId: 'SL-1042', photoId: 'gate2-day', say: 'A daytime photo can\'t show a lamp works at night.' },
  { caseId: 'SL-1042', photoId: 'gate2-night', say: 'The lit Gate 2 lamp answers the complaint. The supervisor signs off.' },
  { caseId: 'SL-1043', photoId: 'gate2-night', say: 'Same photo, wider complaint: one lamp says nothing about the row.' },
  { caseId: 'SL-1043', photoId: 'row-partial', say: 'The wide shot shows two lamps still dark: repair incomplete.' },
  { caseId: 'SL-1043', photoId: 'row-full', say: 'All five lit: ready for sign-off.' },
];

const DEMO = 'Demo data';

// Keyed by `${photoId}|${complaintId}`. Each entry is a full Review.
export const DEMO_RESULTS = {
  'gate2-day|single': {
    status: 'needs_photo',
    observation: 'The pole beside the readable "GATE 2" sign is in frame, but the photo was taken in full daylight with the lamp switched off, so it cannot show the lamp works at night.',
    checks: [
      { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Single pole next to a sign reading "GATE 2"', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Bright daylight, blue sky, hard shadows', result: 'fail' },
      { label: 'Lamp state', expected: 'Lamp switched on', seen: 'Lamp head is off, as expected in daytime', result: 'unclear' },
    ],
    next_photo_request: 'Return after dark and photograph the lamp beside Gate 2 switched on, with the "GATE 2" sign readable in the same frame.',
    model: DEMO,
  },
  'gate2-day|row': {
    status: 'needs_photo',
    observation: 'The daytime photo shows one unlit pole beside the "GATE 2" sign and no other lights, so it proves neither that the lamps work at night nor anything about the rest of the row.',
    checks: [
      { label: 'Location', expected: 'Row of lights by Gate 2', seen: 'Sign reads "GATE 2"', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Bright daylight', result: 'fail' },
      { label: 'Coverage', expected: 'Every light in the row in frame', seen: 'Only one pole visible', result: 'fail' },
      { label: 'Lamp state', expected: 'All lamps switched on', seen: 'The one lamp in frame is off (daytime)', result: 'unclear' },
    ],
    next_photo_request: 'Return after dark and take one wide photo along the Gate 2 wall showing every light in the row switched on, with the "GATE 2" sign in frame.',
    model: DEMO,
  },
  'gate2-night|single': {
    status: 'ready',
    observation: 'At night, the lamp beside the clearly readable "GATE 2" sign is switched on and casting a pool of light onto the road below.',
    checks: [
      { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Lamp next to a sign reading "GATE 2"', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Dark sky, artificial lighting only', result: 'pass' },
      { label: 'Lamp state', expected: 'Lamp switched on', seen: 'Lamp is lit and lighting the ground', result: 'pass' },
    ],
    next_photo_request: null,
    model: DEMO,
  },
  'gate2-night|row': {
    status: 'needs_photo',
    observation: 'One lit lamp beside the "GATE 2" sign is visible at night, but no other poles are in frame, so the photo says nothing about the rest of the row.',
    checks: [
      { label: 'Location', expected: 'Row of lights by Gate 2', seen: 'Sign reads "GATE 2"', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Coverage', expected: 'Every light in the row in frame', seen: 'Only one lamp in frame', result: 'fail' },
      { label: 'Lamp state', expected: 'All lamps switched on', seen: 'The one visible lamp is on; the rest are out of frame', result: 'unclear' },
    ],
    next_photo_request: 'Step back and take one wide night photo along the Gate 2 wall that shows every light in the row and the "GATE 2" sign together.',
    model: DEMO,
  },
  'gate3-night|single': {
    status: 'needs_photo',
    observation: 'A lamp is lit at night, but the sign beside it reads "GATE 3", not Gate 2, so this is not the streetlight named in the complaint.',
    checks: [
      { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Sign reads "GATE 3"', result: 'fail' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Lamp state', expected: 'The Gate 2 lamp switched on', seen: 'A lamp is lit, but at Gate 3', result: 'unclear' },
    ],
    next_photo_request: 'Go to Gate 2 after dark and photograph the lamp beside it switched on, with the "GATE 2" sign readable in the same frame.',
    model: DEMO,
  },
  'gate3-night|row': {
    status: 'needs_photo',
    observation: 'The photo shows a single lit lamp beside a sign reading "GATE 3", which is the wrong location and only one light, not the row by Gate 2.',
    checks: [
      { label: 'Location', expected: 'Row of lights by Gate 2', seen: 'Sign reads "GATE 3"', result: 'fail' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Coverage', expected: 'Every light in the Gate 2 row in frame', seen: 'One lamp, at the wrong gate', result: 'fail' },
    ],
    next_photo_request: 'Go to Gate 2 after dark and take one wide photo along the wall showing every light in the row, with the "GATE 2" sign in frame.',
    model: DEMO,
  },
  'row-partial|single': {
    status: 'ready',
    observation: 'At night, the lamp on the pole right next to the "GATE 2" sign is lit; the far-left pole and the fourth pole are dark, but this complaint covers only the Gate 2 lamp.',
    checks: [
      { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Sign reads "GATE 2" with a lamp beside it', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Lamp state', expected: 'The Gate 2 lamp switched on', seen: 'The lamp next to the sign is lit', result: 'pass' },
    ],
    next_photo_request: null,
    model: DEMO,
  },
  'row-partial|row': {
    status: 'not_fixed',
    observation: 'The wide night shot shows the "GATE 2" sign and all five lights in the row: three are lit, but the far-left lamp and the fourth lamp are clearly dark, so the row is not fully repaired.',
    checks: [
      { label: 'Location', expected: 'Row of lights by Gate 2', seen: 'Sign reads "GATE 2" at the start of the row', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Coverage', expected: 'Every light in the row in frame', seen: 'Five poles visible along the wall', result: 'pass' },
      { label: 'Lamp state', expected: 'All 5 lamps switched on', seen: '3 lit; pole 1 (far left) and pole 4 dark', result: 'fail' },
    ],
    next_photo_request: 'Repair the two dark lamps in the Gate 2 row (the far-left pole and the fourth pole from the left), then send a new wide night photo showing all five lit with the "GATE 2" sign in frame.',
    model: DEMO,
  },
  'row-full|single': {
    status: 'ready',
    observation: 'At night, the lamp beside the "GATE 2" sign is lit, along with the rest of the row along the wall.',
    checks: [
      { label: 'Location', expected: 'Lamp beside Gate 2', seen: 'Sign reads "GATE 2" with a lamp beside it', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Lamp state', expected: 'The Gate 2 lamp switched on', seen: 'The lamp next to the sign is lit', result: 'pass' },
    ],
    next_photo_request: null,
    model: DEMO,
  },
  'row-full|row': {
    status: 'ready',
    observation: 'The wide night shot shows the "GATE 2" sign and all five lights along the wall switched on, with no dark lamp in the row.',
    checks: [
      { label: 'Location', expected: 'Row of lights by Gate 2', seen: 'Sign reads "GATE 2" at the start of the row', result: 'pass' },
      { label: 'Time of day', expected: 'Taken after dark', seen: 'Night, dark sky', result: 'pass' },
      { label: 'Coverage', expected: 'Every light in the row in frame', seen: 'Five poles visible along the wall', result: 'pass' },
      { label: 'Lamp state', expected: 'All lamps switched on', seen: 'All 5 lamps lit', result: 'pass' },
    ],
    next_photo_request: null,
    model: DEMO,
  },
};
