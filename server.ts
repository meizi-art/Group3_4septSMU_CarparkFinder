/**
 * ParkSmart SG - Express & Vite Server
 * Provides server-side proxying for Gemini AI insight generation and LTA Carpark data
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import insightHandler from "./api/insight.js";
import dataHandler from "./api/data.js";
import healthHandler from "./api/health.js";

const app = express();
const PORT = 3000;

app.use(express.json());

// Comprehensive API Health Check & Diagnostics Endpoint
app.all("/api/health", async (req, res) => {
  await healthHandler(req, res);
});

// Serverless Live Carpark Availability Endpoint (HDB + LTA + URA via LTA DataMall v2)
app.all("/api/data", async (req, res) => {
  await dataHandler(req, res);
});

// Proxy for live Singapore Carpark Availability API (handles CORS & fallback caching)
let cachedCarparkData = null;
let lastCacheTime = 0;

app.get("/api/carparks", async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 30 seconds to respect rate limits
    if (cachedCarparkData && (now - lastCacheTime < 30000)) {
      return res.json(cachedCarparkData);
    }

    const response = await fetch("https://api.data.gov.sg/v1/transport/carpark-availability", {
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Data.gov.sg API returned status ${response.status}`);
    }

    const data = await response.json();
    cachedCarparkData = data;
    lastCacheTime = now;
    res.json(data);
  } catch (error) {
    console.warn("Failed to fetch upstream carpark data, returning cached or fallback response:", error);
    if (cachedCarparkData) {
      return res.json(cachedCarparkData);
    }
    res.status(502).json({ error: "Failed to fetch live carpark telemetry", details: (error as Error).message });
  }
});

// Server-side AI Insight handler
app.post("/api/insight", async (req, res) => {
  await insightHandler(req, res);
});

// Setup Vite middleware in dev or static file serving in production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[ParkSmart SG] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
