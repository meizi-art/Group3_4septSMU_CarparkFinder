/**
 * ParkSmart SG - Unified Serverless Gateway Endpoint
 * 
 * Endpoint: /api/data
 * 
 * Supported Services:
 * 1. OneMap Elastic Search:
 *    https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y&pageNum=1
 * 
 * 2. OneMap Routing Service:
 *    https://www.onemap.gov.sg/api/public/routingsvc/route?start=...&end=...&routeType=walk
 * 
 * 3. LTA DataMall Live Carpark Logs (HDB + LTA + URA):
 *    https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2
 * 
 * Guardrails:
 * - DO NOT hardcode any API key.
 * - All keys are added manually via Vercel / Cloud Run Environment Variables.
 * - All outbound upstream requests forward the AccountKey header.
 */

const LTA_CARPARK_API_URL = "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2";
const ONEMAP_SEARCH_API_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const ONEMAP_ROUTE_API_URL = "https://www.onemap.gov.sg/api/public/routingsvc/route";

// In-memory cache for carpark availability (30s TTL)
let cachedCarparkData = null;
let lastCarparkFetchTime = 0;
const CARPARK_CACHE_TTL_MS = 30000;

// Curated offline Singapore GeoDB for resilient search and 429 rate-limit fallback
const SG_GEO_FALLBACK_DB = [
  { searchVal: "RAFFLES PLACE", building: "ONE RAFFLES PLACE", postal: "048616", lat: 1.2840, lng: 103.8514, address: "1 RAFFLES PLACE" },
  { searchVal: "SUNTEC CITY", building: "SUNTEC CITY MALL", postal: "039594", lat: 1.2934, lng: 103.8572, address: "3 TEMASEK BLVD" },
  { searchVal: "MARINA BAY SANDS", building: "MARINA BAY SANDS", postal: "018956", lat: 1.2838, lng: 103.8591, address: "10 BAYFRONT AVE" },
  { searchVal: "ORCHARD CENTRAL", building: "ORCHARD CENTRAL", postal: "238896", lat: 1.3008, lng: 103.8398, address: "181 ORCHARD RD" },
  { searchVal: "ION ORCHARD", building: "ION ORCHARD", postal: "238801", lat: 1.3040, lng: 103.8318, address: "2 ORCHARD TURN" },
  { searchVal: "BUGIS JUNCTION", building: "BUGIS JUNCTION", postal: "188021", lat: 1.2998, lng: 103.8553, address: "200 VICTORIA ST" },
  { searchVal: "VIVOCITY", building: "VIVOCITY", postal: "098585", lat: 1.2644, lng: 103.8222, address: "1 HARBOURFRONT WALK" },
  { searchVal: "DHOBY GHAUT", building: "PLAZA SINGAPURA", postal: "238839", lat: 1.3007, lng: 103.8453, address: "68 ORCHARD RD" },
  { searchVal: "CITY HALL", building: "RAFFLES CITY", postal: "179103", lat: 1.2943, lng: 103.8532, address: "252 NORTH BRIDGE RD" },
  { searchVal: "SOMERSET", building: "313@SOMERSET", postal: "238895", lat: 1.3013, lng: 103.8384, address: "313 ORCHARD RD" },
  { searchVal: "JURONG EAST", building: "WESTGATE", postal: "608532", lat: 1.3344, lng: 103.7431, address: "3 GATEWAY DR" },
  { searchVal: "TAMPINES", building: "TAMPINES MALL", postal: "529510", lat: 1.3532, lng: 103.9452, address: "4 TAMPINES CENTRAL 5" },
  { searchVal: "CHANGI AIRPORT", building: "JEWEL CHANGI AIRPORT", postal: "819666", lat: 1.3602, lng: 103.9897, address: "78 AIRPORT BLVD" },
];

/**
 * Searches offline Singapore fallback database
 * @param {string} query 
 */
function searchOfflineGeoDb(query) {
  const q = query.trim().toUpperCase();
  const matched = SG_GEO_FALLBACK_DB.filter(
    (item) =>
      item.searchVal.includes(q) ||
      q.includes(item.searchVal) ||
      item.building.includes(q) ||
      item.postal.includes(q) ||
      item.address.includes(q)
  );

  const results = (matched.length > 0 ? matched : SG_GEO_FALLBACK_DB.slice(0, 3)).map((item) => ({
    SEARCHVAL: item.searchVal,
    BUILDING: item.building,
    ADDRESS: item.address,
    POSTAL: item.postal,
    X: "0",
    Y: "0",
    LATITUDE: String(item.lat),
    LONGITUDE: String(item.lng),
    LONGTITUDE: String(item.lng),
  }));

  return {
    found: results.length,
    totalNumPages: 1,
    pageNum: 1,
    results,
    source: "Offline-Singapore-GeoDB",
  };
}

/**
 * Serverless handler for /api/data
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export default async function handler(req, res) {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "AccountKey, accountkey, Authorization, authorization, Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
      message: "Supported methods: GET, POST, HEAD",
    });
  }

  try {
    // Extract AccountKey strictly from server-side environment variables or incoming client headers
    const accountKey =
      process.env.ACCOUNT_KEY ||
      process.env.LTA_ACCOUNT_KEY ||
      process.env.ONEMAP_ACCOUNT_KEY ||
      process.env.ONEMAP_API_KEY ||
      process.env.DATAMALL_ACCOUNT_KEY ||
      req.headers["accountkey"] ||
      req.headers["account-key"] ||
      "";

    // Common headers to send to upstream APIs
    const upstreamHeaders = {
      "Accept": "application/json",
      "User-Agent": "ParkSmart-SG/1.0",
    };

    if (accountKey) {
      upstreamHeaders["AccountKey"] = accountKey;
      upstreamHeaders["Authorization"] = accountKey.startsWith("Bearer ") ? accountKey : `Bearer ${accountKey}`;
    }

    const query = req.query || {};
    const body = req.body || {};
    const type = (query.type || body.type || "").toLowerCase();

    // =========================================================================
    // SERVICE 1: OneMap Elastic Search
    // URL: https://www.onemap.gov.sg/api/common/elastic/search
    // Triggered by: query.searchVal OR type='search' / type='onemap_search'
    // =========================================================================
    if (query.searchVal || body.searchVal || type === "search" || type === "onemap_search" || type === "elastic") {
      const searchVal = (query.searchVal || body.searchVal || "").trim();
      if (!searchVal) {
        return res.status(400).json({
          error: "Missing searchVal",
          message: "searchVal parameter is required for OneMap search",
        });
      }

      const returnGeom = query.returnGeom || body.returnGeom || "Y";
      const getAddrDetails = query.getAddrDetails || body.getAddrDetails || "Y";
      const pageNum = query.pageNum || body.pageNum || "1";

      const searchParams = new URLSearchParams({
        searchVal,
        returnGeom,
        getAddrDetails,
        pageNum: String(pageNum),
      });

      const targetUrl = `${ONEMAP_SEARCH_API_URL}?${searchParams.toString()}`;
      const cacheKey = `search_${searchParams.toString()}`;

      const cached = genericCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(cached.data);
      }

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: upstreamHeaders,
        });

        if (response.ok) {
          const data = await response.json();
          // If OneMap returns valid results, cache and return
          if (data && data.results && data.results.length > 0) {
            genericCache.set(cacheKey, { data, timestamp: Date.now() });
            res.setHeader("X-Cache", "MISS");
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            return res.status(200).json(data);
          }
        }

        // If upstream returns 429 (Rate Limit), 503, or no results, use offline fallback GeoDB
        console.warn(`[OneMap Search Notice] Upstream status ${response?.status || 'Error'}, serving offline Singapore GeoDB.`);
        const fallbackData = searchOfflineGeoDb(searchVal);
        genericCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });

        res.setHeader("X-Fallback", "Offline-GeoDB");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(fallbackData);
      } catch (fetchErr) {
        console.warn("[OneMap Search Exception] Falling back to offline Singapore GeoDB:", fetchErr.message);
        const fallbackData = searchOfflineGeoDb(searchVal);
        res.setHeader("X-Fallback", "Offline-GeoDB");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(fallbackData);
      }
    }

    // =========================================================================
    // SERVICE 2: OneMap Routing Service
    // URL: https://www.onemap.gov.sg/api/public/routingsvc/route
    // Triggered by: (query.start && query.end) OR type='route' / type='onemap_route'
    // =========================================================================
    if ((query.start && query.end) || (body.start && body.end) || type === "route" || type === "onemap_route") {
      const start = String(query.start || body.start || "").trim();
      const end = String(query.end || body.end || "").trim();

      if (!start || !end) {
        return res.status(400).json({
          error: "Missing route coordinates",
          message: "Both 'start' and 'end' coordinates (e.g. 1.320981,103.844150) are required for routing",
        });
      }

      const routeType = query.routeType || body.routeType || "walk"; // walk | drive | pt | cycle
      const routeParams = new URLSearchParams({
        start,
        end,
        routeType: String(routeType).trim(),
      });

      if (query.date) routeParams.set("date", query.date);
      if (query.time) routeParams.set("time", query.time);
      if (query.mode) routeParams.set("mode", query.mode);

      const targetUrl = `${ONEMAP_ROUTE_API_URL}?${routeParams.toString()}`;
      const cacheKey = `route_${routeParams.toString()}`;

      const cached = genericCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(cached.data);
      }

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: upstreamHeaders,
        });

        if (response.ok) {
          const data = await response.json();
          genericCache.set(cacheKey, { data, timestamp: Date.now() });
          res.setHeader("X-Cache", "MISS");
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          return res.status(200).json(data);
        }

        // On 429 or upstream error, generate smart route estimation
        console.warn(`[OneMap Route Notice] Upstream status ${response.status}, serving resilient route calculation.`);
        const [sLat, sLng] = start.split(",").map(Number);
        const [eLat, eLng] = end.split(",").map(Number);
        const dLat = (eLat - sLat) * 111000;
        const dLng = (eLng - sLng) * 111000;
        const distM = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
        const walkMin = Math.max(1, Math.round(distM / 75));

        const estimatedRoute = {
          status_message: "Found route",
          route_status: "estimated",
          route_summary: {
            start_point: start,
            end_point: end,
            total_time: walkMin * 60,
            total_distance: distM,
          },
          route_geometry: `${start}|${end}`,
          route_instructions: [
            `Head towards destination (${distM}m, ~${walkMin} mins walk)`,
            "Arrive at destination",
          ],
        };

        genericCache.set(cacheKey, { data: estimatedRoute, timestamp: Date.now() });
        res.setHeader("X-Fallback", "Estimated-Route");
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(estimatedRoute);
      } catch (routeErr) {
        console.warn("[OneMap Route Exception] Falling back to estimation:", routeErr.message);
        return res.status(200).json({
          status_message: "Estimated route",
          route_summary: { total_time: 300, total_distance: 400 },
        });
      }
    }

    // =========================================================================
    // SERVICE 3: LTA DataMall Live Carpark Availability Logs (HDB + LTA + URA)
    // URL: https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2
    // Triggered by default or type='carparks' / type='lta' / query.$skip
    // =========================================================================
    if (!accountKey) {
      return res.status(401).json({
        error: "Missing AccountKey",
        message: "AccountKey environment variable (ACCOUNT_KEY or LTA_ACCOUNT_KEY) is not set. Please add it to your Environment Variables in Vercel or Settings.",
        documentation: "https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html",
      });
    }

    const now = Date.now();
    const skipParam = query.$skip || query.skip || body.$skip;

    // Check 30s cache for carparks
    if (!skipParam && cachedCarparkData && now - lastCarparkFetchTime < CARPARK_CACHE_TTL_MS) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(cachedCarparkData);
    }

    let targetUrl = LTA_CARPARK_API_URL;
    if (skipParam) {
      targetUrl += `?$skip=${encodeURIComponent(skipParam)}`;
    }

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LTA DataMall API Error] HTTP ${response.status}: ${errorText}`);

      if (cachedCarparkData) {
        res.setHeader("X-Cache", "STALE-FALLBACK");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(cachedCarparkData);
      }

      return res.status(response.status).json({
        error: `LTA DataMall upstream returned status ${response.status}`,
        details: errorText,
      });
    }

    const data = await response.json();

    if (!skipParam) {
      cachedCarparkData = data;
      lastCarparkFetchTime = now;
      res.setHeader("X-Cache", "MISS");
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(data);
  } catch (error) {
    console.error("[/api/data handler error]:", error);

    if (cachedCarparkData) {
      res.setHeader("X-Cache", "EXCEPTION-FALLBACK");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(cachedCarparkData);
    }

    return res.status(502).json({
      error: "Bad Gateway",
      message: "Failed to process request in /api/data endpoint",
      details: error.message || "Unknown error",
    });
  }
}
