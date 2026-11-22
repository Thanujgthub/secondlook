// Sample photos, preset complaints and the canned reviews used in demo mode.

export const SAMPLES = [
  { id: 'gate2-day', file: './samples/gate2-day.png', label: 'Daytime: Gate 2 pole' },
  { id: 'gate2-night', file: './samples/gate2-night.png', label: 'Night: Gate 2 lamp lit' },
  { id: 'gate3-night', file: './samples/gate3-night.png', label: 'Night: Gate 3 lamp lit' },
];

export const COMPLAINTS = [
  { id: 'single', label: 'One lamp', text: 'The streetlight beside Gate 2 stays dark at night.' },
  { id: 'row', label: 'Whole row', text: 'The entire row of lights by Gate 2 stays dark.' },
];

// Keyed by `${sampleId}|${complaintId}`.
export const DEMO_RESULTS = {
  'gate2-day|single': {
    status: 'needs_photo',
    observation:
      'The photo was taken in daylight: the pole beside the "GATE 2" sign is visible, but the lamp head is unlit, so it cannot show whether the light works at night.',
    next_photo_request:
      'Please send a photo taken after dark showing this lamp switched on, with the "GATE 2" sign in the same frame.',
  },
  'gate2-day|row': {
    status: 'needs_photo',
    observation:
      'The daytime photo shows a single unlit pole beside the "GATE 2" sign; it shows neither whether the lamp works at night nor the rest of the row.',
    next_photo_request:
      'Please send a wide photo taken after dark showing the whole row of lights by Gate 2 switched on, with the "GATE 2" sign in frame.',
  },
  'gate2-night|single': {
    status: 'ready',
    observation:
      'At night, the lamp beside the clearly readable "GATE 2" sign is switched on and casting a visible cone of light onto the ground below.',
    next_photo_request: null,
  },
  'gate2-night|row': {
    status: 'needs_photo',
    observation:
      'One lit lamp beside the "GATE 2" sign is visible at night, but no other poles are in frame, so the photo says nothing about the rest of the row.',
    next_photo_request:
      'Please send a wider photo taken after dark that shows every light in the row by Gate 2, with the "GATE 2" sign in frame.',
  },
  'gate3-night|single': {
    status: 'needs_photo',
    observation:
      'A lamp is lit at night, but the sign beside it reads "GATE 3", not Gate 2, so this is not the streetlight named in the complaint.',
    next_photo_request:
      'Please send an after-dark photo of the lamp beside Gate 2 switched on, with a readable "GATE 2" sign in the same frame.',
  },
  'gate3-night|row': {
    status: 'needs_photo',
    observation:
      'The photo shows a single lit lamp beside a sign reading "GATE 3", which is the wrong location and only one light, not the row by Gate 2.',
    next_photo_request:
      'Please send a wide after-dark photo of the whole row of lights by Gate 2 switched on, with a readable "GATE 2" sign in frame.',
  },
};
