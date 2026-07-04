const DATA_URL = 'https://data.cityofnewyork.us/resource/qnv7-p7a2.json?$limit=5000&featuresta=Active';
const BOROUGH = { M: 'Manhattan', B: 'Brooklyn', Q: 'Queens', R: 'Staten Island', X: 'Bronx' };
const NEAREST_N = 20;
let showCount = NEAREST_N; // number to show, or Infinity for all
const DEFAULT_LOCATION = [40.7484, -73.9857];

const CATEGORIES = {
  pedestal:   { label: 'Standard pedestal',     color: '#0a4f6d' },
  modern:     { label: 'Modern (cantilever)',   color: '#1e8449' },
  bottle:     { label: 'Bottle filler',         color: '#2471a3' },
  dog:        { label: 'Dog fountain',          color: '#a04000' },
  indoor:     { label: 'Indoor / sink',         color: '#7d6608' },
  comfort:    { label: 'Comfort station',       color: '#5b2c6f' },
  historic:   { label: 'Historic / monument',   color: '#922b21' },
  other:      { label: 'Other',                 color: '#566573' },
  osm:        { label: 'OSM drinking water',    color: '#16a085' },
  restroom:   { label: 'Public restroom (sink)', color: '#c2185b' },
};

// User-facing filter groups — collapses the ten inventory categories above
// (still used for marker colors) into the ~3 distinctions a user actually cares about.
const FILTER_GROUPS = {
  fountain: { label: 'Fountain',       cats: ['pedestal', 'modern', 'indoor', 'comfort', 'historic', 'other', 'osm'], swatchCat: 'pedestal' },
  bottle:   { label: 'Bottle filler',  cats: ['bottle'],   swatchCat: 'bottle' },
  restroom: { label: 'Restroom sink',  cats: ['restroom'], swatchCat: 'restroom' },
  dog:      { label: 'Dog fountain',   cats: ['dog'],      swatchCat: 'dog' },
};

function categorize(t = '') {
  if (/bottle filler/i.test(t)) return 'bottle';
  if (/dog/i.test(t)) return 'dog';
  if (/indoor|sink|water cooler|bathroom/i.test(t)) return 'indoor';
  if (/^cs /i.test(t)) return 'comfort';
  if (/monument|stone|trough/i.test(t)) return 'historic';
  if (/^[ef]( |$)/i.test(t)) return 'modern';
  if (/^[abcdghj]( |$)/i.test(t) || /pedestal/i.test(t)) return 'pedestal';
  return 'other';
}

const map = L.map('map', { preferCanvas: true, zoomControl: true }).setView(DEFAULT_LOCATION, 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 19,
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
let userMarker = null;
let userLatLng = null;

const state = {
  fountains: [],
  filters: { access: false, enabledCats: new Set(Object.keys(CATEGORIES)) },
};

function isAccessible(t = '') { return /high low/i.test(t); }

// Normalize a Parks API record into a uniform internal record.
function normalizeParks(f) {
  const c = f.the_geom && f.the_geom.coordinates;
  if (!c) return null;
  const type = f.fountainty || '';
  return {
    source: 'parks',
    sourceId: f.system || null,
    latlng: [c[1], c[0]],
    cat: categorize(type),
    accessible: isAccessible(type),
    displayName: f.propertyna || 'Unknown park',
    detail: type,
    position: f.position || '',
    osmId: null,
  };
}

// Normalize an OSM Overpass node into a uniform internal record.
function normalizeRestroom(r) {
  const lat = parseFloat(r.latitude);
  const lon = parseFloat(r.longitude);
  if (isNaN(lat) || isNaN(lon)) return null;
  return {
    source: 'restroom',
    sourceId: `${lat.toFixed(5)},${lon.toFixed(5)}`,
    latlng: [lat, lon],
    cat: 'restroom',
    accessible: false,
    displayName: r.facility_name || 'Public restroom',
    detail: [r.location_type, r.operator].filter(Boolean).join(' · '),
    position: '',
    osmId: null,
  };
}

function normalizeOSM(node) {
  const tags = node.tags || {};
  return {
    source: 'osm',
    sourceId: String(node.id),
    latlng: [node.lat, node.lon],
    cat: 'osm',
    accessible: tags.wheelchair === 'yes',
    displayName: tags.name || 'Drinking water (OSM)',
    detail: '',
    position: '',
    osmId: node.id,
  };
}

function passesFilters(f) {
  if (state.filters.access && !f.accessible) return false;
  if (!state.filters.enabledCats.has(f.cat)) return false;
  return true;
}

const iconCache = {};
function iconFor(cat) {
  if (iconCache[cat]) return iconCache[cat];
  const color = CATEGORIES[cat].color;
  iconCache[cat] = L.divIcon({
    className: 'pin-wrap',
    html: `<span class="pin" style="background:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  return iconCache[cat];
}

function distMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function walkTime(distM) {
  const min = distM / 80; // ~80 m/min walking pace
  return min < 1 ? '<1 min walk' : `~${Math.round(min)} min walk`;
}

function popupHTML(f, distM) {
  const catLabel = CATEGORIES[f.cat].label;
  const dist = distM != null ? `<div class="popup-dist">${walkTime(distM)} (${distM < 1000 ? Math.round(distM) + ' m' : (distM/1609).toFixed(2) + ' mi'})</div>` : '';
  const detail = f.source === 'restroom'
    ? (f.detail ? `${catLabel} — ${f.detail}` : catLabel)
    : (f.detail && f.cat !== 'osm' ? `${catLabel} — ${f.detail.toLowerCase()}` : catLabel);
  const pos = f.position ? ' — ' + f.position.toLowerCase() : '';
  const sourceLabel = f.source === 'parks' ? 'NYC Parks'
    : f.source === 'restroom' ? 'NYC Public Restroom'
    : 'OpenStreetMap';
  const action = f.source === 'parks'
    ? `<a href="https://portal.311.nyc.gov/article/?kanumber=KA-02430" target="_blank" rel="noopener">Report broken</a>`
    : f.source === 'osm'
    ? `<a href="https://www.openstreetmap.org/node/${f.osmId}" target="_blank" rel="noopener">View on OSM</a>`
    : '';
  const directions = `<a href="https://maps.google.com/?daddr=${f.latlng[0]},${f.latlng[1]}" target="_blank" rel="noopener">Get directions</a>`;
  return `
    <div class="popup-title">${f.displayName}</div>
    ${dist}
    <div class="popup-meta">
      <div>${detail}${pos}</div>
      ${f.accessible ? '<div>♿ Accessible</div>' : ''}
      <div>Source: ${sourceLabel}</div>
    </div>
    <div class="popup-actions">${directions}${action ? ' · ' + action : ''}</div>
  `;
}

function nearestFromCenter() {
  const center = userLatLng || map.getCenter();
  const origin = [center.lat ?? center[0], center.lng ?? center[1]];
  const filtered = [];
  for (const f of state.fountains) {
    if (!passesFilters(f)) continue;
    filtered.push({ f, latlng: f.latlng, dist: distMeters(origin, f.latlng) });
  }
  filtered.sort((a, b) => a.dist - b.dist);
  return filtered.slice(0, showCount);
}

function render() {
  markerLayer.clearLayers();
  const nearest = nearestFromCenter();
  for (const { f, latlng, dist } of nearest) {
    const m = L.marker(latlng, { icon: iconFor(f.cat) });
    m.bindPopup(popupHTML(f, dist));
    markerLayer.addLayer(m);
  }
  const closest = nearest[0];
  const label = showCount === Infinity ? `${nearest.length} fountains` : `${nearest.length} nearest fountains`;
  const status = closest
    ? `${label} · closest: ${walkTime(closest.dist)}`
    : 'No fountains match filters';
  document.getElementById('status').textContent = status;
  if (nearest.length && (userLatLng || !state.fittedOnce)) {
    const points = nearest.map((n) => n.latlng);
    if (userLatLng) points.push([userLatLng.lat, userLatLng.lng]);
    map.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: 16, animate: true });
    state.fittedOnce = true;
  }
}

// Query by NYC's administrative area (Wikidata Q60), not a bbox — a rectangle
// containing all 5 boroughs also contains Jersey City/Newark/etc.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter?data=[out:json][timeout:30];area["wikidata"="Q60"]->.nyc;(node["amenity"="drinking_water"](area.nyc);node["man_made"="water_tap"]["drinking_water"="yes"](area.nyc);node["amenity"="water_point"](area.nyc);node["drinking_water"="yes"](area.nyc););out;';
const RESTROOM_URL = 'https://data.cityofnewyork.us/resource/i7jb-7jku.json?$limit=2000&$where=status=%27Operational%27%20AND%20latitude%20IS%20NOT%20NULL';
const DEDUP_THRESHOLD_M = 25;

// Fetches are started together, but awaited one at a time so each source
// renders as soon as it lands instead of all waiting on the slowest
// (Overpass, up to a 30 s timeout) before anything appears.
async function load() {
  const parksFetch = fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error('Parks HTTP ' + r.status); return r.json(); });
  const osmFetch = fetch(OVERPASS_URL).then((r) => { if (!r.ok) throw new Error('OSM HTTP ' + r.status); return r.json(); });
  const restroomFetch = fetch(RESTROOM_URL).then((r) => { if (!r.ok) throw new Error('Restroom HTTP ' + r.status); return r.json(); });

  let parksRecords = [];
  try {
    parksRecords = (await parksFetch).map(normalizeParks).filter(Boolean);
    state.fountains.push(...parksRecords);
    render();
  } catch (err) {
    console.warn('Parks load failed:', err);
  }

  try {
    const restroomData = await restroomFetch;
    state.fountains.push(...restroomData.map(normalizeRestroom).filter(Boolean));
    render();
  } catch (err) {
    console.warn('Restroom load failed:', err);
  }

  try {
    const osmData = await osmFetch;
    // Dedup: drop OSM nodes within 25 m of any Parks record (Parks is authoritative).
    const osmRecords = osmData.elements.map(normalizeOSM).filter((osm) =>
      !parksRecords.some((p) => distMeters(osm.latlng, p.latlng) < DEDUP_THRESHOLD_M)
    );
    state.fountains.push(...osmRecords);
    render();
  } catch (err) {
    console.warn('OSM load failed:', err);
  }

  if (state.fountains.length === 0) {
    document.getElementById('status').textContent = 'Failed to load fountain data';
  }
}

function buildLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = '';
  for (const [, { label, cats, swatchCat }] of Object.entries(FILTER_GROUPS)) {
    const color = CATEGORIES[swatchCat].color;
    const row = document.createElement('label');
    row.className = 'legend-row';
    row.innerHTML = `
      <input type="checkbox" checked>
      <span class="swatch" style="background:${color}"></span>
      <span>${label}</span>
    `;
    el.appendChild(row);
    row.querySelector('input').addEventListener('change', (e) => {
      for (const cat of cats) {
        if (e.target.checked) state.filters.enabledCats.add(cat);
        else state.filters.enabledCats.delete(cat);
      }
      render();
    });
  }
}
buildLegend();

// Outdoor fountains are typically shut off Nov–Apr; surface that as a banner
// instead of leaving it as easy-to-miss year-round fine print.
const SEASONAL_OFF_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov, Dec, Jan, Feb, Mar, Apr
if (SEASONAL_OFF_MONTHS.has(new Date().getMonth())) {
  document.getElementById('seasonal-banner').hidden = false;
}

document.getElementById('show-count').addEventListener('change', (e) => {
  showCount = e.target.value === 'all' ? Infinity : parseInt(e.target.value, 10);
  render();
});

document.getElementById('f-access').addEventListener('change', (e) => {
  state.filters.access = e.target.checked;
  render();
});

document.getElementById('locate').addEventListener('click', () => {
  map.locate({ setView: false, enableHighAccuracy: true });
});

map.on('locationfound', (e) => {
  userLatLng = e.latlng;
  if (userMarker) userMarker.remove();
  userMarker = L.circleMarker(e.latlng, {
    radius: 7, color: '#fff', weight: 2, fillColor: '#1565c0', fillOpacity: 1,
  }).addTo(map).bindPopup('You are here');
  render();
});
map.on('locationerror', () => {
  document.getElementById('status').textContent = 'Location unavailable — drag the map to recenter';
});

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// Only re-render on pan when we don't have a real user location — if userLatLng
// is set, nearestFromCenter() anchors on it regardless of map center, so
// re-rendering here would just fitBounds back and fight the user's own pan.
map.on('moveend', debounce(() => {
  if (userLatLng) return;
  render();
}, 300));

load();
map.locate({ setView: false, enableHighAccuracy: true });
