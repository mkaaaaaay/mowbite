'use client';

import {LockIcon} from '@/components/icons';
import {hostError, scanWifi, setupWifiText, setWifi, useHost, useSetupWifiUntil, wifiProblem, wifiText, type WifiNetwork} from '@/lib/hostOs';
import {tr, useLang} from '@/lib/i18n';
import {useOsApi, useSetupWifiGesture} from '@/lib/mowerOs';
import {WIFI_HIDDEN_API} from '@/lib/openmower';
import {useState} from 'react';
import local from './HostWifi.module.css';
import sheet from './setup/Sheet.module.css';

// The WLAN of a mower with MowBite OS: the networks it sees, one chosen with its password, tried by the mower in the
// background, where the host lists host.wifi_set (the page asks). The password goes only to the mower
export function HostWifi({styles}: {styles: Record<string, string>}) {
  useLang();
  const host = useHost();
  // undefined: not looked yet
  const [networks, setNetworks] = useState<WifiNetwork[]>();
  // the one chosen; other: a name typed in, its password optional
  const [chosen, setChosen] = useState<{ssid: string; secure: boolean; other?: boolean} | null>(null);
  const [password, setPassword] = useState('');
  // an open WLAN only once its risk is ticked
  const [openOk, setOpenOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useOsApi();
  // the gesture at the mower that opens its setup WLAN after the trial
  const gesture = useSetupWifiGesture();
  const setupUntil = useSetupWifiUntil();
  const wifi = host?.wifi ?? null;
  const locked = busy || wifi?.state === 'trying';
  const open = !!chosen && !chosen.secure && !password;

  const look = () => {
    setBusy(true);
    setError(null);
    scanWifi()
      .then(setNetworks, (e) => setError(hostError(e)))
      .finally(() => setBusy(false));
  };
  const choose = (c: typeof chosen) => {
    setChosen(c);
    setPassword('');
    setOpenOk(false);
    setError(null);
  };
  const connect = () => {
    if (!chosen) return;
    const problem = wifiProblem(chosen.ssid, password, chosen.secure);
    if (problem) return setError(tr(problem));
    setBusy(true);
    setError(null);
    // a name typed in may be a WLAN that doesn't send it
    setWifi(chosen.ssid, password, !!chosen.other && api >= WIFI_HIDDEN_API)
      .then(() => choose(null), (e) => setError(hostError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className={styles.card} data-wifi={wifi?.state ?? 'none'}>
      {setupUntil !== null && <p data-setup-wifi="">{setupWifiText(setupUntil)}</p>}
      {wifi && (
        <p className={wifi.state === 'failed' ? styles.error : styles.dim} role={wifi.state === 'failed' ? 'alert' : undefined}>
          {wifiText(wifi)}
        </p>
      )}
      {networks && (
        <fieldset className={local.networks} disabled={locked}>
          {networks.map((n) => (
            <label key={n.ssid} className={sheet.choice}>
              <span className={local.name}>{n.ssid}</span>
              {n.in_use && <span className={local.signal}>{tr('in use')}</span>}
              <span className={local.signal}>{n.signal} %</span>
              <LockIcon size={16} open={!n.secure} />
              <input type="radio" name="wifi" checked={chosen?.ssid === n.ssid && !chosen.other} onChange={() => choose({ssid: n.ssid, secure: n.secure})} />
            </label>
          ))}
          <label className={sheet.choice}>
            <span className={local.name}>{tr('Another WLAN, by its name')}</span>
            <input type="radio" name="wifi" checked={!!chosen?.other} onChange={() => choose({ssid: '', secure: false, other: true})} />
          </label>
        </fieldset>
      )}
      {networks?.length === 0 && <p className={styles.dim}>{tr('The mower sees no WLAN.')}</p>}
      {chosen && (
        <>
          {chosen.other && (
            <label className={styles.field}>
              {tr('Name of the WLAN')}
              <input
                value={chosen.ssid}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setChosen({...chosen, ssid: e.target.value})}
              />
            </label>
          )}
          {(chosen.secure || chosen.other) && (
            <label className={styles.field}>
              {chosen.other ? tr('Password, empty for an open WLAN') : tr('Password of {ssid}', {ssid: chosen.ssid})}
              <input name="wifi-password" type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {open ? (
            <>
              <p className={sheet.warn} data-open-wifi>
                {tr('An open WLAN has no password: anyone in reach can set up or stop the mower, MowBite OS has no login.')}
              </p>
              <label className={styles.check}>
                <input type="checkbox" checked={openOk} onChange={(e) => setOpenOk(e.target.checked)} />
                {tr('I know, connect it anyway')}
              </label>
            </>
          ) : (
            <p className={styles.dim}>{tr('The password only goes to the mower. It never shows it again, the app does not keep it.')}</p>
          )}
          <p className={styles.dim}>
            {tr(
              'The mower tries a new WLAN in the background and keeps it only once it connects, else the one before comes back. If your phone reaches the mower over the WLAN it leaves, the app finds it again once the phone is in the new one too.',
            )}
          </p>
        </>
      )}
      <div className={local.buttons}>
        {chosen ? (
          <>
            <button type="button" className={styles.pillButton} data-primary disabled={locked || (open && !openOk)} onClick={connect}>
              {tr('Connect')}
            </button>
            <button type="button" className={styles.pillButton} disabled={busy} onClick={() => choose(null)}>
              {tr('Cancel')}
            </button>
          </>
        ) : (
          <button type="button" className={styles.pillButton} disabled={locked} onClick={look}>
            {busy ? tr('Searching…') : networks ? tr('Search again') : tr('Show the WLANs')}
          </button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {gesture && (
        <p className={styles.dim}>
          {tr('WLAN lost? Press On/OK {n} times quickly at the mower: it opens its setup WLAN for {minutes} minutes.', {n: gesture.presses, minutes: Math.round(gesture.open_s / 60)})}
        </p>
      )}
    </section>
  );
}
