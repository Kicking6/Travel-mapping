import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItinerary, parseFlightLines, flightLegs, findMissingTravel, nearestAirport } from '../web/lib/travel.js';

const AP = {
  AKL: [174.79, -37.008, 'Auckland International Airport', 'Auckland', 'NZ'],
  LAX: [-118.408, 33.942, 'Los Angeles International Airport', 'Los Angeles', 'US'],
  JFK: [-73.779, 40.64, 'John F Kennedy International Airport', 'New York', 'US'],
  LIM: [-77.114, -12.022, 'Jorge Chavez International Airport', 'Lima', 'PE'],
  SCL: [-70.786, -33.393, 'Arturo Merino Benitez International Airport', 'Santiago', 'CL'],
  PUQ: [-70.855, -53.003, 'Pres. Carlos Ibáñez International Airport', 'Punta Arenas', 'CL'],
};

test('itineraries in any separator', () => {
  assert.deepEqual(parseItinerary('akl→lax→jfk'), ['AKL', 'LAX', 'JFK']);
  assert.deepEqual(parseItinerary('LIM - SCL - PUQ'), ['LIM', 'SCL', 'PUQ']);
  assert.equal(parseItinerary('AKL'), null);
});

test('bulk lines: ISO or day-first dates, notes, bad lines reported', () => {
  const { flights, errors } = parseFlightLines('2024-07-23 AKL LAX JFK Air NZ\n18/12/2024 LIM-SCL-PUQ  booking NYBZTX\nJFK to MSP\n# comment\nnonsense here');
  assert.equal(flights.length, 3);
  assert.deepEqual(flights[0], { date: '2024-07-23', codes: ['AKL', 'LAX', 'JFK'], notes: 'Air NZ', line: '2024-07-23 AKL LAX JFK Air NZ' });
  assert.equal(flights[1].date, '2024-12-18');
  assert.deepEqual(flights[2].codes, ['JFK', 'MSP']);
  assert.equal(errors.length, 1);
});

test('a layover becomes one dashed leg per hop, sharing the itinerary', () => {
  const legs = flightLegs(['LIM', 'SCL', 'PUQ'], AP, { date: '2024-12-18', notes: 'NYBZTX' });
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((l) => l.source_name), ['LIM-SCL', 'SCL-PUQ']);
  assert.match(legs[1].notes, /Itinerary LIM → SCL → PUQ \(leg 2 of 2\) · NYBZTX/);
  assert.ok(legs.every((l) => l.type === 'flight' && l.date === '2024-12-18'));
  assert.throws(() => flightLegs(['LIM', 'XXX'], AP), /Unknown airport code: XXX/);
});

test('missing travel: a stay 4,000 km from the last route is found, with an airport suggestion', () => {
  const routes = [{ id: 1, name: 'Mexico City walk', date: '2024-11-16', type: 'walk', coords: [[-99.13, 19.43], [-99.12, 19.44]] }];
  const places = [{ name: 'Hotel Churup', lat: -9.53, lon: -77.53, date: '2024-11-20' }];
  const gaps = findMissingTravel(routes, places, { minKm: 400, airports: { ...AP, MEX: [-99.072, 19.436, 'Mexico City International Airport', 'Mexico City', 'MX'] } });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].suggest.from, 'MEX');
  assert.equal(gaps[0].suggest.to, 'LIM');
  assert.ok(gaps[0].km > 3500);
});

test('nearest airport prefers an international airport', () => {
  assert.equal(nearestAirport(AP, [-77.0, -12.1]).code, 'LIM');
  assert.equal(nearestAirport(AP, [0, 0]), null);
});
