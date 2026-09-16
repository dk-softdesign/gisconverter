import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">GIS Converter</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Dashboard shell — convert GIS file formats to GeoJSON. Add routes under{" "}
        <code>src/routes</code> to build out the dashboard.
      </p>
    </div>
  );
}
