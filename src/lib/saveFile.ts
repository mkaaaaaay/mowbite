import {toBase64} from './base64';
import {isApp} from './native';

// a file for the user: a normal download in the browser, in the android app (where a webview ignores downloads)
// it goes to the app's cache and the share sheet comes up, from there it can be saved to downloads, drive, mail etc.
export async function saveFile(name: string, content: string | Uint8Array<ArrayBuffer>, type = 'application/json') {
  if (isApp()) {
    const [{Filesystem, Directory, Encoding}, {Share}] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    // without an encoding the plugin takes base64
    const {uri} = await Filesystem.writeFile(
      typeof content === 'string'
        ? {path: name, data: content, directory: Directory.Cache, encoding: Encoding.UTF8}
        : {path: name, data: toBase64(content), directory: Directory.Cache},
    );
    await Share.share({title: name, files: [uri], dialogTitle: name});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name;
  // some browsers only follow a link that's in the page
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
