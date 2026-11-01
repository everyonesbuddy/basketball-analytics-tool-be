/**
 * Read a product page's picture, title and price from its link (the Open
 * Graph tags most stores publish for sharing). No API needed; some stores
 * block automated requests, in which case you get what we could read.
 *
 * Guarded: http(s) only, public addresses only (no localhost or private
 * networks), 3 redirects, 8 seconds, first 1.5 MB.
 */
const dns = require("dns").promises;
const net = require("net");

const PRIVATE = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i,
];
const isPrivate = (ip) => PRIVATE.some((re) => re.test(ip));

async function assertPublic(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw Object.assign(new Error("That isn't a valid link."), { statusCode: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("Only http and https links."), { statusCode: 400 });
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw Object.assign(new Error("That address isn't allowed."), { statusCode: 400 });
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivate)) throw Object.assign(new Error("That address isn't allowed."), { statusCode: 400 });
  return url;
}

const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

/** Pull title, image, price and site name from a page's HTML (pure; tested). */
function parsePreview(html, pageUrl) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && content !== undefined && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = decode(content);
  }
  const title = meta["og:title"] || meta["twitter:title"] || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  let image = meta["og:image"] || meta["og:image:url"] || meta["og:image:secure_url"] || meta["twitter:image"] || meta["twitter:image:src"] || "";
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
    } catch {
      image = "";
    }
  }
  let priceText = meta["product:price:amount"] || meta["og:price:amount"] || meta.price || "";
  if (!priceText) {
    const ld = html.match(/"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/);
    if (ld) priceText = ld[1];
  }
  const price = priceText && !Number.isNaN(Number(String(priceText).replace(/[^\d.]/g, ""))) ? Number(String(priceText).replace(/[^\d.]/g, "")) : null;
  let site = meta["og:site_name"] || "";
  if (!site) {
    try {
      site = new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      site = "";
    }
  }
  return { title: title.slice(0, 300), image: /^https?:\/\//.test(image) ? image.slice(0, 2000) : "", price: price && price > 0 && price < 100000 ? price : null, site: site.slice(0, 120) };
}

async function fetchPreview(urlString) {
  let url = await assertPublic(urlString);
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PersonalOS/1.0; link preview)", Accept: "text/html,application/xhtml+xml" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop === 3) break;
      url = await assertPublic(new URL(res.headers.get("location"), url).toString());
      continue;
    }
    if (!res.ok) return { url: url.toString(), ...parsePreview("", url.toString()), blocked: true };
    // Read at most 1.5 MB.
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < 1.5e6) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    return { url: url.toString(), ...parsePreview(html, url.toString()) };
  }
  return { url: url.toString(), ...parsePreview("", url.toString()), blocked: true };
}

module.exports = { fetchPreview, parsePreview, assertPublic, isPrivate };
