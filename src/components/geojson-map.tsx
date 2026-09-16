import { useEffect } from "react";
import L from "leaflet";
import { GeoJSON as GeoJsonLayer, MapContainer, TileLayer, useMap } from "react-leaflet";

import "leaflet/dist/leaflet.css";

interface GeoJsonMapProps {
  featureCollection: GeoJSON.FeatureCollection;
  version: number;
}

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
    <MapContainer key={version} center={[0, 0]} zoom={2} className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
      />
      <GeoJsonLayer data={featureCollection} />
      <FitBounds featureCollection={featureCollection} />
    </MapContainer>
  );
}
