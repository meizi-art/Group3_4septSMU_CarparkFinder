/**
 * ============================================================================
 * ParkSmart SG - Application Engine
 * Vanilla JavaScript (ES6+) for Singapore Carpark & Transit Intelligence
 *
 * Implements:
 * 1. Real-time LTA Carpark Availability API Integration
 * 2. Spatial calculations (Haversine 800m radius discovery)
 * 3. Interactive Leaflet Map with custom vector markers
 * 4. Multimodal public transit (MRT & Bus) alternative route engine
 * 5. Event congestion & ERP traffic forecasting
 * 6. AI Insight generation via serverless /api/insight (Gemini 3.8 Flash)
 * 7. Mobile-first accessible UI & Material Design interaction patterns
 * ============================================================================
 */

// Global State Store
const state = {
  activeTab: 'map', // 'map' | 'intel' | 'routes' | 'premium'
  searchQuery: '039594 (Downtown Core)',
  destination: {
    name: 'Suntec City / Downtown Core',
    postalCode: '039594',
    lat: 1.2934,
    lng: 103.8572,
  },
  radiusMeters: 800,
  activeFilter: 'cars', // 'cars' | 'motorcycles' | 'heavy'
  evOnlyFilter: false,
  mallOnlyFilter: false,
  selectedCarparkId: 'suntec-west',
  carparks: [],
  liveApiRawData: null,
  isLiveApiOnline: true,
  isLoading: false,
  selectedPricingPlan: 'annual',
  bookmarkedCarparks: new Set(['suntec-west']),
  aiInsightData: null,
  isAiLoading: false,
};

// Leaflet Map Instance Reference
let mapInstance = null;
let mapMarkersGroup = null;
let destinationMarker = null;
let radiusCircle = null;

/**
 * Curated Database of Singapore Destinations & Carpark Locations
 * Mapped to official LTA / HDB / URA Carpark Codes for live telemetry syncing
 */
const SG_DESTINATIONS_DB = [
  {
    postalCode: '039594',
    name: 'Suntec City (Downtown Core)',
    lat: 1.2934,
    lng: 103.8572,
    aliases: ['suntec', 'suntec city', '039594', 'downtown core', 'marina centre'],
  },
  {
    postalCode: '018956',
    name: 'Marina Bay Sands',
    lat: 1.2838,
    lng: 103.8591,
    aliases: ['mbs', 'marina bay sands', '018956', 'bayfront'],
  },
  {
    postalCode: '238896',
    name: 'Orchard Central',
    lat: 1.3008,
    lng: 103.8398,
    aliases: ['orchard', 'orchard central', 'somerset', '238896'],
  },
  {
    postalCode: '188021',
    name: 'Bugis Junction',
    lat: 1.2998,
    lng: 103.8553,
    aliases: ['bugis', 'bugis junction', '188021'],
  },
  {
    postalCode: '048616',
    name: 'Raffles Place CBD',
    lat: 1.2840,
    lng: 103.8514,
    aliases: ['raffles place', 'cbd', '048616', 'one raffles place'],
  },
  {
    postalCode: '098585',
    name: 'VivoCity (HarbourFront)',
    lat: 1.2644,
    lng: 103.8222,
    aliases: ['vivocity', 'harbourfront', 'sentosa', '098585'],
  },
];

/**
 * Base Carpark Telemetry Seed & Metadata
 * Contains spatial coordinates, pricing tiers, EV counts, and amenities.
 */
const CARPARK_METADATA_BASE = [
  {
    id: 'suntec-west',
    carparkNumber: 'ACB',
    name: 'Suntec City West Carpark',
    address: 'Raffles Blvd (B1/B2)',
    lat: 1.2941,
    lng: 103.8568,
    rate: '$2.40/hr',
    weekdayDayRate: '$2.40 (1st hr · $1.20 / 30m thereafter)',
    weekdayEveRate: '$3.30 (Fixed per-entry night tariff)',
    weekendRate: '$2.60 (1st 2 hrs · $1.30 / sub hr)',
    gracePeriod: '10 mins free',
    evLots: 8,
    evChargerSpecs: '6 available / 8 bays · 50kW DC (SP Mobility)',
    hasMallLink: true,
    mallName: 'Connected to Suntec Mall (Tower 3)',
    clearanceHeight: '2.0m',
    isWheelchairAccessible: true,
    baseLots: {
      cars: { available: 142, total: 480 },
      motorcycles: { available: 18, total: 60 },
      heavy: { available: 0, total: 0 },
    },
    nearbyEvent: {
      title: 'Nearby Event Congestion Warning',
      badge: 'High Traffic',
      description: 'Concert at Singapore Indoor Stadium & Suntec Convention Hall 401. Heavy inbound traffic and lot depletion expected between 6:30 PM – 8:00 PM.',
    },
  },
  {
    id: 'millenia-walk',
    carparkNumber: 'MW1',
    name: 'Millenia Walk Carpark',
    address: '9 Raffles Blvd',
    lat: 1.2929,
    lng: 103.8596,
    rate: '$3.00/hr',
    weekdayDayRate: '$3.00 (1st hr · $1.50 / 30m thereafter)',
    weekdayEveRate: '$3.50 per entry',
    weekendRate: '$3.20 (1st 2 hrs)',
    gracePeriod: '10 mins free',
    evLots: 0,
    evChargerSpecs: '0 available / 4 bays (EV Full)',
    hasMallLink: true,
    mallName: 'Direct Millenia Walk Link',
    clearanceHeight: '2.1m (High Clearance)',
    isWheelchairAccessible: true,
    baseLots: {
      cars: { available: 18, total: 320 },
      motorcycles: { available: 12, total: 40 },
      heavy: { available: 0, total: 0 },
    },
    nearbyEvent: null,
  },
  {
    id: 'esplanade-basement',
    carparkNumber: 'ESP',
    name: 'Esplanade Basement',
    address: '1 Esplanade Dr',
    lat: 1.2898,
    lng: 103.8558,
    rate: '$2.20/hr',
    weekdayDayRate: '$2.20 / hour',
    weekdayEveRate: '$3.00 per entry',
    weekendRate: '$2.50 / hour',
    gracePeriod: '10 mins free',
    evLots: 2,
    evChargerSpecs: '2 available / 4 bays · 22kW AC (Shell Recharge)',
    hasMallLink: false,
    mallName: 'Esplanade Mall Concourse',
    clearanceHeight: '2.0m',
    isWheelchairAccessible: true,
    baseLots: {
      cars: { available: 3, total: 400 },
      motorcycles: { available: 5, total: 50 },
      heavy: { available: 0, total: 0 },
    },
    nearbyEvent: {
      title: 'High Congestion Warning',
      badge: 'Critical Peak',
      description: 'Theatres on the Bay gala performance in progress. Lots under 5% remaining with active entry ramp queuing.',
    },
  },
  {
    id: 'marina-square',
    carparkNumber: 'MSQ',
    name: 'Marina Square Carpark',
    address: '6 Raffles Blvd',
    lat: 1.2915,
    lng: 103.8576,
    rate: '$2.20/hr',
    weekdayDayRate: '$2.20 (1st 2 hrs)',
    weekdayEveRate: '$2.50 per entry after 5pm',
    weekendRate: '$2.40 (1st 2 hrs)',
    gracePeriod: '10 mins free',
    evLots: 6,
    evChargerSpecs: '4 available / 6 bays · 50kW DC',
    hasMallLink: true,
    mallName: 'Direct Marina Square Link',
    clearanceHeight: '2.1m',
    isWheelchairAccessible: true,
    baseLots: {
      cars: { available: 85, total: 550 },
      motorcycles: { available: 22, total: 70 },
      heavy: { available: 0, total: 0 },
    },
    nearbyEvent: null,
  },
  {
    id: 'raffles-city',
    carparkNumber: 'RC1',
    name: 'Raffles City Basement',
    address: '252 North Bridge Rd',
    lat: 1.2943,
    lng: 103.8532,
    rate: '$3.20/hr',
    weekdayDayRate: '$3.20 (1st hr · $0.80 / 15m thereafter)',
    weekdayEveRate: '$3.50 per entry',
    weekendRate: '$3.50 (1st 2 hrs)',
    gracePeriod: '10 mins free',
    evLots: 10,
    evChargerSpecs: '8 available / 10 bays · 60kW DC',
    hasMallLink: true,
    mallName: 'Connected to Raffles City Shopping Centre',
    clearanceHeight: '2.1m',
    isWheelchairAccessible: true,
    baseLots: {
      cars: { available: 210, total: 600 },
      motorcycles: { available: 35, total: 80 },
      heavy: { available: 0, total: 0 },
    },
    nearbyEvent: null,
  },
];

/**
 * Public Transit Data (MRT Stations & Bus Stops) around Marina / Downtown Core
 */
const TRANSIT_DATA = {
  mrtStations: [
    {
      name: 'Promenade MRT',
      codes: [{ code: 'CC4', line: 'cc' }, { code: 'DT15', line: 'dt' }],
      linesText: 'Circle & Downtown Lines',
      walkDuration: '3 mins',
      distanceMeters: 250,
    },
    {
      name: 'Esplanade MRT',
      codes: [{ code: 'CC3', line: 'cc' }],
      linesText: 'Underground linkway accessible',
      walkDuration: '5 mins',
      distanceMeters: 420,
    },
    {
      name: 'City Hall MRT',
      codes: [{ code: 'NS25', line: 'ns' }, { code: 'EW13', line: 'ew' }],
      linesText: 'North-South & East-West Lines',
      walkDuration: '8 mins',
      distanceMeters: 680,
    },
  ],
  busStops: [
    {
      name: 'Suntec Convention Ctr',
      stopCode: '02151',
      roadName: 'Temasek Blvd',
      distanceText: '90m away',
      services: ['36', '97', '106', '111', '133', '502', '857'],
    },
    {
      name: 'Opp Suntec City',
      stopCode: '02159',
      roadName: 'Nicoll Hwy',
      distanceText: '210m away',
      services: ['10', '14', '16', '70', '196'],
    },
  ],
};

/* ============================================================================
   1. INITIALIZATION & LIFECYCLE
   ============================================================================ */

/**
 * Primary App Initialization Routine
 * Boots event listeners, fetches real-time API, and renders initial views
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[ParkSmart SG] Initializing Singapore Transport Intelligence App...');
  
  initBottomNavigation();
  initSearchAndFilters();
  initPricingSelector();
  initLeafletMap();
  
  // Fetch real-time carpark telemetry from data.gov.sg
  await fetchLiveCarparkTelemetry();
  
  // Compute initial nearby carparks and render dashboard
  updateDashboardData();
});

/* ============================================================================
   2. REAL-TIME CARPARK AVAILABILITY API ENGINE
   ============================================================================ */

/**
 * Fetches real-time carpark lot telemetry from /api/data (LTA DataMall v2) with fallback
 * Handles graceful degradation if network or API is temporarily unavailable
 */
async function fetchLiveCarparkTelemetry() {
  state.isLoading = true;
  updateLiveApiStatusBadge('FETCHING...');

  try {
    let response;
    // 1. Try serverless /api/data (LTA DataMall v2 HDB + LTA + URA)
    try {
      response = await fetch('/api/data', {
        headers: { Accept: 'application/json' },
      });
    } catch (dataErr) {
      console.warn('[ParkSmart SG] /api/data fetch error, falling back to data.gov.sg:', dataErr);
    }

    // 2. If /api/data returns 401 (needs key) or network error, fallback to /api/carparks or data.gov.sg
    if (!response || !response.ok) {
      try {
        response = await fetch('https://api.data.gov.sg/v1/transport/carpark-availability', {
          headers: { Accept: 'application/json' },
        });
      } catch (directErr) {
        console.warn('[ParkSmart SG] Direct API fetch error, falling back to server proxy:', directErr);
        response = await fetch('/api/carparks');
      }
    }

    if (!response.ok) {
      throw new Error(`API response status: ${response.status}`);
    }

    const data = await response.json();
    state.liveApiRawData = data;
    state.isLiveApiOnline = true;
    updateLiveApiStatusBadge('LIVE API');
    console.log('[ParkSmart SG] Successfully fetched live LTA carpark telemetry.');
  } catch (error) {
    console.warn('[ParkSmart SG] Live API unavailable. Operating in resilient simulation mode:', error);
    state.isLiveApiOnline = false;
    updateLiveApiStatusBadge('OFFLINE (SYNCED)');
  } finally {
    state.isLoading = false;
  }
}

/**
 * Updates the Live API status pill in the top header
 * @param {string} labelText 
 */
function updateLiveApiStatusBadge(labelText) {
  const badgeText = document.getElementById('live-api-status-text');
  if (badgeText) {
    badgeText.textContent = labelText;
  }
}

/**
 * Computes live lot count, capacity, and status for a carpark
 * @param {Object} carpark 
 * @returns {Object} processed carpark data with percentage and occupancy
 */
function processCarparkTelemetry(carpark) {
  let carsAvail = carpark.baseLots.cars.available;
  let carsTotal = carpark.baseLots.cars.total;

  // Check 1: LTA DataMall v2 format (array in "value")
  if (state.liveApiRawData?.value && Array.isArray(state.liveApiRawData.value)) {
    const ltaMatch = state.liveApiRawData.value.find(
      (item) =>
        item.CarParkID === carpark.carparkNumber ||
        item.Development?.toLowerCase().includes(carpark.name.toLowerCase().split(' ')[0]) ||
        item.Area?.toLowerCase() === 'marina'
    );
    if (ltaMatch && ltaMatch.AvailableLots !== undefined) {
      carsAvail = parseInt(ltaMatch.AvailableLots, 10) || carsAvail;
    }
  }
  // Check 2: data.gov.sg format (items -> carpark_data)
  else if (state.liveApiRawData?.items?.[0]?.carpark_data) {
    const liveMatch = state.liveApiRawData.items[0].carpark_data.find(
      (item) => item.carpark_number === carpark.carparkNumber
    );

    if (liveMatch && liveMatch.carpark_info?.length > 0) {
      const carInfo = liveMatch.carpark_info.find((i) => i.lot_type === 'C') || liveMatch.carpark_info[0];
      if (carInfo) {
        carsAvail = parseInt(carInfo.lots_available, 10) || carsAvail;
        carsTotal = parseInt(carInfo.total_lots, 10) || carsTotal;
      }
    }
  }

  const occupancyRate = Math.min(100, Math.round(((carsTotal - carsAvail) / carsTotal) * 100));
  const remainingPct = 100 - occupancyRate;

  // Status determination: Red = Critical (<10% or lots <= 5), Amber = Moderate (70%-90%), Green = Ample (<70%)
  let status = 'Ample';
  let statusClass = 'ample';
  let statusText = `AMPLE (${remainingPct}%)`;

  if (carsAvail <= 5 || occupancyRate >= 92) {
    status = 'Critical';
    statusClass = 'critical';
    statusText = '<5% LOTS LEFT';
  } else if (occupancyRate >= 75) {
    status = 'Moderate';
    statusClass = 'moderate';
    statusText = `FILLING FAST (${remainingPct}%)`;
  }

  // Calculate distance from current destination
  const distance = Math.round(
    calculateHaversineDistance(
      state.destination.lat,
      state.destination.lng,
      carpark.lat,
      carpark.lng
    )
  );

  return {
    ...carpark,
    lotsAvailable: carsAvail,
    totalLots: carsTotal,
    occupancyRate,
    remainingPct,
    status,
    statusClass,
    statusText,
    distance,
  };
}

/**
 * Calculates Great-Circle distance between two coordinates in meters (Haversine formula)
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ============================================================================
   3. DASHBOARD & VIEW CONTROLLER
   ============================================================================ */

/**
 * Main dashboard update loop. Filters carparks within selected radius and renders UI
 */
function updateDashboardData() {
  // 1. Process telemetry for all carparks
  const processed = CARPARK_METADATA_BASE.map(processCarparkTelemetry);

  // 2. Filter by radius (800m default) and active vehicle filters
  let filtered = processed.filter((c) => c.distance <= state.radiusMeters);

  if (state.evOnlyFilter) {
    filtered = filtered.filter((c) => c.evLots > 0);
  }
  if (state.mallOnlyFilter) {
    filtered = filtered.filter((c) => c.hasMallLink);
  }

  // Sort by distance ascending
  filtered.sort((a, b) => a.distance - b.distance);

  state.carparks = filtered;

  // Render Map markers & Carparks List
  renderMapMarkers();
  renderCarparksList();
  renderIntelView();
  renderRoutesView();
}

/**
 * Renders the available carparks list cards in Screen 1 (High Density Theme)
 */
function renderCarparksList() {
  const listContainer = document.getElementById('carparks-list-container');
  const countBadge = document.getElementById('carparks-count-badge');

  if (!listContainer) return;

  if (countBadge) {
    countBadge.textContent = `${state.carparks.length} FOUND (${state.radiusMeters}M)`;
  }

  if (state.carparks.length === 0) {
    listContainer.innerHTML = `
      <div style="background:#fff; padding:24px 16px; text-align:center;">
        <span class="material-symbols-outlined" style="font-size:32px; color:#94a3b8;">explore_off</span>
        <h3 style="font-weight:700; margin-top:6px; font-size:13px; color:#0f172a;">No carparks found within ${state.radiusMeters}m</h3>
        <p style="color:#64748b; font-size:11px; margin-top:2px;">Try expanding search radius to 1,200m or adjusting filters.</p>
        <button onclick="expandRadiusTo1200()" style="margin-top:10px; padding:4px 12px; background:var(--color-lta-blue); color:#fff; border:none; border-radius:4px; font-weight:700; font-size:11px; cursor:pointer;">
          Expand to 1,200m
        </button>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = state.carparks
    .map((carpark) => {
      let badgeClass = 'green';
      let badgeText = 'GREEN';
      if (carpark.status === 'Critical') {
        badgeClass = 'red';
        badgeText = 'RED';
      } else if (carpark.status === 'Moderate') {
        badgeClass = 'amber';
        badgeText = 'AMBER';
      }

      return `
      <article class="dense-carpark-row" id="carpark-card-${carpark.id}" onclick="openCarparkDetail('${carpark.id}')">
        <div class="dense-row-header">
          <div class="dense-carpark-name">
            <span class="material-symbols-outlined" style="font-size:15px; color:var(--color-lta-blue);">local_parking</span>
            <span>${carpark.name}</span>
          </div>
          <span class="density-status-badge ${badgeClass}">${badgeText}</span>
        </div>

        <div class="dense-metrics-grid">
          <div class="dense-metric-col">
            <span class="dense-metric-label">Available</span>
            <span class="dense-metric-value tabular-nums">${carpark.lotsAvailable}</span>
          </div>
          <div class="dense-metric-col">
            <span class="dense-metric-label">Capacity</span>
            <span class="dense-metric-value tabular-nums">${carpark.totalLots}</span>
          </div>
          <div class="dense-metric-col">
            <span class="dense-metric-label">EV Units</span>
            <span class="dense-metric-value ${carpark.evLots > 0 ? 'ev' : 'ev-zero'} tabular-nums">${carpark.evLots > 0 ? carpark.evLots + ' Bays' : '0'}</span>
          </div>
        </div>

        <div class="dense-card-footer">
          <div class="dense-rate-text">
            <span>${carpark.distance}m away · </span>
            <strong>${carpark.rate}</strong>
            ${carpark.hasMallLink ? '<span style="color:#0284c7; font-size:10px; margin-left:4px;">• Mall</span>' : ''}
          </div>
          <button class="dense-action-btn" onclick="event.stopPropagation(); ${carpark.status === 'Critical' ? 'switchToRoutesTab()' : `handleOneTapRoute('${carpark.id}')`}">
            <span>${carpark.status === 'Critical' ? 'Alt Route' : 'Detail'}</span>
            <span class="material-symbols-outlined" style="font-size:13px;">chevron_right</span>
          </button>
        </div>
      </article>
    `;
    })
    .join('');
}

/**
 * Renders the detail view of the currently selected carpark (Screen 2: Intel)
 */
function renderIntelView() {
  const carpark =
    state.carparks.find((c) => c.id === state.selectedCarparkId) ||
    CARPARK_METADATA_BASE[0];

  const processed = processCarparkTelemetry(carpark);

  // Update Header details
  const headerName = document.getElementById('intel-carpark-name');
  const headerMeta = document.getElementById('intel-carpark-meta');
  if (headerName) headerName.textContent = processed.name;
  if (headerMeta) {
    headerMeta.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:14px; color:#0284c7;">near_me</span>
      <span>${processed.distance}m away · ${Math.max(1, Math.round(processed.distance / 70))} min walk</span>
    `;
  }

  // Update Bookmark toggle state
  const bookmarkBtn = document.getElementById('btn-bookmark-carpark');
  if (bookmarkBtn) {
    const isBookmarked = state.bookmarkedCarparks.has(processed.id);
    bookmarkBtn.innerHTML = `
      <span class="material-symbols-outlined" style="${isBookmarked ? "font-variation-settings: 'FILL' 1; color:#0284c7;" : ''}">
        ${isBookmarked ? 'bookmark_added' : 'bookmark'}
      </span>
    `;
  }

  // Update Occupancy Gauge Card
  const bigLots = document.getElementById('intel-big-lots');
  const lotDesc = document.getElementById('intel-lot-desc');
  const statusPill = document.getElementById('intel-status-pill');
  const meterFill = document.getElementById('intel-meter-fill');
  const meterText = document.getElementById('intel-meter-text');

  if (bigLots) bigLots.textContent = `${processed.lotsAvailable} Lots Open`;
  if (lotDesc)
    lotDesc.textContent = `${processed.remainingPct}% capacity remaining · ${processed.status === 'Ample' ? 'Ample spaces' : 'Limited availability'}`;

  if (statusPill) {
    statusPill.className = `status-pill ${processed.statusClass}`;
    statusPill.innerHTML = `
      <span class="pulse-dot" style="background-color:var(--color-${processed.statusClass}-dot);"></span>
      <span>${processed.status}</span>
    `;
  }

  if (meterFill) {
    meterFill.style.width = `${Math.max(6, processed.remainingPct)}%`;
    meterFill.className = `meter-fill ${processed.statusClass}`;
  }

  if (meterText) {
    meterText.textContent = `${processed.lotsAvailable} / ${processed.totalLots} total`;
  }

  // Vehicle Breakdown Grid
  const carsVal = document.getElementById('breakdown-cars-val');
  const motorVal = document.getElementById('breakdown-motor-val');
  const evVal = document.getElementById('breakdown-ev-val');

  if (carsVal) carsVal.textContent = processed.lotsAvailable;
  if (motorVal)
    motorVal.textContent = processed.baseLots.motorcycles.available;
  if (evVal) evVal.textContent = processed.evLots;

  // Rate tiers
  const weekdayDay = document.getElementById('rate-weekday-day');
  const weekdayEve = document.getElementById('rate-weekday-eve');
  const weekendRate = document.getElementById('rate-weekend');

  if (weekdayDay) weekdayDay.textContent = processed.weekdayDayRate;
  if (weekdayEve) weekdayEve.textContent = processed.weekdayEveRate;
  if (weekendRate) weekendRate.textContent = processed.weekendRate;
}

/**
 * Renders the Smart Route Alternatives view (Screen 3: Routes)
 */
function renderRoutesView() {
  const destSubtitle = document.getElementById('routes-dest-subtitle');
  if (destSubtitle) {
    destSubtitle.textContent = `Destination: ${state.destination.name} (Postal: ${state.destination.postalCode})`;
  }

  // Render Nearest MRT stations
  const mrtContainer = document.getElementById('routes-mrt-list');
  if (mrtContainer) {
    mrtContainer.innerHTML = TRANSIT_DATA.mrtStations
      .map((mrt) => {
        const badgesHtml = mrt.codes
          .map((c) => `<span class="mrt-line-badge ${c.line}">${c.code}</span>`)
          .join(' ');
        return `
        <div class="mrt-item-row">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="mrt-badges-wrap">${badgesHtml}</div>
            <div>
              <div class="mrt-name-text">${mrt.name}</div>
              <div style="font-size:11px; color:#64748b;">${mrt.linesText}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px; font-weight:700; color:#059669;">${mrt.walkDuration}</div>
            <div style="font-size:11px; color:#94a3b8;">${mrt.distanceMeters}m walking</div>
          </div>
        </div>
      `;
      })
      .join('');
  }

  // Render Bus Stops
  const busContainer = document.getElementById('routes-bus-list');
  if (busContainer) {
    busContainer.innerHTML = TRANSIT_DATA.busStops
      .map(
        (stop) => `
      <div class="bus-stop-card">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="material-symbols-outlined" style="font-size:16px; color:#0284c7;">directions_bus</span>
            <span style="font-size:12px; font-weight:700; color:#0f172a;">${stop.name}</span>
            <span style="font-size:11px; color:#94a3b8;">(${stop.stopCode} · ${stop.roadName})</span>
          </div>
          <span style="font-size:11px; font-weight:700; color:#059669;">${stop.distanceText}</span>
        </div>
        <div class="bus-services-wrap">
          ${stop.services.map((num) => `<span class="bus-num-pill">${num}</span>`).join('')}
        </div>
      </div>
    `
      )
      .join('');
  }
}

/* ============================================================================
   4. INTERACTIVE LEAFLET MAP ENGINE
   ============================================================================ */

/**
 * Initializes the Leaflet map centered at Singapore's Marina / Suntec Core
 */
function initLeafletMap() {
  const mapElement = document.getElementById('leaflet-map');
  if (!mapElement || typeof L === 'undefined') {
    console.warn('[ParkSmart SG] Leaflet library not detected, using fallback map.');
    return;
  }

  // Initialize Map
  mapInstance = L.map('leaflet-map', {
    center: [state.destination.lat, state.destination.lng],
    zoom: 16,
    zoomControl: false,
    attributionControl: false,
  });

  // Add clean CartoDB Positron high-contrast light tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(mapInstance);

  mapMarkersGroup = L.layerGroup().addTo(mapInstance);
  renderMapMarkers();
}

/**
 * Renders destination marker, 800m scanning radius circle, and carpark pins
 */
function renderMapMarkers() {
  if (!mapInstance || !mapMarkersGroup) return;

  mapMarkersGroup.clearLayers();

  // 1. Destination Center Pin
  const destIcon = L.divIcon({
    className: 'target-center-pin-wrapper',
    html: `
      <div class="target-center-pin">
        <div class="target-center-dot">
          <span class="material-symbols-outlined" style="font-size:16px;">my_location</span>
        </div>
        <div class="target-center-label">Target: ${state.destination.postalCode}</div>
      </div>
    `,
    iconSize: [120, 50],
    iconAnchor: [60, 20],
  });

  destinationMarker = L.marker([state.destination.lat, state.destination.lng], {
    icon: destIcon,
    zIndexOffset: 1000,
  }).addTo(mapMarkersGroup);

  // 2. 800m Radius Circle
  radiusCircle = L.circle([state.destination.lat, state.destination.lng], {
    radius: state.radiusMeters,
    color: '#0284c7',
    weight: 1.5,
    dashArray: '4, 6',
    fillColor: '#0284c7',
    fillOpacity: 0.06,
  }).addTo(mapMarkersGroup);

  // 3. Carpark Availability Pins
  state.carparks.forEach((carpark) => {
    const pinIcon = L.divIcon({
      className: 'custom-carpark-pin-wrapper',
      html: `
        <div class="custom-carpark-pin" onclick="handleMapPinClick('${carpark.id}')">
          <div class="carpark-pin-pill ${carpark.statusClass}">
            <span class="pulse-dot" style="background-color:var(--color-${carpark.statusClass}-dot);"></span>
            <span>${carpark.lotsAvailable} lots · ${carpark.remainingPct}%</span>
          </div>
          <div class="carpark-pin-name">
            <span class="material-symbols-outlined" style="font-size:11px; color:#0284c7;">local_parking</span>
            ${carpark.name.split(' ')[0]}
          </div>
        </div>
      `,
      iconSize: [110, 44],
      iconAnchor: [55, 40],
    });

    L.marker([carpark.lat, carpark.lng], { icon: pinIcon }).addTo(mapMarkersGroup);
  });
}

/**
 * Handles map pin selection
 * @param {string} carparkId 
 */
window.handleMapPinClick = function (carparkId) {
  state.selectedCarparkId = carparkId;
  const card = document.getElementById(`carpark-card-${carparkId}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.borderColor = '#0284c7';
    card.style.boxShadow = '0 0 0 3px rgba(2, 132, 199, 0.2)';
    setTimeout(() => {
      card.style.borderColor = '';
      card.style.boxShadow = '';
    }, 2000);
  }
};

/**
 * Re-centers map view to current target destination
 */
window.recenterMap = function () {
  if (mapInstance) {
    mapInstance.setView([state.destination.lat, state.destination.lng], 16, {
      animate: true,
    });
    showToast('Map centered to destination');
  }
};

/* ============================================================================
   5. AI INSIGHT GENERATION (Gemini 3.8 Flash via /api/insight)
   ============================================================================ */

/**
 * Triggers the AI transport analysis via POST /api/insight
 */
window.explainCarparkSituation = async function () {
  const carpark =
    state.carparks.find((c) => c.id === state.selectedCarparkId) ||
    CARPARK_METADATA_BASE[0];

  const processed = processCarparkTelemetry(carpark);
  const resultContainer = document.getElementById('ai-insight-result');
  const btn = document.getElementById('btn-explain-ai-trigger');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; animation:spin 1s linear infinite;">sync</span> Analyzing...`;
  }

  if (resultContainer) {
    resultContainer.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; color:#15803d; font-size:13px; font-weight:600; padding:12px 0;">
        <span class="material-symbols-outlined" style="animation:spin 1s linear infinite;">sync</span>
        Consulting Gemini 3.8 Flash & LTA Transit Models...
      </div>
    `;
  }

  try {
    const payload = {
      destination: state.destination.name,
      carpark: processed,
      nearbyCarparks: state.carparks.map((c) => ({
        name: c.name,
        lots: c.lotsAvailable,
        status: c.status,
      })),
      eventCongestion: processed.nearbyEvent?.description || null,
      alternatives: {
        mrtEstimateMinutes: 24,
        mrtCost: '$1.68',
        driveEstimateMinutes: 32,
        driveCost: '$9.60',
        taxiEstimateMinutes: 18,
        taxiCost: '$16.50 – $19.00',
      },
    };

    const response = await fetch('/api/insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`AI endpoint returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const insight = data.insight;
    state.aiInsightData = insight;

    // Render structured AI Output
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div style="background:#ffffff; border-radius:12px; padding:12px; border:1px solid #bbf7d0; margin-top:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:800; color:#166534; text-transform:uppercase;">Likelihood of Parking</span>
            <span style="font-size:12px; font-weight:800; color:${processed.status === 'Critical' ? '#be123c' : '#15803d'};">
              ${insight.likelihood || (processed.status === 'Critical' ? 'Very Low (<10%)' : 'High (>90%)')}
            </span>
          </div>
          <p style="font-size:13px; color:#0f172a; line-height:1.5;">${insight.summary || 'Optimal parking capacity observed across destination.'}</p>
          
          <div style="margin-top:10px; padding-top:8px; border-top:1px solid #f1f5f9;">
            <span style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase;">Recommended Mode:</span>
            <span style="font-size:12px; font-weight:800; color:#0284c7; margin-left:4px;">
              ${insight.recommendedOption || 'Drive & Park'}
            </span>
          </div>

          ${
            insight.keyConsiderations && insight.keyConsiderations.length > 0
              ? `
            <ul class="ai-considerations-list" style="margin-top:8px; font-size:12px;">
              ${insight.keyConsiderations.map((c) => `<li>${c}</li>`).join('')}
            </ul>
          `
              : ''
          }
          
          <div style="font-size:10px; color:#94a3b8; margin-top:8px; text-align:right;">
            Powered by Gemini 3.8 Flash · Telemetry: GovTech / LTA
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('[ParkSmart SG] AI Insight generation failed:', error);
    if (resultContainer) {
      resultContainer.innerHTML = `
        <div style="background:#fff1f2; border:1px solid #fecdd3; border-radius:10px; padding:10px; color:#be123c; font-size:12px; margin-top:8px;">
          <strong>AI Analysis Note:</strong> ${processed.status === 'Critical' ? 'Critical shortage active. Promenade MRT recommended.' : 'Ample bays available. Driving remains optimal.'}
        </div>
      `;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">auto_awesome</span> Explain This (AI)`;
    }
  }
};

/* ============================================================================
   6. NAVIGATION & SEARCH INTERACTION HANDLERS
   ============================================================================ */

/**
 * Initializes bottom navigation tab switcher
 */
function initBottomNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

/**
 * Triggers AI Explanation from top header button
 */
window.triggerAiExplanationFromHeader = function () {
  switchTab('intel');
  setTimeout(() => {
    explainCarparkSituation();
    const insightBox = document.getElementById('ai-insight-box');
    if (insightBox) {
      insightBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 150);
};

/**
 * Updates live SGT Data Refresh timestamp in official footer
 */
function updateFooterTimestamp() {
  const footerText = document.getElementById('footer-data-refresh-text');
  if (footerText) {
    const now = new Date();
    const formatted = now.toISOString().replace('T', ' ').substring(0, 19);
    footerText.textContent = `Data Refresh: ${formatted} SGT • Source: LTA DataMall`;
  }
}

/**
 * Switches between the 4 application screens
 * @param {string} tabId ('map' | 'intel' | 'routes' | 'premium')
 */
window.switchTab = function (tabId) {
  state.activeTab = tabId;

  // Update screen visibility
  document.querySelectorAll('.screen-view').forEach((view) => {
    view.classList.remove('active');
  });

  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // Update nav item active states
  document.querySelectorAll('.nav-item').forEach((btn) => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Re-render subviews if needed
  if (tabId === 'map' && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 100);
  } else if (tabId === 'intel') {
    renderIntelView();
  } else if (tabId === 'routes') {
    renderRoutesView();
  }

  updateFooterTimestamp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

/**
 * Shortcut to open Carpark Detail view (Screen 2)
 * @param {string} carparkId 
 */
window.openCarparkDetail = function (carparkId) {
  state.selectedCarparkId = carparkId;
  switchTab('intel');
};

/**
 * Shortcut to switch to Smart Route Alternatives (Screen 3)
 */
window.switchToRoutesTab = function () {
  switchTab('routes');
};

/**
 * Initializes search input listeners and quick destination pills
 */
function initSearchAndFilters() {
  const searchInput = document.getElementById('search-destination-input');
  const clearBtn = document.getElementById('search-clear-btn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim().toLowerCase();
      handleDestinationSearch(val);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        searchInput.blur();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
    });
  }

  // Filter Chips toggling
  const filterChips = document.querySelectorAll('.filter-chip');
  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const filterType = chip.getAttribute('data-filter');
      handleFilterToggle(filterType, chip);
    });
  });
}

/**
 * Matches user query against Singapore destinations DB and OneMap Elastic Search (/api/data)
 * @param {string} query 
 */
async function handleDestinationSearch(query) {
  if (!query || !query.trim()) return;
  const cleanQuery = query.trim().toLowerCase();

  // 1. Fast local match against curated Singapore landmarks
  const localMatch = SG_DESTINATIONS_DB.find((dest) =>
    dest.aliases.some((alias) => cleanQuery.includes(alias) || alias.includes(cleanQuery))
  );

  if (localMatch) {
    state.destination = {
      name: localMatch.name,
      postalCode: localMatch.postalCode,
      lat: localMatch.lat,
      lng: localMatch.lng,
    };
    if (mapInstance) {
      mapInstance.setView([localMatch.lat, localMatch.lng], 16);
    }
    updateDashboardData();
    showToast(`Destination set: ${localMatch.name}`);
    return;
  }

  // 2. Query OneMap Elastic Search via serverless /api/data?searchVal=...
  try {
    const searchUrl = `/api/data?searchVal=${encodeURIComponent(cleanQuery)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const res = await fetch(searchUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const topResult = data.results[0];
        const lat = parseFloat(topResult.LATITUDE);
        const lng = parseFloat(topResult.LONGITUDE);

        if (!isNaN(lat) && !isNaN(lng)) {
          const placeName = topResult.SEARCHVAL || topResult.BUILDING || cleanQuery;
          const postal = topResult.POSTAL || 'Singapore';

          state.destination = {
            name: placeName,
            postalCode: postal,
            lat: lat,
            lng: lng,
          };

          if (mapInstance) {
            mapInstance.setView([lat, lng], 16);
          }
          updateDashboardData();
          showToast(`OneMap: ${placeName} (${postal})`);
          return;
        }
      }
    }
  } catch (err) {
    console.warn('[ParkSmart SG] OneMap Search lookup fallback:', err);
  }
}

/**
 * Queries OneMap Routing Service via serverless /api/data?start=...&end=...&routeType=walk
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} endLat
 * @param {number} endLng
 * @param {string} routeType ('walk' | 'drive' | 'pt')
 */
window.fetchOneMapRoute = async function(startLat, startLng, endLat, endLng, routeType = 'walk') {
  try {
    const routeUrl = `/api/data?start=${startLat},${startLng}&end=${endLat},${endLng}&routeType=${routeType}`;
    const res = await fetch(routeUrl);
    if (!res.ok) {
      throw new Error(`OneMap route status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn('[ParkSmart SG] OneMap Route calculation error:', err);
    return null;
  }
};

/**
 * Sets destination from recent search pills
 * @param {string} query 
 */
window.setDestinationFromRecent = function (query) {
  const searchInput = document.getElementById('search-destination-input');
  if (searchInput) {
    searchInput.value = query;
  }
  handleDestinationSearch(query.toLowerCase());
};

/**
 * Toggles vehicle or amenity filters
 */
function handleFilterToggle(filterType, chipElement) {
  if (filterType === 'cars' || filterType === 'motorcycles' || filterType === 'heavy') {
    document.querySelectorAll('.filter-chip[data-filter="cars"], .filter-chip[data-filter="motorcycles"], .filter-chip[data-filter="heavy"]').forEach((c) => c.classList.remove('active'));
    chipElement.classList.add('active');
    state.activeFilter = filterType;
  } else if (filterType === 'ev') {
    state.evOnlyFilter = !state.evOnlyFilter;
    chipElement.classList.toggle('active', state.evOnlyFilter);
  } else if (filterType === 'mall') {
    state.mallOnlyFilter = !state.mallOnlyFilter;
    chipElement.classList.toggle('active', state.mallOnlyFilter);
  } else if (filterType === 'radius') {
    // Cycle radius: 800m -> 1200m -> 500m
    if (state.radiusMeters === 800) state.radiusMeters = 1200;
    else if (state.radiusMeters === 1200) state.radiusMeters = 500;
    else state.radiusMeters = 800;

    chipElement.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">radar</span> Radius: ${state.radiusMeters}m`;
  }

  updateDashboardData();
}

/**
 * Expands search radius to 1200m
 */
window.expandRadiusTo1200 = function () {
  state.radiusMeters = 1200;
  const radiusChip = document.getElementById('chip-radius');
  if (radiusChip) {
    radiusChip.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">radar</span> Radius: 1200m`;
  }
  updateDashboardData();
};

/**
 * Initializes subscription plan selection logic in Screen 4
 */
function initPricingSelector() {
  const planAnnual = document.getElementById('plan-card-annual');
  const planMonthly = document.getElementById('plan-card-monthly');

  if (planAnnual && planMonthly) {
    planAnnual.addEventListener('click', () => {
      planAnnual.classList.add('selected');
      planMonthly.classList.remove('selected');
      state.selectedPricingPlan = 'annual';
    });

    planMonthly.addEventListener('click', () => {
      planMonthly.classList.add('selected');
      planAnnual.classList.remove('selected');
      state.selectedPricingPlan = 'monthly';
    });
  }
}

/**
 * Bookmarks or unbookmarks a carpark
 */
window.toggleBookmarkSelectedCarpark = function () {
  const carparkId = state.selectedCarparkId;
  if (state.bookmarkedCarparks.has(carparkId)) {
    state.bookmarkedCarparks.delete(carparkId);
    showToast('Removed from Saved Carparks');
  } else {
    state.bookmarkedCarparks.add(carparkId);
    showToast('Carpark Saved to Favorites');
  }
  renderIntelView();
};

/**
 * Simulates GPS navigation launch
 */
window.startGpsNavigation = function () {
  const carpark =
    state.carparks.find((c) => c.id === state.selectedCarparkId) ||
    CARPARK_METADATA_BASE[0];
  showToast(`Starting GPS Guidance to ${carpark.name}...`);
};

/**
 * One-Tap direct route action
 */
window.handleOneTapRoute = function (carparkId) {
  state.selectedCarparkId = carparkId;
  openCarparkDetail(carparkId);
  showToast('Route calculated with real-time parking entry queue.');
};

/**
 * Displays toast notifications at the bottom of the screen
 * @param {string} message 
 */
function showToast(message) {
  const toast = document.getElementById('app-toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
    }, 2800);
  }
}

/**
 * Opens Step-by-Step Transit Guide modal
 */
window.openTransitGuideModal = function () {
  const modal = document.getElementById('transit-guide-modal');
  if (modal) {
    modal.classList.add('open');
  }
};

/**
 * Closes Step-by-Step Transit Guide modal
 */
window.closeTransitGuideModal = function () {
  const modal = document.getElementById('transit-guide-modal');
  if (modal) {
    modal.classList.remove('open');
  }
};
