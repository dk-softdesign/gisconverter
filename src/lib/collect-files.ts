function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      // readEntries only returns up to 100 entries per call, so it must be
      // called repeatedly until it comes back empty.
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
          return;
        }
        all.push(...entries);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function collectFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return [await readFileEntry(entry as FileSystemFileEntry)];
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    const nested = await Promise.all(children.map((child) => collectFromEntry(child)));
    return nested.flat();
  }
  return [];
}

// Recursively collects every File out of a drop event's DataTransfer,
// including files nested inside dropped folders. Falls back to the flat
// `.files` list when the browser doesn't support the entries API.
export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;
  if (!items) return [...dataTransfer.files];

  const entries = [...items]
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (entries.length === 0) return [...dataTransfer.files];

  const collected = await Promise.all(entries.map((entry) => collectFromEntry(entry)));
  return collected.flat();
}
