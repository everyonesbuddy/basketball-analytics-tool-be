/**
 * Ticketmaster Discovery API (free tier: 5,000 calls a day, 5 a second).
 * Only the Consumer Key is used, as `apikey`; the secret isn't needed.
 * Results are cached in memory so normal use stays far under the limits.
 */
const BASE = "https://app.ticketmaster.com/discovery/v2";
const TTL = 30 * 60 * 1000;
const cache = new Map();

const key = () => process.env.TICKETMASTER_API_KEY || "";
const configured = () => Boolean(key());

class NotConfigured extends Error {
  constructor() {
    super("Events need TICKETMASTER_API_KEY (your Ticketmaster Consumer Key).");
    this.statusCode = 503;
  }
}

/** Encode a lat/lon as a geohash (Ticketmaster's geoPoint). */
function geohash(lat, lon, precision = 7) {
  const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let [latLo, latHi, lonLo, lonHi] = [-90, 90, -180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2;
      if (lon >= mid) {
        ch = (ch << 1) | 1;
        lonLo = mid;
      } else {
        ch <<= 1;
        lonHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch <<= 1;
        latHi = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += B32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Miles between two points. */
function miles(a, b) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const pickImage = (images = []) => {
  const wide = images.filter((i) => i.ratio === "16_9").sort((a, b) => Math.abs(a.width - 640) - Math.abs(b.width - 640));
  return (wide[0] || images[0] || {}).url || "";
};

/** A Ticketmaster event, cut down to what the page shows. */
function normalizeEvent(e, from = null) {
  const v = e._embedded?.venues?.[0] || {};
  const loc = v.location ? { lat: Number(v.location.latitude), lon: Number(v.location.longitude) } : null;
  const c = e.classifications?.[0] || {};
  const p = e.priceRanges?.[0];
  return {
    id: e.id,
    name: e.name,
    url: e.url || "",
    image: pickImage(e.images),
    date: e.dates?.start?.localDate || null,
    time: e.dates?.start?.timeTBA ? null : e.dates?.start?.localTime || null,
    status: e.dates?.status?.code || "onsale",
    venue: v.name || "",
    city: [v.city?.name, v.state?.stateCode || v.country?.countryCode].filter(Boolean).join(", "),
    distance: from && loc && Number.isFinite(loc.lat) ? Math.round(miles(from, loc)) : null,
    priceMin: p ? p.min : null,
    priceMax: p ? p.max : null,
    currency: p ? p.currency : null,
    onsaleAt: e.sales?.public?.startDateTime || null,
    presales: (e.sales?.presales || []).map((s) => ({ name: s.name, start: s.startDateTime, end: s.endDateTime })).slice(0, 4),
    segment: c.segment?.name || "",
    genre: c.genre?.name && c.genre.name !== "Undefined" ? c.genre.name : "",
    attractions: (e._embedded?.attractions || []).map((a) => a.id),
  };
}

function normalizeAttraction(a) {
  const c = a.classifications?.[0] || {};
  return {
    id: a.id,
    name: a.name,
    image: pickImage(a.images),
    segment: c.segment?.name || "",
    genre: c.genre?.name && c.genre.name !== "Undefined" ? c.genre.name : "",
    upcoming: a.upcomingEvents?._total ?? null,
    url: a.url || "",
  };
}

// Requests go out one at a time, at least 220 ms apart (under 5 a second).
let chain = Promise.resolve();
let last = 0;
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, last + 220 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function get(path, params) {
  if (!configured()) throw new NotConfigured();
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")), apikey: key() });
  const cacheKey = `${path}?${[...qs].filter(([k]) => k !== "apikey").map((x) => x.join("=")).join("&")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.at > Date.now() - TTL) return hit.data;
  const data = await throttled(async () => {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401) {
      const err = new Error("Ticketmaster didn't accept the key. Check TICKETMASTER_API_KEY is the Consumer Key.");
      err.statusCode = 502;
      throw err;
    }
    if (res.status === 429) {
      const err = new Error("Ticketmaster's rate limit was hit. Try again in a minute.");
      err.statusCode = 429;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Ticketmaster returned ${res.status}.`);
      err.statusCode = 502;
      throw err;
    }
    return res.json();
  });
  cache.set(cacheKey, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

async function searchAttractions(keyword) {
  const d = await get("/attractions.json", { keyword, size: 10, sort: "relevance,desc" });
  return (d._embedded?.attractions || []).map(normalizeAttraction);
}

/** Upcoming events for one artist or team, everywhere, soonest first. */
async function eventsFor(attractionId, from) {
  const d = await get("/events.json", { attractionId, size: 30, sort: "date,asc" });
  return (d._embedded?.events || []).map((e) => normalizeEvent(e, from));
}

/** Events near a point within `radius` miles over the next `days`. */
async function nearby({ lat, lon, radius = 50, days = 30, segment }) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 86400000);
  const iso = (d) => `${d.toISOString().slice(0, 19)}Z`;
  const d = await get("/events.json", {
    geoPoint: geohash(lat, lon),
    radius: Math.round(radius),
    unit: "miles",
    startDateTime: iso(start),
    endDateTime: iso(end),
    classificationName: segment,
    size: 60,
    sort: "date,asc",
  });
  return (d._embedded?.events || []).map((e) => normalizeEvent(e, { lat, lon }));
}

/**
 * Event reminders for Today: saved events coming up (going or bought) and
 * tickets going on sale for events you're interested in.
 */
function eventReminders({ saved = [], now = new Date() }) {
  const out = [];
  const day = 86400000;
  const today = now.toISOString().slice(0, 10);
  const daysTo = (date) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / day);
  for (const s of saved) {
    if (s.date && ["going", "bought"].includes(s.status)) {
      const n = daysTo(s.date);
      if (n >= 0 && n <= 3) out.push({ kind: "event", priority: 1, savedId: String(s._id), text: `${s.name} is ${n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`}${s.venue ? ` at ${s.venue}` : ""}${s.status === "going" ? ". Get tickets if you haven't." : "."}` });
    }
    if (s.status === "interested" && s.onsaleAt) {
      const ms = Date.parse(s.onsaleAt) - now.getTime();
      if (ms > -6 * 3600000 && ms <= 3 * day) {
        out.push({ kind: "onsale", priority: 1, savedId: String(s._id), at: s.onsaleAt, text: ms > 0 ? `Tickets for ${s.name} go on sale soon.` : `Tickets for ${s.name} just went on sale.` });
      }
    }
  }
  return out;
}

module.exports = { configured, geohash, miles, normalizeEvent, normalizeAttraction, searchAttractions, eventsFor, nearby, eventReminders, NotConfigured };
