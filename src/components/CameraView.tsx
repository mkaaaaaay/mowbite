'use client';

import {chooseCamera, useCameras} from '@/hooks/useCameras';
import {afterClosed, blockedHere, cameraLabel, cameraReason, closed, openStream, pickProtocol, playWhep, streamUrl, type Camera} from '@/lib/camera';
import {tr, useLang} from '@/lib/i18n';
import {brokerHost} from '@/lib/mqttClient';
import {RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import styles from './CameraView.module.css';

// the picture of one of the mower's cameras with its name over it and the others to switch to at its bottom. it
// streams only while it's shown and the page is in front; one that can't show a picture now says why and connects once
// the mower says it can again. fill: as big as the place it's put in, without name and switch (driving by hand has them
// in its own bars), else as wide as its card in the camera's proportions
export default function CameraView({fill}: {fill?: boolean}) {
  useLang();
  const {on, list, failed, camera, changes} = useCameras();
  const shown = usePageShown();
  const [live, setLive] = useState(false);
  if (!on) return null;
  const playing = !!camera?.available && shown;
  return (
    <div className={[styles.camera, fill ? styles.fill : ''].join(' ')} data-camera>
      <div className={styles.picture} style={fill || !camera?.width || !camera.height ? undefined : {aspectRatio: `${camera.width} / ${camera.height}`}}>
        {!list ? (
          <p className={styles.note}>{failed ?? tr('Loading the cameras…')}</p>
        ) : !camera ? (
          <p className={styles.note}>{tr('The mower reports no camera.')}</p>
        ) : !camera.available ? (
          <p className={styles.note}>
            <strong>{tr('No picture')}</strong>
            <span>{cameraReason(camera.reason)}</span>
            {camera.detail && <small>{camera.detail}</small>}
          </p>
        ) : (
          shown && <Player key={`${camera.id} ${changes[camera.id] ?? 0}`} camera={camera} onLive={setLive} />
        )}
        {!fill && camera && list && (
          <span className={[styles.badge, playing && live ? styles.live : ''].join(' ')}>
            <i />
            {cameraLabel(camera, list)}
          </span>
        )}
        {!fill && list && list.length > 1 && (
          <div className={styles.switcher} role="group" aria-label={tr('Camera')}>
            {list.map((c) => (
              <button
                key={c.id}
                className={c.id === camera?.id ? styles.on : undefined}
                aria-pressed={c.id === camera?.id}
                aria-label={cameraLabel(c, list)}
                onClick={() => chooseCamera(c.id)}
              >
                {cameraLabel(c, list, true)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type Shown = {phase: 'connecting' | 'playing' | 'ended'} | {phase: 'failed'; text: string};

// one connection to a camera, closed when it goes (another camera, the page left or put away)
function Player({camera, onLive}: {camera: Camera; onLive: (live: boolean) => void}) {
  const [shown, setShown] = useState<Shown>({phase: 'connecting'});
  useEffect(() => onLive(shown.phase === 'playing'), [shown.phase, onLive]);
  const [tries, setTries] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const protocol = pickProtocol(camera.protocols);
  const [mjpeg, setMjpeg] = useState(false);

  useEffect(() => {
    if (!protocol) return;
    let alive = true;
    let close: (() => Promise<void>) | null = null;
    const ended = () => alive && setShown({phase: 'ended'});
    (async () => {
      // (the last one closed first, else switching could hold both places for a moment)
      await afterClosed();
      if (!alive) return;
      const s = await openStream(camera.id, protocol);
      if (!alive) return;
      const url = streamUrl(s.url, brokerHost());
      if (blockedHere(url)) throw new Error(tr("This page is open over https, the browser doesn't load the camera's picture over plain http. Open MowBite over http or use the app."));
      if (s.protocol === 'webrtc') {
        setMjpeg(false);
        const v = video.current!;
        v.onplaying = () => alive && setShown({phase: 'playing'});
        close = await playWhep(url, v, ended);
      } else if (s.protocol === 'mjpeg') {
        setMjpeg(true);
        const img = new Image();
        img.alt = '';
        img.onload = () => alive && setShown({phase: 'playing'});
        img.onerror = ended;
        img.src = url;
        box.current?.appendChild(img);
        // (an image keeps loading until its source goes)
        close = async () => {
          img.onerror = null;
          img.src = '';
          img.remove();
        };
      } else throw new Error(unknownProtocol(s.protocol));
      if (!alive) closed(close);
    })().catch((e) => {
      if (!alive) return;
      const refused = e instanceof RpcError && e.data?.event === 'CAMERA_REFUSED';
      setShown({
        phase: 'failed',
        text: refused ? cameraReason(e.data!.reason as string | undefined, e.data!.message as string | undefined) : e instanceof RpcError ? rpcErrorText(e) : String(e?.message ?? e),
      });
    });
    return () => {
      alive = false;
      if (close) closed(close);
    };
  }, [camera.id, protocol, tries]);

  if (!protocol) return <p className={styles.note}>{unknownProtocol(camera.protocols.join(', '))}</p>;
  const again = (
    <button
      onClick={() => {
        setShown({phase: 'connecting'});
        setTries(tries + 1);
      }}
    >
      {tr('Try again')}
    </button>
  );
  return (
    <>
      <video ref={video} className={mjpeg ? styles.gone : undefined} autoPlay muted playsInline />
      <div ref={box} className={styles.mjpeg} />
      {shown.phase === 'connecting' && <p className={styles.note}>{tr('Connecting to the camera…')}</p>}
      {shown.phase === 'ended' && (
        <p className={styles.note}>
          <strong>{tr('The picture broke off')}</strong>
          {again}
        </p>
      )}
      {shown.phase === 'failed' && (
        <p className={styles.note}>
          <strong>{tr('No picture')}</strong>
          <span>{shown.text}</span>
          {again}
        </p>
      )}
    </>
  );
}

const unknownProtocol = (protocols: string) => tr("This camera sends {protocols}, MowBite can't show that yet.", {protocols});

// the page in front: a phone put away or another tab stops the picture
const onVisibility = (l: () => void) => {
  document.addEventListener('visibilitychange', l);
  return () => document.removeEventListener('visibilitychange', l);
};
const usePageShown = () =>
  useSyncExternalStore(
    onVisibility,
    () => !document.hidden,
    () => false,
  );
