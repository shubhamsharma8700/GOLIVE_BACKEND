// utils/cloudfrontHeaders.js
export const extractViewerContext = (req) => ({
  ip:
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress,

  geo: {
    country: req.headers["cloudfront-viewer-country"] || null,
    region: req.headers["cloudfront-viewer-country-region"] || null,
    city: req.headers["cloudfront-viewer-city"] || null,
    latitude: req.headers["cloudfront-viewer-latitude"] || null,
    longitude: req.headers["cloudfront-viewer-longitude"] || null,
    asn: req.headers["cloudfront-viewer-asn"] || null,
  },

  network: {
    protocol: req.headers["cloudfront-forwarded-proto"] || null,
    tls: req.headers["cloudfront-is-tls-viewer"] === "true",
    edgePop: req.headers["x-amz-cf-pop"] || null,
    requestId: req.headers["x-amz-cf-id"] || null,
  },
});
