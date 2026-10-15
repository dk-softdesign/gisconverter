import { Markdown } from "#/components/markdown";
// Bundled at build time, so it always matches the deployed version.
import changelog from "../../CHANGELOG.md?raw";

// Its own module so the markdown renderer only loads when the changelog is
// opened (see ChangelogDialog).
export default function ChangelogContent() {
  return <Markdown>{changelog}</Markdown>;
}
