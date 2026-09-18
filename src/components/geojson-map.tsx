import { useEffect } from "react";
import L, { type Layer, type StyleFunction } from "leaflet";
import { GeoJSON as GeoJsonLayer, MapContainer, TileLayer, useMap } from "react-leaflet";

import { getLayerColor, groupNameOf, UNNAMED_LAYER } from "#/lib/layer-colors";

import "leaflet/dist/leaflet.css";

interface GeoJsonMapProps {
  featureCollection: GeoJSON.FeatureCollection;
  // Identifies this exact set of features (a new conversion, or a different
  // set of layers toggled visible). react-leaflet's <GeoJSON> layer doesn't
  // pick up changes to its `data` prop, so we key it on this to force a
  // remount whenever the rendered features actually change.
  version: string;
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

const styleByLayer: StyleFunction = (feature) => {
  const color = getLayerColor(feature ? groupNameOf(feature) : UNNAMED_LAYER);
  return { color, weight: 2, fillColor: color, fillOpacity: 0.15 };
};

function pointToColoredMarker(feature: GeoJSON.Feature, latlng: L.LatLng) {
  const color = getLayerColor(groupNameOf(feature));
  return L.circleMarker(latlng, {
    radius: 5,
    color,
    fillColor: color,
    fillOpacity: 0.8,
    weight: 2,
  });
}

// Built as DOM nodes (not an HTML string) so a layer name or attribute value
// from an untrusted DXF file can never be interpreted as markup by Leaflet's
// popup.
function bindInspectPopup(feature: GeoJSON.Feature, layer: Layer) {
  const container = document.createElement("div");
  container.className = "grid gap-1 text-sm";

  const title = document.createElement("div");
  title.className = "font-medium";
  title.textContent = groupNameOf(feature);
  container.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.className = "text-muted-foreground";
  subtitle.textContent = feature.geometry.type;
  container.appendChild(subtitle);

  // Other properties (e.g. DXF block attributes like DIAMETER, MATERIAL)
  const otherEntries = Object.entries(feature.properties ?? {}).filter(
    ([key, value]) => key !== "layer" && key !== "source" && value != null && value !== "",
  );
  if (otherEntries.length > 0) {
    const table = document.createElement("div");
    table.className = "mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t pt-1";
    for (const [key, value] of otherEntries) {
      const keyEl = document.createElement("span");
      keyEl.className = "text-muted-foreground";
      keyEl.textContent = key;
      const valueEl = document.createElement("span");
      valueEl.textContent = String(value);
      table.append(keyEl, valueEl);
    }
    container.appendChild(table);
  }

  layer.bindPopup(container);
}

export function GeoJsonMap({ featureCollection, version }: GeoJsonMapProps) {
  return (
    <MapContainer center={[0, 0]} zoom={2} className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
      />
      <GeoJsonLayer
        key={version}
        data={featureCollection}
        style={styleByLayer}
        pointToLayer={pointToColoredMarker}
        onEachFeature={bindInspectPopup}
      />
      <FitBounds featureCollection={featureCollection} />
    </MapContainer>
  );
}
