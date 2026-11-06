// Native import waits for the bootstrap's top-level await, including SDK registration.
export async function importDevelopmentEntry(entry: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      import(/* @vite-ignore */ entry),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Plugin asset loading timed out")), 15_000); }),
    ]);
  } finally { clearTimeout(timer); }
}
