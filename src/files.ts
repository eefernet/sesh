export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function pickTextFile(accept: string): Promise<{ name: string; text: string } | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(undefined); return; }
      resolve({ name: file.name, text: await file.text() });
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
