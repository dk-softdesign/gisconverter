import { useEffect, useRef } from "react";
import L, { type Layer, type StyleFunction } from "leaflet";
import { GeoJSON as GeoJsonLayer, MapContainer, TileLayer, useMap } from "react-leaflet";

import { getLayerColor, groupNameOf, ISSUE_COLORS } from "#/lib/layer-colors";
import type { IssueSeverity } from "#/lib/schema-validation";
import type { Basemap } from "#/lib/settings";

const OSM_ATTRIBUTION =
  "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors";
const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href='https://carto.com/attributions'>CARTO</a>`;

const BASEMAP_TILES: Record<Exclude<Basemap, "none">, { url: string; attribution: string }> = {
  osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTRIBUTION },
  "carto-light": {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: CARTO_ATTRIBUTION,
  },
  "carto-dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: CARTO_ATTRIBUTION,
  },
};

import "leaflet/dist/leaflet.css";

interface GeoJsonMapProps {
  featureCollection: GeoJSON.FeatureCollection;
  basemap: Basemap;
  // Identifies this exact set of features (a new conversion, or a different
  // set of layers toggled visible). react-leaflet's <GeoJSON> layer doesn't
  // pick up changes to its `data` prop, so we key it on this to force a
  // remount whenever the rendered features actually change.
  version: string;
  // The map zooms to fit all features only when this changes (a new
  // conversion or different visible layers) — not on every edit, so the view
  // stays put while fixing features one by one.
  fitKey: string;
  // When set, features with issues are drawn red (errors) / amber (warnings)
  // and everything else is faded so they stand out.
  issueSeverity: Map<GeoJSON.Feature, IssueSeverity> | null;
  // Zoom to this feature and open its popup; `onFocusHandled` clears it so a
  // later remount doesn't jump back to it.
  focusFeature: GeoJSON.Feature | null;
  onFocusHandled: () => void;
}

function FitBounds({
  featureCollection,
  fitKey,
}: {
  featureCollection: GeoJSON.FeatureCollection;
  fitKey: string;
}) {
  const map = useMap();
  const fittedKey = useRef<string | null>(null);

  useEffect(() => {
    if (fittedKey.current === fitKey || featureCollection.features.length === 0) return;
    fittedKey.current = fitKey;
    const bounds = L.geoJSON(featureCollection).getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [featureCollection, fitKey, map]);

  return null;
}

// Leaflet only re-measures on window resize; the map's container also changes
// size when a neighbouring panel is resized, which would otherwise leave
// unpainted tiles along the edge.
function TrackContainerSize() {
  const map = useMap();

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Declared after FitBounds in the map so its effect runs last and wins when
// the map is freshly mounted (e.g. switching to the Map tab).
function FocusFeature({
  feature,
  onHandled,
}: {
  feature: GeoJSON.Feature | null;
  onHandled: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!feature) return;
    const bounds = L.geoJSON(feature).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 19 });
    map.eachLayer((layer) => {
      if ((layer as L.Layer & { feature?: GeoJSON.Feature }).feature === feature) {
        layer.openPopup();
      }
    });
    onHandled();
  }, [feature, map, onHandled]);

  return null;
}

interface FeatureStyle {
  color: string;
  opacity: number;
  fillOpacity: number;
  weight: number;
}

function featureStyle(
  feature: GeoJSON.Feature,
  issueSeverity: Map<GeoJSON.Feature, IssueSeverity> | null,
): FeatureStyle {
  const layerColor = getLayerColor(groupNameOf(feature));
  if (!issueSeverity) return { color: layerColor, opacity: 1, fillOpacity: 1, weight: 2 };
  const severity = issueSeverity.get(feature);
  if (severity) return { color: ISSUE_COLORS[severity], opacity: 1, fillOpacity: 1, weight: 3 };
  return { color: ISSUE_COLORS.ok, opacity: 0.6, fillOpacity: 0.5, weight: 2 };
}

function makeStyleFunction(
  issueSeverity: Map<GeoJSON.Feature, IssueSeverity> | null,
): StyleFunction {
  return (feature) => {
    if (!feature) return {};
    const style = featureStyle(feature, issueSeverity);
    return {
      color: style.color,
      opacity: style.opacity,
      weight: style.weight,
      fillColor: style.color,
      fillOpacity: 0.15 * style.fillOpacity,
    };
  };
}

function makePointToLayer(issueSeverity: Map<GeoJSON.Feature, IssueSeverity> | null) {
  return (feature: GeoJSON.Feature, latlng: L.LatLng) => {
    const style = featureStyle(feature, issueSeverity);
    return L.circleMarker(latlng, {
      radius: issueSeverity?.has(feature) ? 7 : 5,
      color: style.color,
      opacity: style.opacity,
      fillColor: style.color,
      fillOpacity: 0.8 * style.fillOpacity,
      weight: style.weight,
    });
  };
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
  subtitle.textContent = feature.geometry?.type ?? "";
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

export function GeoJsonMap({
  featureCollection,
  version,
  fitKey,
  issueSeverity,
  focusFeature,
  onFocusHandled,
  basemap,
}: GeoJsonMapProps) {
  return (
    <MapContainer center={[0, 0]} zoom={2} className="h-full w-full">
      {basemap !== "none" && (
        // Keyed so switching basemaps swaps the layer rather than updating
        // the URL of the existing one (react-leaflet doesn't support that).
        <TileLayer key={basemap} {...BASEMAP_TILES[basemap]} />
      )}
      <GeoJsonLayer
        key={version}
        data={featureCollection}
        style={makeStyleFunction(issueSeverity)}
        pointToLayer={makePointToLayer(issueSeverity)}
        onEachFeature={bindInspectPopup}
      />
      <TrackContainerSize />
      <FitBounds featureCollection={featureCollection} fitKey={fitKey} />
      <FocusFeature feature={focusFeature} onHandled={onFocusHandled} />
    </MapContainer>
  );
}
