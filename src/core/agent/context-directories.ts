export interface ContextDirectory {
  id: string;
  label: string;
  directory(): string;
}

const directories = new Map<string, ContextDirectory>();

export function registerContextDirectory(directory: ContextDirectory): void {
  directories.set(directory.id, directory);
}

export function contextDirectories(): ContextDirectory[] {
  return [...directories.values()];
}
