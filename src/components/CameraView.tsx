'use client';

import {CameraIcon, FitIcon, ShrinkIcon} from '@/components/icons';
import {chooseCamera, useCameras} from '@/hooks/useCameras';
import {
  afterClosed,
  blockedHere,
  cameraLabel,
  cameraParts,
  cameraReason,
  closed,
  openStream,
  pickProtocol,
  pictureRatio,
  playMjpeg,
  playWhep,
  streamFailure,
  streamUrl,
  type Camera,
} from '@/lib/camera';
import {tr, useLang} from '@/lib/i18n';
import {brokerHost} from '@/lib/mqttClient';
import {isApp} from '@/lib/native';
import {RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import styles from './CameraView.module.css';

// the picture of one of the mower's cameras, streamed only while it's shown and the page is in front; one without a
// picture says why and connects once the mower says it can again. on the picture its name, the other cameras, the whole
// screen and (onHide) taking it off the page: a tap on the picture puts them away and brings them back.
// plain: the picture alone. fill: as big as the place it's put in, else as wide as it and as high as the cameras need
export default function CameraView({plain, fill, onHide}: {plain?: boolean; fill?: boolean; onHide?: () => void}) {
  useLang();
  const {on, list, failed, camera, changes} = useCameras();
  const shown = usePageShown();
  const [live, setLive] = useState(false);
  const [bare, setBare] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useWholeScreen(box);
  if (!on) return null;
  const playing = !!camera?.available && shown;
  const whole = fill || full;
  const wholeText = tr(full ? 'Leave full screen' : 'Full screen');
  return (
    <div
      ref={box}
      className={[styles.camera, plain ? styles.plain : '', whole ? styles.fill : '', full ? styles.full : '', bare ? styles.bare : ''].join(' ')}
      data-camera
      data-no-swipe={full || undefined}
    >
      <div className={styles.picture} style={whole ? undefined : {aspectRatio: pictureRatio(list ?? [])}}>
        {!list ? (
          failed ? (
            <Note title={tr('No picture')} text={failed} />
          ) : (
            <Note busy text={tr('Loading the cameras…')} />
          )
        ) : !camera ? (
          <Note text={tr('The mower reports no camera.')} />
        ) : !camera.available ? (
          <Note title={tr('No picture')} text={cameraReason(camera.reason)} detail={camera.detail} />
        ) : (
          shown && <Player key={`${camera.id} ${changes[camera.id] ?? 0}`} camera={camera} onLive={setLive} />
        )}
        {!plain && (
          <>
            <button className={styles.tap} aria-label={tr(bare ? 'Show the buttons' : 'Hide the buttons')} onClick={() => setBare(!bare)} />
            <div className={styles.over}>
              {camera && list && (
                <span className={[styles.badge, playing && live ? styles.live : ''].join(' ')}>
                  <i />
                  {cameraLabel(camera, list)}
                </span>
              )}
              <span className={styles.corner}>
                {onHide && !full && (
                  <button aria-label={tr('Hide the camera picture')} title={tr('Hide the camera picture')} onClick={onHide}>
                    <CameraIcon size={18} off />
                  </button>
                )}
                <button aria-label={wholeText} title={wholeText} onClick={() => setFull(!full)}>
                  {full ? <ShrinkIcon size={18} /> : <FitIcon size={18} />}
                </button>
              </span>
              {list && list.length > 1 && (
                <div className={styles.switcher} role="group" aria-label={tr('Camera')}>
                  {cameraParts(list).map((p) => (
                    <button
                      key={p.key}
                      className={p.key === camera?.id ? styles.on : undefined}
                      aria-pressed={p.key === camera?.id}
                      aria-label={p.name}
                      onClick={() => chooseCamera(p.key)}
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// in the picture's middle: what it waits for, or why there's none
function Note({busy, title, text, detail, children}: {busy?: boolean; title?: string; text: string; detail?: string; children?: React.ReactNode}) {
  return (
    <div className={styles.note}>
      {busy && <i className={styles.busy} />}
      {title && <strong>{title}</strong>}
      <span>{text}</span>
      {detail && <small>{detail}</small>}
      {children}
    </div>
  );
}

type Shown = {phase: 'connecting' | 'playing' | 'ended'} | {phase: 'failed'; text: string; detail?: string};

// one connection to a camera, closed when it goes (another camera, the page left or put away). each try asks the
// mower for a stream anew, its address is good for one connection
function Player({camera, onLive}: {camera: Camera; onLive: (live: boolean) => void}) {
  const [shown, setShown] = useState<Shown>({phase: 'connecting'});
  useEffect(() => onLive(shown.phase === 'playing'), [shown.phase, onLive]);
  const [tries, setTries] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const protocol = pickProtocol(camera.protocols);
  // the mower answers with the one asked for
  const mjpeg = protocol === 'mjpeg';

  useEffect(() => {
    if (!protocol) return;
    let alive = true;
    let close: (() => Promise<void>) | null = null;
    const shut = () => {
      if (close) closed(close);
      close = null;
    };
    // (some browsers tell it with every frame)
    const playing = () => alive && setShown((s) => (s.phase === 'playing' ? s : {phase: 'playing'}));
    // (its place on the mower is given back right away, a picture still on its way doesn't count any more)
    const ended = () => {
      if (!alive) return;
      alive = false;
      shut();
      setShown({phase: 'ended'});
    };
    const failed = (text: string, detail?: string) => void (alive && setShown({phase: 'failed', text, detail}));
    (async () => {
      // (the last one closed first, else switching could hold both places for a moment)
      await afterClosed();
      if (!alive) return;
      const s = await openStream(camera.id, protocol);
      if (!alive) return;
      const url = streamUrl(s.url, brokerHost());
      if (blockedHere(url))
        return failed(tr("This page is open over https, the browser doesn't load the camera's picture over plain http. Open MowBite over http or use the app."));
      if (s.protocol === 'webrtc') {
        const v = video.current!;
        v.onplaying = playing;
        close = await playWhep(url, v, ended);
      } else if (s.protocol === 'mjpeg') {
        const img = new Image();
        img.alt = '';
        const stop = await playMjpeg(url, img, playing, ended);
        // (one given up while it connected never gets onto the page)
        if (alive) box.current?.appendChild(img);
        close = async () => {
          await stop();
          img.remove();
        };
      } else return failed(unknownProtocol(s.protocol));
      if (!alive) shut();
    })().catch((e) => {
      if (e instanceof RpcError && e.data?.event === 'CAMERA_REFUSED')
        failed(cameraReason(e.data.reason as string | undefined, e.data.message as string | undefined));
      else if (e instanceof RpcError) failed(rpcErrorText(e));
      else {
        const {text, detail} = streamFailure(e);
        failed(text, detail);
      }
    });
    return () => {
      alive = false;
      shut();
    };
  }, [camera.id, protocol, tries]);

  if (!protocol) return <Note text={unknownProtocol(camera.protocols.join(', '))} />;
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
      {shown.phase === 'connecting' && <Note busy text={tr('Connecting to the camera…')} />}
      {shown.phase === 'ended' && (
        <Note title={tr('The picture broke off')} text={tr('The connection to the camera was lost.')}>
          {again}
        </Note>
      )}
      {shown.phase === 'failed' && (
        <Note title={tr('No picture')} text={shown.text} detail={shown.detail}>
          {again}
        </Note>
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

// over the whole screen and back: the browser's own full screen where it has one, else laid over the page (the app,
// iPhones). Escape and the browser's own way out end it too
function useWholeScreen(box: React.RefObject<HTMLDivElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const left = () => void (document.fullscreenElement || setFull(false));
    const key = (e: KeyboardEvent) => void (e.key === 'Escape' && setFull(false));
    document.addEventListener('fullscreenchange', left);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('fullscreenchange', left);
      window.removeEventListener('keydown', key);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [full]);
  const set = (on: boolean) => {
    setFull(on);
    // (asked for in the tap itself, browsers take it only from there)
    if (on && !isApp()) void box.current?.requestFullscreen?.().catch(() => {});
  };
  return [full, set] as const;
}
