import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileName, dateFromText, addDays } from '../web/lib/names.js';

const START = '2024-07-21';
const p = (n, folder) => parseFileName(n, { tripStart: START, folderPath: folder });

// Every case is a real file name from GPX-Files-Raw. The legacy parser got
// the colon dates and every "day N" file wrong.
test('DD:MM:YYYY with colons (macOS shows / as :)', () => {
  const r = p('Le_Grammont - 18:05:2025.gpx');
  assert.equal(r.date, '2025-05-18');
  assert.equal(r.name, 'Le Grammont');
});

test('DD-MM-YYYY', () => {
  assert.equal(p('Churup 23-11-2024.gpx').date, '2024-11-23');
  assert.equal(p('Churup 23-11-2024.gpx').name, 'Churup');
});

test('Month DD YYYY + transport word', () => {
  const r = p('August 02 2025 driving.gpx');
  assert.deepEqual([r.date, r.type, r.name], ['2025-08-02', 'drive', null]);
});

test('Month D with no year takes the year inside the trip', () => {
  assert.equal(p('April 25 driving.gpx').date, '2025-04-25');
  assert.equal(p('May 2 driving.gpx').date, '2025-05-02');
  assert.equal(p('August 30 driving.gpx').date, '2024-08-30');
});

test('Month D_part YYYY', () => {
  assert.equal(p('July 1_2 2025.gpx').date, '2025-07-01');
});

test('trip day N is dated from the trip start', () => {
  const r = p('day 103 busing.gpx');
  assert.equal(r.tripDay, 103);
  assert.equal(r.date, addDays(START, 102));
  assert.equal(r.type, 'bus');
  assert.equal(r.dateSource, 'trip-day');
  assert.equal(p('day 109 bussing.gpx').type, 'bus');
  assert.equal(p('day 164 ubering.gpx').type, 'taxi');
  assert.equal(p('day 81.1 driving.gpx').tripDay, 81);
});

test('"Day 1" inside a hike name is not a trip day', () => {
  const r = p('Salkantay Day 1 05-12-2024.gpx');
  assert.equal(r.tripDay, null);
  assert.equal(r.date, '2024-12-05');
  assert.match(r.name, /Salkantay Day 1/);
});

test('BOAT prefix and two transport words', () => {
  const r = p('BOAT - June 24 2025 Boat Ride Out & Walk.gpx');
  assert.equal(r.date, '2025-06-24');
  assert.equal(r.type, 'boat');
  assert.match(r.name, /Boat Ride Out/);
});

test('no date in name → null, not a guess', () => {
  const r = p('Cathedral_Rock_Trail.gpx');
  assert.equal(r.date, null);
  assert.equal(r.name, 'Cathedral Rock Trail');
});

test('ISO dates and impossible dates', () => {
  assert.equal(dateFromText('2025-01-04_drive_lima').date, '2025-01-04');
  assert.equal(dateFromText('31-02-2025').date, null);
});

test('a guessed year is only a suggestion', () => {
  const r = p('September 13 Car Ferry Sardinia to Sicily.gpx');
  assert.equal(r.dateSource, 'suggested');
  assert.equal(p('June 12 1 2025 driving.gpx').date, '2025-06-12');
  assert.equal(p('June 12 1 2025 driving.gpx').dateSource, 'filename');
});

test('SkiTracks timestamp names give a date, not "59 44"', () => {
  const r = p('2025_01_17_09_59_44.gpx', 'Strava/Skiing 0.05km resolution/2025_01_17_09_59_44.gpx');
  assert.equal(r.date, '2025-01-17');
  assert.equal(r.name, null);
});

test('"September 22, 2024 Glacier National Park, USA Avalanche Lake" — comma after the day', () => {
  const r = p('September 22, 2024 Glacier National Park, USA Avalanche Lake.gpx');
  assert.equal(r.date, '2024-09-22');
  assert.match(r.name, /^Glacier National Park/);
});
