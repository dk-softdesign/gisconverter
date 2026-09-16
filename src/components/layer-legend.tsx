import { getLayerColor } from "#/lib/layer-colors";
import { cn } from "#/lib/utils";

interface LayerLegendProps {
  layers: string[];
  hiddenLayers: Set<string>;
  onToggle: (layer: string) => void;
}

export function LayerLegend({ layers, hiddenLayers, onToggle }: LayerLegendProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {layers.map((layer) => {
        const hidden = hiddenLayers.has(layer);
        return (
          <button
            key={layer}
            type="button"
            onClick={() => onToggle(layer)}
            aria-pressed={!hidden}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:bg-accent",
              hidden ? "opacity-40" : "opacity-100",
            )}
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: getLayerColor(layer) }}
            />
            {layer}
          </button>
        );
      })}
    </div>
  );
}
