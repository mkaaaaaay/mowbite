'use client';

import {isLive, useMowerStateValue} from '@/hooks/useMowerState';
import {useSetup} from '@/hooks/useSetup';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {clock} from '@/lib/dates';
import {
  confirmStart,
  hostError,
  keepUsbLeft,
  offText,
  osOff,
  restartOs,
  restartWay,
  setupWifiText,
  trialFailText,
  trialWay,
  usbLeftState,
  usbLeftUntil,
  usbMode,
  usbModeError,
  usbModeOffered,
  useHost,
  useHostOffers,
  useHardwareOff,
  useHostTrial,
  useSetupWifiUntil,
  useUsbLeft,
} from '@/lib/hostOs';
import {tr} from '@/lib/i18n';
import {useOsPlatform} from '@/lib/mowerOs';
import {keptSetupWifi} from '@/lib/mowers';
import {RPC} from '@/lib/openmower';
import {stepHref} from '@/lib/setup';
import {useUpdateStatus} from '@/lib/osUpdate';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import shared from './AutoUpdate.module.css';
import styles from './HostOs.module.css';
import {Ask} from './updateParts';

// MowBite OS off with its reason and the restart (restartWay); banner: on the dashboard, only while it's off
export function OsRestart({banner}: {banner?: boolean}) {
  const host = useHost();
  const methods = useRpcMethods();
  const live = useMowerStateValue(isLive);
  const state = useMowerStateValue((l) => l.state?.current_state);
  const emergency = useMowerStateValue((l) => !!l.state?.emergency);
  const update = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const {sure, confirm} = useSure();

  const trialFailed = useHostTrial() && trialWay(host, update?.status.last) === 'failed';

  const off = osOff(host);
  const way = restartWay(host, methods, {live, state, emergency}, !!update && update.status.phase !== 'idle');
  // a failed first start says it in its own box (TrialConfirm)
  if (trialFailed || (banner ? !off : !off && !way && !started && !error)) return null;

  const restart = () => {
    setBusy(true);
    setError(null);
    setStarted(false);
    restartOs()
      .then(() => setStarted(true), (e) => setError(hostError(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className={[styles.box, off ? shared.error : '', banner ? styles.banner : ''].join(' ')} data-os={host?.os?.state}>
      {off && <span role="alert">{offText(off)}</span>}
      {way && (
        <button
          className={[shared.control, off ? shared.primary : sure ? shared.danger : ''].join(' ')}
          disabled={busy}
          onClick={() => (way === 'off' ? restart() : confirm('restart', restart))}
        >
          {busy ? tr('Starting…') : sure ? tr('Sure? Restart MowBite OS') : tr('Restart MowBite OS')}
        </button>
      )}
      {way === 'idle' && !started && !error && (
        <span className={shared.dim}>{tr('Only while the mower is idle without an emergency stop. It is back after a moment.')}</span>
      )}
      {started && !off && <span className={shared.dim}>{tr('MowBite OS is starting again.')}</span>}
      {error && <span className={shared.warn}>{error}</span>}
    </div>
  );
}

// a newly written system on trial: confirming its start ends the trial, else the mower goes back to the installer's USB
// mode by itself. on the dashboard and with the updates, only while the host says trial. The confirmation only while
// MowBite OS runs; a failed install with its reason and the way back to the installer
export function TrialConfirm({banner}: {banner?: boolean}) {
  const trial = useHostTrial();
  const host = useHost();
  const last = useUpdateStatus()?.status.last;
  const platform = useOsPlatform();
  const usbBelow = !banner && usbModeOffered(host, platform);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!trial) return null;
  const way = trialWay(host, last);
  if (way === 'failed')
    return (
      <div className={[styles.box, shared.error, banner ? styles.banner : ''].join(' ')} data-trial="failed">
        <span role="alert">
          {tr('MowBite OS did not start on this mower.')} {trialFailText(last!)}
        </span>
        <span>
          {usbBelow
            ? tr('Back to the installer: restart into USB mode with the button below, or take the battery off and put it back on.')
            : tr(
                'Back to the installer: Settings › Updates › Restart into USB mode, or take the battery off and put it back on. Then on the PC go back to the vendor system or write MowBite OS again.',
              )}
        </span>
      </div>
    );
  const confirm = () => {
    setBusy(true);
    setError(null);
    confirmStart()
      .catch((e) => setError(hostError(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className={[styles.box, shared.warn, banner ? styles.banner : ''].join(' ')} data-trial={way === 'confirm' ? 'on' : 'wait'}>
      <span>
        {tr(
          "MowBite OS is new on this mower. Confirm that it starts fine, else the mower goes back to the installer's USB mode by itself after a few minutes.",
        )}
      </span>
      {way === 'confirm' ? (
        <button className={[shared.control, shared.primary].join(' ')} disabled={busy} onClick={confirm}>
          {busy ? tr('Checking…') : tr('Confirm the start')}
        </button>
      ) : (
        <span className={shared.dim}>{tr('The start can be confirmed once MowBite OS runs.')}</span>
      )}
      {error && (
        <span className={shared.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// the setup WLAN opened at the mower: until when, and where its WLAN is chosen
export function SetupWifiOpen({banner}: {banner?: boolean}) {
  const until = useSetupWifiUntil();
  const canSet = useHostOffers(RPC.hostWifiSet);
  if (until === null) return null;
  return (
    <div className={[styles.box, banner ? styles.banner : ''].join(' ')} data-setup-wifi="">
      <span>{setupWifiText(until)}</span>
      {canSet && (
        <Link href="/settings#wifi" className={shared.control}>
          {tr('Choose its WLAN')}
        </Link>
      )}
    </div>
  );
}

// the drivers still off after the installation, with the way to the setup's step that switches them on
export function HardwareOff({banner}: {banner?: boolean}) {
  if (!useHardwareOff()) return null;
  return (
    <div className={[styles.box, shared.warn, banner ? styles.banner : ''].join(' ')} data-hardware-off="">
      <span>{tr("The hardware is still off: after the installation MowBite OS doesn't talk to the board yet.")}</span>
      <HardwareStep />
    </div>
  );
}
// the setup's state read only while the hardware is off
function HardwareStep() {
  const step = useSetup()?.steps.find((s) => s.check === 'hardware');
  if (!step) return null;
  return (
    <Link href={stepHref(step.id)} className={[shared.control, shared.primary].join(' ')}>
      {tr('Switch it on in the setup')}
    </Link>
  );
}

// the names of the buttons a gesture uses (setup_wifi_gesture.button)
const BUTTONS: Record<string, string> = {on_ok: 'On/OK'};
// where the mower can't be reached: how its setup WLAN is opened at its buttons, where it said last time it has one
export function SetupWifiLost() {
  const [gesture] = useState(keptSetupWifi);
  if (!gesture) return null;
  const button = gesture.button ? tr(BUTTONS[gesture.button] ?? gesture.button) : tr('its main button');
  return (
    <div className={[styles.box, shared.warn, styles.banner].join(' ')} data-setup-wifi-lost="">
      <b>{tr('New WLAN or new router?')}</b>
      <span>
        {tr('Press {button} at the mower {presses} times within {seconds} s while it rests: it opens its setup WLAN for {minutes} minutes. Join it with the phone, its name and key are on the QR sheet, then choose the new WLAN under Settings › Mower › WLAN.', {
          button,
          presses: gesture.presses,
          seconds: gesture.within_s,
          minutes: Math.round(gesture.open_s / 60),
        })}
      </span>
    </div>
  );
}

// A Tron sent into the USB mode of its loader, for the installer on a PC: offered where the host lists it on that
// platform, after what it means and a tick. What became of a restart the host accepted stays said for the mower, it
// can't tell itself any more; banner: on the dashboard, only once it's gone
export function UsbMode({banner}: {banner?: boolean}) {
  const host = useHost();
  const connected = useMowerStateValue((l) => l.connected);
  const offered = usbModeOffered(host, useOsPlatform());
  const left = useUsbLeft();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, again] = useState(0);
  // eslint-disable-next-line react-hooks/purity -- the timer below draws it again once the restart's time is over
  const state = usbLeftState(left, host, connected, Date.now());
  // seen gone or back from it: kept so, the page may be opened anew meanwhile
  useEffect(() => {
    if (!left) return;
    if (state === 'gone' && !left.gone) keepUsbLeft({...left, gone: true});
    if (state === 'back') keepUsbLeft(null);
    if (state !== 'leaving') return;
    const timer = setTimeout(() => again((n) => n + 1), Math.max(0, usbLeftUntil(left) - Date.now()) + 100);
    return () => clearTimeout(timer);
  }, [state, left]);

  const gone = state === 'gone';
  const asks = !banner && offered && (state === 'none' || state === 'stayed');
  if (banner ? !gone : !asks && state === 'none') return null;
  const go = () => {
    setBusy(true);
    setError(null);
    usbMode()
      .then(
        () => {
          setOpen(false);
          keepUsbLeft({at: Date.now() / 1000, gone: false});
        },
        (e) => setError(usbModeError(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className={[styles.box, gone ? shared.warn : '', banner ? styles.banner : ''].join(' ')} data-usb-mode={state}>
      {gone && (
        <>
          <span role="alert">
            {tr('The mower restarted into USB mode at {time}. It can only be reached over USB from a PC now. Without a PC: take the battery off and put it back on.', {
              time: clock(left!.at),
            })}
          </span>
          <button className={shared.control} onClick={() => keepUsbLeft(null)}>
            {tr('Close')}
          </button>
        </>
      )}
      {state === 'leaving' && <span className={shared.dim}>{tr('Restarting into USB mode…')}</span>}
      {state === 'stayed' && (
        <span className={shared.error} role="alert">
          {tr('The mower did not restart into USB mode. Try again.')}
        </span>
      )}
      {asks &&
        (open ? (
          <Ask
            title={tr('Restart into USB mode')}
            yes={busy ? tr('Restarting into USB mode…') : tr('Restart into USB mode now')}
            locked={!ready || busy}
            noLocked={busy}
            onYes={go}
            onNo={() => setOpen(false)}
          >
            <p>{tr('The mower restarts into the USB mode of its loader, for the installer on a PC. It neither drives nor mows nor follows its schedule then.')}</p>
            <p>
              <b>{tr('Afterwards the Tron can only be reached over USB from a PC. Without a PC: take the battery off and put it back on.')}</b>
            </p>
            <p className={shared.dim}>{tr('Only while the mower idles without an emergency stop. An update that is waiting ends for it.')}</p>
            <label className={styles.tick}>
              <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
              {tr('The PC with the installer is ready and the USB cable is at the mower.')}
            </label>
          </Ask>
        ) : (
          <>
            <button
              className={shared.control}
              onClick={() => {
                // (a restart that didn't happen is said until the next try)
                keepUsbLeft(null);
                setError(null);
                setReady(false);
                setOpen(true);
              }}
            >
              {tr('Restart into USB mode')}
            </button>
            <span className={shared.dim}>{tr('For the installer on a PC: back to the vendor system, or writing MowBite OS again.')}</span>
          </>
        ))}
      {error && (
        <span className={shared.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
