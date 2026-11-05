import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { URL } from 'node:url';

export interface SafeNetworkResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json: <T = any>() => Promise<T>;
  text: () => Promise<string>;
  buffer: () => Promise<Buffer>;
}

export interface SafeNetworkRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxRedirects?: number;
  customAllowedHosts?: string[];
  dnsLookupOverride?: (hostname: string) => Promise<string[]>;
  /** Optional injectable transport for isolated offline testing of the real redirect loop */
  mockTransport?: (url: URL, options: SafeNetworkRequestOptions, pinnedIp: string) => Promise<SafeNetworkResponse>;
}

export class SafeIpValidator {
  /**
   * Evaluates whether an IPv4 address belongs to a private, loopback, link-local,
   * multicast, or reserved range.
   */
  static isRestrictedIpv4(ip: string): boolean {
    if (!net.isIPv4(ip)) return true;
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [o0, o1, o2, o3] = parts;

    // 0.0.0.0/8 (Current network)
    if (o0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (o0 === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (o0 === 127) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;
    // 169.254.0.0/16 (Link-local, including Cloud Metadata 169.254.169.254)
    if (o0 === 169 && o1 === 254) return true;
    // 172.16.0.0/12 (Private)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (o0 === 192 && o1 === 0 && o2 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (o0 === 192 && o1 === 0 && o2 === 2) return true;
    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (o0 === 192 && o1 === 88 && o2 === 99) return true;
    // 192.168.0.0/16 (Private)
    if (o0 === 192 && o1 === 168) return true;
    // 198.18.0.0/15 (Network Benchmark Tests)
    if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (o0 === 198 && o1 === 51 && o2 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (o0 === 203 && o1 === 0 && o2 === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (o0 >= 224 && o0 <= 239) return true;
    // 240.0.0.0/4 (Reserved / Class E)
    if (o0 >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (o0 === 255 && o1 === 255 && o2 === 255 && o3 === 255) return true;

    return false;
  }

  /**
   * Expands an IPv6 string into a 16-byte array, taking into account '::' compression
   * and IPv4-mapped/compatible trailing formats (e.g. ::ffff:192.168.1.1).
   */
  static parseIpv6ToBytes(ip: string): number[] | null {
    if (!net.isIPv6(ip)) return null;

    let v4Part: number[] | null = null;
    const lastColon = ip.lastIndexOf(':');
    const possibleV4 = ip.substring(lastColon + 1);
    let workingIp = ip;

    if (net.isIPv4(possibleV4)) {
      v4Part = possibleV4.split('.').map(Number);
      workingIp = ip.substring(0, lastColon) + ':0:0';
    }

    const parts = workingIp.split('::');
    if (parts.length > 2) return null; // Invalid multiple ::

    let left = parts[0] ? parts[0].split(':').filter(Boolean).map(h => parseInt(h, 16)) : [];
    let right = parts.length > 1 && parts[1] ? parts[1].split(':').filter(Boolean).map(h => parseInt(h, 16)) : [];

    if (parts.length === 1) {
      left = workingIp.split(':').filter(Boolean).map(h => parseInt(h, 16));
      right = [];
    }

    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;

    const fullWords = [...left, ...new Array(missing).fill(0), ...right];
    if (fullWords.length !== 8) return null;

    const bytes: number[] = [];
    for (const word of fullWords) {
      bytes.push((word >> 8) & 0xff, word & 0xff);
    }

    if (v4Part) {
      bytes[12] = v4Part[0];
      bytes[13] = v4Part[1];
      bytes[14] = v4Part[2];
      bytes[15] = v4Part[3];
    }

    return bytes;
  }

  /**
   * Evaluates whether an IPv6 address belongs to a private, loopback, link-local,
   * multicast, documentation, or reserved range, including IPv4-mapped and IPv4-compatible representations.
   */
  static isRestrictedIpv6(ip: string): boolean {
    const bytes = this.parseIpv6ToBytes(ip);
    if (!bytes || bytes.length !== 16) return true;

    // Check if IPv4-mapped (::ffff:x.x.x.x) or IPv4-compatible (::x.x.x.x)
    const isFirst10Zero = bytes.slice(0, 10).every(b => b === 0);
    const isMapped = isFirst10Zero && bytes[10] === 0xff && bytes[11] === 0xff;
    const isCompatible = isFirst10Zero && bytes[10] === 0x00 && bytes[11] === 0x00;

    if (isMapped || isCompatible) {
      const embeddedIpv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
      // In either mapped or compatible form, validate the embedded IPv4
      if (this.isRestrictedIpv4(embeddedIpv4)) return true;
      if (isCompatible) {
        // Exclude loopback ::1 which has last byte 1
        const isLoopback = bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1;
        if (!isLoopback) return true; // Deprecated IPv4-compatible IPv6 addresses are non-standard/restricted
      }
    }

    // ::1/128 (Loopback)
    const isLoopback = bytes.slice(0, 15).every(b => b === 0) && bytes[15] === 1;
    if (isLoopback) return true;

    // ::/128 (Unspecified)
    const isUnspecified = bytes.every(b => b === 0);
    if (isUnspecified) return true;

    // fc00::/7 (Unique Local Address - ULA, covers fc00:: and fd00::)
    if ((bytes[0] & 0xfe) === 0xfc) return true;

    // fe80::/10 (Link-Local Unicast)
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

    // fec0::/10 (Site-Local, deprecated)
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;

    // ff00::/8 (Multicast)
    if (bytes[0] === 0xff) return true;

    // 2001:db8::/32 (Documentation)
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

    // 100::/64 (Discard Prefix)
    if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every(b => b === 0)) return true;

    return false;
  }

  /**
   * Returns true if the IP (v4 or v6) is restricted / non-public.
   */
  static isRestrictedIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      return this.isRestrictedIpv4(ip);
    }
    if (net.isIPv6(ip)) {
      return this.isRestrictedIpv6(ip);
    }
    return true; // Not a valid IP
  }
}

export class SafeNetworkClient {
  public static readonly DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze([
    'api.vapi.ai',
    'vapi-public.s3.amazonaws.com',
    'storage.googleapis.com',
    'api.telnyx.com',
    'api.retellai.com',
  ]);

  /**
   * Validates target URL against SSRF rules:
   * - Protocol must be https:
   * - Port must be 443 (or default)
   * - No userinfo credentials in URL
   * - Hostname must be in the approved host allowlist
   */
  static validateUrl(rawUrl: string, allowedHosts: string[] = [...this.DEFAULT_ALLOWED_HOSTS]): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch (err: any) {
      throw new Error(`SSRF_BLOCKED: Invalid URL: ${err?.message || rawUrl}`);
    }

    // 1. Protocol check
    if (parsed.protocol !== 'https:') {
      throw new Error(`SSRF_BLOCKED: Protocol "${parsed.protocol}" is forbidden. Only "https:" is permitted.`);
    }

    // 2. Port check (must be empty/default 443 or explicitly 443)
    if (parsed.port && parsed.port !== '443') {
      throw new Error(`SSRF_BLOCKED: Non-standard port "${parsed.port}" is forbidden.`);
    }

    // 3. Userinfo / credentials check
    if (parsed.username || parsed.password) {
      throw new Error('SSRF_BLOCKED: URLs containing user credentials (user:pass@host) are forbidden.');
    }

    // 4. Hostname check
    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname) {
      throw new Error('SSRF_BLOCKED: Hostname is empty.');
    }

    // Host must match the allowlist exactly (no suffix wildcards)
    const isAllowed = allowedHosts.some(allowed => allowed.toLowerCase().trim() === hostname);
    if (!isAllowed) {
      throw new Error(`SSRF_BLOCKED: Host "${hostname}" is not in the approved host allowlist.`);
    }

    return parsed;
  }

  /**
   * Performs pre-request DNS resolution, validates all resolved IP addresses,
   * and returns the pinned public IP to defend against DNS rebinding.
   */
  static async resolveAndValidateHost(
    hostname: string,
    dnsLookupOverride?: (hostname: string) => Promise<string[]>
  ): Promise<string> {
    let ips: string[] = [];

    if (dnsLookupOverride) {
      ips = await dnsLookupOverride(hostname);
    } else {
      try {
        const records = await dns.promises.lookup(hostname, { all: true });
        ips = records.map(r => r.address);
      } catch (err: any) {
        throw new Error(`SSRF_BLOCKED: DNS resolution failed for "${hostname}": ${err?.message || err}`);
      }
    }

    if (!ips || ips.length === 0) {
      throw new Error(`SSRF_BLOCKED: No DNS records found for host "${hostname}".`);
    }

    // Fail closed: EVERY resolved IP must be public and non-restricted
    for (const ip of ips) {
      if (SafeIpValidator.isRestrictedIp(ip)) {
        throw new Error(`SSRF_BLOCKED: Host "${hostname}" resolved to prohibited non-public IP: ${ip}`);
      }
    }

    return ips[0];
  }

  /**
   * Sanitizes URLs and messages for logging to prevent leaking secrets or query tokens.
   */
  static sanitizeForLogging(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.search = '';
      parsed.hash = '';
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return '[REDACTED_URL]';
    }
  }

  /**
   * Secure HTTP request execution with connection-level IP pinning and manual redirect validation.
   */
  static async fetch(rawUrl: string, options: SafeNetworkRequestOptions = {}): Promise<SafeNetworkResponse> {
    const maxRedirects = options.maxRedirects ?? 3;
    let currentUrl = rawUrl;
    let redirectCount = 0;

    const allowedHosts = options.customAllowedHosts || [...this.DEFAULT_ALLOWED_HOSTS];

    while (redirectCount <= maxRedirects) {
      const parsedUrl = this.validateUrl(currentUrl, allowedHosts);
      const pinnedIp = await this.resolveAndValidateHost(parsedUrl.hostname, options.dnsLookupOverride);

      const response = options.mockTransport
        ? await options.mockTransport(parsedUrl, options, pinnedIp)
        : await this.executePinnedRequest(parsedUrl, pinnedIp, options);

      // Check if redirect response (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers['location'];
        if (!location) {
          return response;
        }

        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error(`SSRF_BLOCKED: Maximum redirect limit of ${maxRedirects} exceeded.`);
        }

        // Resolve redirect URL relative to the current URL and validate fully on next loop
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = nextUrl;
        continue;
      }

      return response;
    }

    throw new Error('SSRF_BLOCKED: Redirect loop or exceeded limit.');
  }

  /**
   * Low-level socket connection pinned directly to the pre-validated IP address,
   * preserving SNI servername for TLS certificate validation.
   */
  private static executePinnedRequest(
    parsedUrl: URL,
    pinnedIp: string,
    options: SafeNetworkRequestOptions
  ): Promise<SafeNetworkResponse> {
    return new Promise((resolve, reject) => {
      const isIpv6 = net.isIPv6(pinnedIp);

      const requestOptions: https.RequestOptions = {
        method: options.method || 'GET',
        hostname: pinnedIp, // Direct socket connection to the validated IP (prevents DNS rebinding)
        port: 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          Host: parsedUrl.host, // Preserves original host header
          ...(options.headers || {}),
        },
        servername: parsedUrl.hostname, // Sets TLS SNI to the domain name so certificate verification succeeds
        timeout: options.timeoutMs ?? 15000,
        lookup: (_hostname, _opts, callback) => {
          // Double-guard: If Node's agent attempts lookup, return the pinned IP
          callback(null, pinnedIp, isIpv6 ? 6 : 4);
        },
      };

      const req = https.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          const normalizedHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              normalizedHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            }
          }

          const status = res.statusCode || 200;
          const safeRes: SafeNetworkResponse = {
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || '',
            headers: normalizedHeaders,
            buffer: async () => bodyBuffer,
            text: async () => bodyBuffer.toString('utf-8'),
            json: async <T = any>() => JSON.parse(bodyBuffer.toString('utf-8')),
          };

          resolve(safeRes);
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${options.timeoutMs ?? 15000}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }
}

