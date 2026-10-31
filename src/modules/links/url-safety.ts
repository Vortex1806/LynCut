import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../../config/env.js";
import ipaddr from "ipaddr.js";

import { ValidationError } from "../../shared/errors.js";

const MAX_URL_LENGTH = 2048;

const BLOCK_PRIVATE_ADDRESSES = env.BLOCK_PRIVATE_ADDRESSES;

function rejectUrl(message: string): never {
  throw new ValidationError(message);
}

function assertPublicIP(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;

  try {
    parsed = ipaddr.process(address);
  } catch {
    return rejectUrl("Invalid destination IP address");
  }

  if (parsed.range() !== "unicast") {
    rejectUrl("Private or restricted destination addresses are not allowed");
  }
}

export async function validateDestinationUrl(value: string): Promise<URL> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_URL_LENGTH
  ) {
    rejectUrl("URL must be between 1 and 2048 characters.");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    rejectUrl("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    rejectUrl("Only HTTP and HTTPS are allowed");
  }

  if (!url.hostname) {
    rejectUrl("URL must have a hostname");
  }

  if (url.username || url.password) {
    rejectUrl("URLs containing credentials are not allowed");
  }

  if (!BLOCK_PRIVATE_ADDRESSES) {
    return url;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // Case 1: The URL directly contains an IP address.
  if (isIP(hostname)) {
    assertPublicIP(hostname);
    return url;
  }

  // Case 2: The hostname must resolve only to public IP addresses.
  let addresses: Awaited<ReturnType<typeof lookup>>[];

  try {
    addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    return rejectUrl("Destination hostname could not be resolved.");
  }

  if (addresses.length === 0) {
    rejectUrl("Destination hostname has no IP addresses.");
  }

  for (const address of addresses) {
    assertPublicIP(address.address);
  }

  return url;
}
