// writes public/version.json before the build, so a running container can tell which version it is
// (the android app asks the mower for it). dev builds add e.g. "dev.42" via VERSION_SUFFIX. level: how much of
// src/lib/containerFeatures.json it has, the app tells what an older one leaves out
// public/app.json is what MowBite OS reads from the export (masterplan 3.5 (4)): the api it works with (osApi in
// package.json: an OS with the same break and at least min; one that doesn't give a break goes by max) and the commit
// with its time as serial, both only where git is (not in the docker build)
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const level = Math.max(0, ...JSON.parse(readFileSync('src/lib/containerFeatures.json', 'utf8')).map((f) => f.level));
const suffix = process.env.VERSION_SUFFIX;
const version = suffix ? `${pkg.version}-${suffix}` : pkg.version;
writeFileSync('public/version.json', JSON.stringify({version, level}) + '\n');

let head = {};
try {
  const [commit, time] = execFileSync('git', ['log', '-1', '--format=%H %ct'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
    .trim()
    .split(' ');
  head = {commit, serial: Number(time)};
} catch {
  // no git or no .git: without commit and serial
}
writeFileSync('public/app.json', JSON.stringify({schema: 1, owner: 'mowbite-app', version, api: pkg.osApi, ...head}) + '\n');
