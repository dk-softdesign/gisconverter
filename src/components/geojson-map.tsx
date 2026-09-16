import { useEffect } from "react";
import L from "leaflet";
import { GeoJSON as GeoJsonLayer, MapContainer, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";

interface GeoJsonMapProps {
  featureCollection: GeoJSON.FeatureCollection;
  version: number;
}

// DXF coordinates are arbitrary drawing units, not WGS84 lon/lat, so we use
// Leaflet's flat CRS.Simple plane instead of a geographic basemap.
function FitBounds({ featureCollection }: { featureCollection: GeoJSON.FeatureCollection }) {
  const map = useMap();

  useEffect(() => {
    if (featureCollection.features.length === 0) return;
    const bounds = L.geoJSON(featureCollection).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [featureCollection, map]);

  return null;
}

export function GeoJsonMap({ featureCollection, version }: GeoJsonMapProps) {
  return (
    <MapContainer
      key={version}
      crs={L.CRS.Simple}
      center={[0, 0]}
      zoom={0}
      className="h-full w-full"
    >
      <GeoJsonLayer data={featureCollection} />
      <FitBounds featureCollection={featureCollection} />
    </MapContainer>
  );
}
