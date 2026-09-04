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

// In-memory cache for search & routes (60s TTL)
const genericCache = new Map();
const GENERIC_CACHE_TTL_MS = 60000;

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
      const searchVal = query.searchVal || body.searchVal || "";
      if (!searchVal.trim()) {
        return res.status(400).json({
          error: "Missing searchVal",
          message: "searchVal parameter is required for OneMap search",
        });
      }

      const returnGeom = query.returnGeom || body.returnGeom || "Y";
      const getAddrDetails = query.getAddrDetails || body.getAddrDetails || "Y";
      const pageNum = query.pageNum || body.pageNum || "1";

      const searchParams = new URLSearchParams({
        searchVal: searchVal.trim(),
        returnGeom,
        getAddrDetails,
        pageNum: String(pageNum),
      });

      const targetUrl = `${ONEMAP_SEARCH_API_URL}?${searchParams.toString()}`;
      const cacheKey = `search_${searchParams.toString()}`;

      const cached = genericCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < GENERIC_CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(cached.data);
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: upstreamHeaders,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[OneMap Search Error] HTTP ${response.status}:`, errText);
        return res.status(response.status).json({
          error: `OneMap Search returned status ${response.status}`,
          details: errText,
        });
      }

      const data = await response.json();
      genericCache.set(cacheKey, { data, timestamp: Date.now() });

      res.setHeader("X-Cache", "MISS");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(data);
    }

    // =========================================================================
    // SERVICE 2: OneMap Routing Service
    // URL: https://www.onemap.gov.sg/api/public/routingsvc/route
    // Triggered by: (query.start && query.end) OR type='route' / type='onemap_route'
    // =========================================================================
    if ((query.start && query.end) || (body.start && body.end) || type === "route" || type === "onemap_route") {
      const start = query.start || body.start;
      const end = query.end || body.end;

      if (!start || !end) {
        return res.status(400).json({
          error: "Missing route coordinates",
          message: "Both 'start' and 'end' coordinates (e.g. 1.320981,103.844150) are required for routing",
        });
      }

      const routeType = query.routeType || body.routeType || "walk"; // walk | drive | pt | cycle
      const routeParams = new URLSearchParams({
        start: String(start).trim(),
        end: String(end).trim(),
        routeType: String(routeType).trim(),
      });

      // Optional public transport parameters
      if (query.date) routeParams.set("date", query.date);
      if (query.time) routeParams.set("time", query.time);
      if (query.mode) routeParams.set("mode", query.mode);

      const targetUrl = `${ONEMAP_ROUTE_API_URL}?${routeParams.toString()}`;
      const cacheKey = `route_${routeParams.toString()}`;

      const cached = genericCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < GENERIC_CACHE_TTL_MS) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(200).json(cached.data);
      }

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: upstreamHeaders,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[OneMap Route Error] HTTP ${response.status}:`, errText);
        return res.status(response.status).json({
          error: `OneMap Route service returned status ${response.status}`,
          details: errText,
          guide: "Ensure valid coordinates and that ACCOUNT_KEY / ONEMAP_ACCOUNT_KEY is configured in environment variables if required.",
        });
      }

      const data = await response.json();
      genericCache.set(cacheKey, { data, timestamp: Date.now() });

      res.setHeader("X-Cache", "MISS");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(data);
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
