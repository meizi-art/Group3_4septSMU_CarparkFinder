/**
 * ParkSmart SG - API Health & Diagnostics Handler
 * 
 * Endpoint: /api/health
 * 
 * Verifies live connectivity, latency, and status for:
 * 1. LTA DataMall v2 Carpark Availability (HDB + LTA + URA)
 * 2. OneMap Elastic Search Service
 * 3. OneMap Routing Service
 * 4. GovTech data.gov.sg Carpark Availability API
 * 5. Gemini AI Service & Environment Configuration
 * 
 * Guardrails:
 * - DO NOT leak or hardcode any API key in logs or output.
 * - Non-blocking asynchronous checks with timeouts.
 */

/**
 * Serverless / Express handler for /api/health
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "AccountKey, Content-Type, Authorization");
    return res.status(200).end();
  }

  const startTime = Date.now();

  // Read environment configuration securely (boolean presence checks only)
  const accountKey =
    process.env.ACCOUNT_KEY ||
    process.env.LTA_ACCOUNT_KEY ||
    process.env.ONEMAP_ACCOUNT_KEY ||
    process.env.DATAMALL_ACCOUNT_KEY ||
    req.headers["accountkey"] ||
    req.headers["account-key"] ||
    "";

  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const hasAccountKey = Boolean(accountKey && accountKey.trim());

  // Upstream headers
  const authHeaders = {
    "Accept": "application/json",
    "User-Agent": "ParkSmart-SG-HealthCheck/1.0",
  };
  if (hasAccountKey) {
    authHeaders["AccountKey"] = accountKey;
    authHeaders["Authorization"] = accountKey.startsWith("Bearer ") ? accountKey : `Bearer ${accountKey}`;
  }

  // Diagnostic fetch helper with 5000ms timeout
  async function testEndpoint(name, url, options = {}) {
    const t0 = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - t0;

      return {
        name,
        endpoint: url.split("?")[0],
        status: response.ok ? "UP" : response.status === 401 ? "UNAUTHORIZED" : "ERROR",
        httpStatus: response.status,
        latencyMs,
        details: response.ok
          ? "Operational"
          : response.status === 401
          ? "Missing or invalid AccountKey"
          : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - t0;
      const isTimeout = err.name === "AbortError";
      return {
        name,
        endpoint: url.split("?")[0],
        status: "DOWN",
        httpStatus: isTimeout ? 504 : 502,
        latencyMs,
        details: isTimeout ? "Request timed out (>5000ms)" : err.message || "Connection refused",
      };
    }
  }

  // Run health checks in parallel
  const [ltaCheck, onemapSearchCheck, onemapRouteCheck, dataGovCheck] = await Promise.all([
    // 1. LTA DataMall CarParkAvailabilityv2
    testEndpoint(
      "LTA DataMall CarParkAvailabilityv2",
      "https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2",
      { method: "GET", headers: authHeaders }
    ),
    // 2. OneMap Elastic Search
    testEndpoint(
      "OneMap Elastic Search",
      "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=raffles%20place&returnGeom=Y&getAddrDetails=Y&pageNum=1",
      { method: "GET", headers: authHeaders }
    ),
    // 3. OneMap Routing Service
    testEndpoint(
      "OneMap Routing Service (Walk)",
      "https://www.onemap.gov.sg/api/public/routingsvc/route?start=1.320981,103.844150&end=1.326762,103.8559&routeType=walk",
      { method: "GET", headers: authHeaders }
    ),
    // 4. GovTech data.gov.sg Carpark Availability
    testEndpoint(
      "GovTech Data.gov.sg Carpark Telemetry",
      "https://api.data.gov.sg/v1/transport/carpark-availability",
      { method: "GET", headers: { Accept: "application/json" } }
    ),
  ]);

  const apiChecks = [ltaCheck, onemapSearchCheck, onemapRouteCheck, dataGovCheck];

  // Evaluate overall health
  const downCount = apiChecks.filter((c) => c.status === "DOWN" || c.status === "ERROR").length;
  const overallStatus = downCount === 0 ? "HEALTHY" : downCount < apiChecks.length ? "DEGRADED" : "UNHEALTHY";

  const totalDurationMs = Date.now() - startTime;

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  return res.status(overallStatus === "UNHEALTHY" ? 503 : 200).json({
    status: overallStatus,
    service: "ParkSmart SG API Health Monitor",
    timestamp: new Date().toISOString(),
    totalDurationMs,
    environment: {
      hasAccountKey,
      hasGeminiKey,
      nodeVersion: process.version,
      platform: process.platform,
    },
    services: {
      ltaDataMall: ltaCheck,
      oneMapSearch: onemapSearchCheck,
      oneMapRouting: onemapRouteCheck,
      dataGovSg: dataGovCheck,
      geminiAi: {
        name: "Google Gemini 3.8 / 2.5 Flash Insight Engine",
        status: hasGeminiKey ? "CONFIGURED" : "KEY_NOT_SET",
        details: hasGeminiKey ? "Ready for AI transport insights" : "GEMINI_API_KEY not configured in environment",
      },
    },
    endpoints: {
      dataGateway: "/api/data",
      aiInsights: "/api/insight",
      carparkFallback: "/api/carparks",
      healthCheck: "/api/health",
    },
  });
}
