import {fromBase64} from './base64';
import {isApp} from './native';

// a file for the user: a normal download in the browser, in the android app (where a webview ignores downloads)
// it goes to the app's cache and the share sheet comes up, from there it can be saved to downloads, drive, mail etc.
export async function saveFile(name: string, text: string, type = 'application/json') {
  if (isApp()) {
    const {Filesystem, Directory, Encoding} = await import('@capacitor/filesystem');
    const {uri} = await Filesystem.writeFile({path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8});
    return share(name, uri);
  }
  download(name, new Blob([text], {type}));
}

// a large file in base64 pieces as they come: in the app each piece is added to the file in the cache, so the whole
// file is never held at once; in the browser they make one blob
export async function savePieces(name: string, type: string, fill: (put: (base64: string) => Promise<void>) => Promise<void>) {
  if (isApp()) {
    const {Filesystem, Directory} = await import('@capacitor/filesystem');
    let first = true;
    // without an encoding the plugin takes base64
    await fill(async (data) => {
      const file = {path: name, data, directory: Directory.Cache};
      await (first ? Filesystem.writeFile(file) : Filesystem.appendFile(file));
      first = false;
    });
    const {uri} = await Filesystem.getUri({path: name, directory: Directory.Cache});
    return share(name, uri);
  }
  const parts: Uint8Array<ArrayBuffer>[] = [];
  await fill(async (data) => void parts.push(fromBase64(data)));
  download(name, new Blob(parts, {type}));
}

async function share(name: string, uri: string) {
  const {Share} = await import('@capacitor/share');
  await Share.share({title: name, files: [uri], dialogTitle: name});
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  // some browsers only follow a link that's in the page
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
