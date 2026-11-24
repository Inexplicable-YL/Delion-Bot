import { execFile } from 'node:child_process';
export const macosSandboxLauncher = '/usr/bin/sandbox-exec';
const shell = '/bin/bash';
const programs = [
  shell,
  '/bin/cat',
  '/bin/ls',
  '/usr/bin/awk',
  '/usr/bin/grep',
  '/usr/bin/sed',
  '/usr/bin/sort',
  '/usr/bin/wc',
];
const executablePaths = programs.map((path) => `(literal "${path}")`).join(' ');
const profile = `(version 1)
(deny default (with message "delion-command"))
(allow process-exec ${executablePaths})
(allow file-map-executable (subpath "/usr/lib") (subpath "/System/Library") ${executablePaths})
(allow file-read* file-map-executable
  (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read* (subpath (param "INPUTS")) (subpath "/usr/lib") (subpath "/System/Library")
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom")
  ${executablePaths})
(allow file-read-metadata file-test-existence (path-ancestors (param "INPUTS")))
(allow file-read-data (require-all (literal "/") (vnode-type DIRECTORY)))
(allow process-info-pidinfo (target self))
(allow signal (target self))
(allow file-write-data (literal "/dev/null"))
(allow sysctl-read (sysctl-name-prefix "hw.optional.arm") (sysctl-name "kern.osvariant_status")
  (sysctl-name "hw.pagesize") (sysctl-name "hw.cpufamily") (sysctl-name "hw.cputype")
  (sysctl-name "security.mac.lockdown_mode_state"))
(allow system-mac-syscall (require-all (mac-policy-name "Sandbox") (mac-syscall-number 67)))
(allow system-mac-syscall (mac-policy-name "vnguard"))
`;

export function runMacosCommand(directory: string, command: string, signal: AbortSignal) {
  return new Promise<{ exitCode: number | null; output: string }>((resolve) => {
    const child = execFile(
      macosSandboxLauncher,
      ['-D', `INPUTS=${directory}`, '-p', profile, shell, '--noprofile', '--norc', '-c', command],
      {
        cwd: directory,
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        signal,
        killSignal: 'SIGKILL',
        timeout: 8_000,
        maxBuffer: 128 * 1024,
      },
      (error, stdout, stderr) => {
        const output = (`${stdout}${stderr}` || error?.signal || '').replaceAll(directory, '.');
        resolve({
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          output,
        });
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}
