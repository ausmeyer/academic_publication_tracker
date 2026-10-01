/** Chromium fetches spell-check dictionaries from a Google server on Windows and Linux. */
export function configureSpellchecker(
  target: { setSpellCheckerEnabled(enabled: boolean): void },
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') target.setSpellCheckerEnabled(false);
}
