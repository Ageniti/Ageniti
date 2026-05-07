export function normalizeAttribution(attribution) {
  if (!attribution || typeof attribution !== "object" || !attribution.text) {
    return undefined;
  }

  return {
    text: attribution.text,
    url: attribution.url,
    vendor: attribution.vendor,
    product: attribution.product,
    docsUrl: attribution.docsUrl,
    licenseNotice: attribution.licenseNotice,
  };
}
