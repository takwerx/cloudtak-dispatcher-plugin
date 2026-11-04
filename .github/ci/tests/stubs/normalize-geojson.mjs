export async function normalize_geojson(feat) { return { ...feat, properties: { ...feat.properties } } }
