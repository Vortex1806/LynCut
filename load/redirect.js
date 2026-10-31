import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

/**
 * Load test for the redirect hot path.
 *
 *   k6 run -e BASE=http://localhost:3000 load/redirect.js
 *
 * setup() seeds real links through the API, then the test picks codes at
 * random. Hammering a single code would measure Redis serving one key,
 * which is not a number that means anything.
 */

const BASE = __ENV.BASE || "http://localhost:3000";
const SEED_LINKS = Number(__ENV.SEED_LINKS || 200);

const redirectLatency = new Trend("redirect_latency", true);
const redirectOk = new Rate("redirect_ok");

export const options = {
  scenarios: {
    redirect: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },   // warm the cache
        { duration: "1m", target: 200 },   // climb
        { duration: "1m", target: 400 },   // push
        { duration: "30s", target: 0 },    // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // p99, not the average: an average of 10ms hides 1% of requests taking
    // two seconds, and at scale that 1% is a lot of people.
    "http_req_duration{expected_response:true}": ["p(95)<100", "p(99)<250"],
    http_req_failed: ["rate<0.01"],
    redirect_ok: ["rate>0.99"],
  },
  // Follow nothing: we are measuring the 302, not example.com.
  noVUConnectionReuse: false,
  discardResponseBodies: true,
};

export function setup() {
  const email = `loadtest-${Date.now()}@example.com`;
  const headers = { "Content-Type": "application/json" };

  const signup = http.post(
    `${BASE}/api/auth/signup`,
    JSON.stringify({ name: "Load Test", email, password: "supersecret123" }),
    { headers },
  );

  if (signup.status !== 201) {
    throw new Error(`signup failed: ${signup.status} ${signup.body}`);
  }

  const token = signup.json("accessToken");
  const auth = { ...headers, Authorization: `Bearer ${token}` };
  const codes = [];

  for (let i = 0; i < SEED_LINKS; i++) {
    const res = http.post(
      `${BASE}/api/links`,
      JSON.stringify({ targetUrl: `https://example.com/load/${i}` }),
      { headers: auth },
    );

    if (res.status === 201) codes.push(res.json("shortCode"));
  }

  if (codes.length === 0) {
    throw new Error("seeded no links; is RATE_LIMIT_API_MAX too low?");
  }

  console.log(`seeded ${codes.length} links`);
  return { codes };
}

export default function (data) {
  const code = data.codes[Math.floor(Math.random() * data.codes.length)];

  const res = http.get(`${BASE}/${code}`, { redirects: 0 });

  const ok = check(res, {
    "status is 302": (r) => r.status === 302,
  });

  redirectOk.add(ok);
  redirectLatency.add(res.timings.duration);
}

export function handleSummary(data) {
  const m = data.metrics;
  const p = (metric, stat) => Math.round(m[metric]?.values?.[stat] ?? 0);

  const summary = `
LynCut redirect path
====================
requests/sec (mean) : ${Math.round(m.http_reqs?.values?.rate ?? 0)}
total requests      : ${m.http_reqs?.values?.count ?? 0}
error rate          : ${((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(3)}%

latency
  p50 : ${p("http_req_duration", "med")} ms
  p95 : ${p("http_req_duration", "p(95)")} ms
  p99 : ${p("http_req_duration", "p(99)")} ms
  max : ${p("http_req_duration", "max")} ms
`;

  return {
    stdout: summary,
    "load/results.json": JSON.stringify(data, null, 2),
  };
}
