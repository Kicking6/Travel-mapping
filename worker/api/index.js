// The API dispatcher: each domain module returns a Response, or undefined
// when the path isn't its own (akahu-ledger's api/<domain>.js pattern).
// Shared by worker/index.js (HTTP) and worker/mcp.js (the MCP connector), so
// both go through the same validation.
import * as routesApi from './routes.js';
import * as tripApi from './trip.js';
import * as mapsApi from './maps.js';
import * as photosApi from './photos.js';
import * as tokensApi from './tokens.js';
import * as stravaApi from './strava.js';

const MODULES = [routesApi, tripApi, mapsApi, photosApi, tokensApi, stravaApi];

export async function dispatch(request, env, url, user) {
  for (const mod of MODULES) {
    const res = await mod.handle(request, env, url, user);
    if (res !== undefined) return res;
  }
  return undefined;
}
