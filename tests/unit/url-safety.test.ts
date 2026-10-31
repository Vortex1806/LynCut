import { describe, it, expect } from "vitest";
import { validateDestinationUrl } from "../../src/modules/links/url-safety.js";
import { ValidationError } from "../../src/shared/errors.js";

/**
 * The highest-value tests in the suite: a regression here is a
 * vulnerability, not a bug. An open redirector that accepts javascript:
 * lends your domain's reputation to someone else's payload.
 */
describe("validateDestinationUrl", () => {
  const reject = async (url: string) =>
    expect(validateDestinationUrl(url)).rejects.toBeInstanceOf(ValidationError);

  // Public IP literals, not hostnames: a hostname would trigger a real DNS
  // lookup, making a unit test depend on the network and on a resolver.
  it("accepts https and http to public addresses", async () => {
    await expect(
      validateDestinationUrl("https://8.8.8.8/a/b?c=d#e"),
    ).resolves.toBeInstanceOf(URL);
    await expect(validateDestinationUrl("http://1.1.1.1")).resolves.toBeInstanceOf(URL);
    await expect(
      validateDestinationUrl("https://[2606:4700:4700::1111]/"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("preserves the path, query and fragment", async () => {
    const url = await validateDestinationUrl("https://8.8.8.8/a/b?c=d#e");
    expect(url.pathname).toBe("/a/b");
    expect(url.search).toBe("?c=d");
    expect(url.hash).toBe("#e");
  });

  it("rejects non-http(s) schemes", async () => {
    // Zod's .url() accepts all of these; only an allowlist stops them.
    await reject("javascript:alert(1)");
    await reject("data:text/html,<script>alert(1)</script>");
    await reject("file:///etc/passwd");
    await reject("ftp://example.com");
    await reject("vbscript:msgbox(1)");
  });

  it("rejects malformed input", async () => {
    await reject("not-a-url");
    await reject("");
    await reject("https://");
  });

  it("rejects URLs carrying credentials", async () => {
    // http://paypal.com@evil.example reads as PayPal to a hurried human.
    await reject("http://user:pass@example.com");
    await reject("https://admin@example.com");
  });

  it("rejects an over-long URL", async () => {
    await reject(`https://example.com/${"x".repeat(2100)}`);
  });

  it("rejects loopback, private and link-local addresses", async () => {
    await reject("http://127.0.0.1/");
    await reject("http://localhost/");
    await reject("http://10.0.0.1/");
    await reject("http://192.168.1.1/");
    await reject("http://172.16.0.1/");
    // Cloud metadata: the canonical SSRF target.
    await reject("http://169.254.169.254/latest/meta-data/");
    await reject("http://0.0.0.0/");
  });

  it("rejects IPv6 loopback and its IPv4-mapped form", async () => {
    await reject("http://[::1]/");
    // ::ffff:127.0.0.1 is loopback wearing an IPv6 costume; a naive
    // string check on "127." would miss it.
    await reject("http://[::ffff:127.0.0.1]/");
    await reject("http://[fc00::1]/");
  });
});
