// writes public/version.json before the build, so a running container can tell which version it is
// (the android app asks the mower for it). dev builds add e.g. "dev.42" via VERSION_SUFFIX. level: how much of
// src/lib/containerFeatures.json it has, the app tells what an older one leaves out
import {readFileSync, writeFileSync} from 'node:fs';

const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
const level = Math.max(0, ...JSON.parse(readFileSync('src/lib/containerFeatures.json', 'utf8')).map((f) => f.level));
const suffix = process.env.VERSION_SUFFIX;
writeFileSync('public/version.json', JSON.stringify({version: suffix ? `${version}-${suffix}` : version, level}) + '\n');
