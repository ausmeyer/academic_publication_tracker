import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Launching an unquarantined local app does not exercise Gatekeeper or its resource seal.
// Always verify the complete bundle before an installer is offered for download.
const distribution = process.argv.includes('--distribution');
const requestedApps = process.argv.slice(2).filter((arg) => arg !== '--distribution');
const apps = requestedApps.length
  ? requestedApps
  : ['mac-arm64', 'mac'].map((directory) =>
      path.join('release', directory, 'Academic Publication Tracker.app'),
    );

if (process.platform !== 'darwin') throw new Error('Mac signature verification requires macOS.');

for (const app of apps) {
  const appPath = path.resolve(app);
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  if (distribution) {
    // A valid ad-hoc signature is not sufficient for normal public distribution.
    execFileSync('codesign', ['--verify', '-R=anchor apple generic', appPath], {
      stdio: 'inherit',
    });
    execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
    execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath], {
      stdio: 'inherit',
    });
  }
  console.log(
    `${app}: resource seal verified${distribution ? '; notarization and Gatekeeper passed' : '; preview approval may still be required'}.`,
  );
}
