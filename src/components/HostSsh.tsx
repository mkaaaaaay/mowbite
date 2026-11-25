'use client';

import {CopyCommand} from '@/components/Updates';
import {hostError, setSsh, sshLogin, sshPasswordProblem, useHostSsh} from '@/lib/hostOs';
import {tr, useLang} from '@/lib/i18n';
import {brokerHost} from '@/lib/mqttClient';
import {useState} from 'react';
import local from './HostWifi.module.css';
import sheet from './setup/Sheet.module.css';

// root's login over ssh on a mower whose host manages it: on and off, a new password entered twice (no old one needed).
// The password goes only to the mower and is cleared from the form once sent
export function HostSsh({styles}: {styles: Record<string, string>}) {
  useLang();
  const ssh = useHostSsh();
  // the form for a new password, also to turn it on without one
  const [form, setForm] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ssh) return null;
  const login = sshLogin(brokerHost());

  const close = () => {
    setForm(false);
    setPassword('');
    setAgain('');
  };
  const send = (enabled: boolean, newPassword = '') => {
    setBusy(true);
    setError(null);
    setSsh(enabled, newPassword)
      .then(close, (e) => setError(hostError(e)))
      .finally(() => {
        setPassword('');
        setAgain('');
        setBusy(false);
      });
  };
  const toggle = (on: boolean) => {
    if (on && !ssh.password) return setForm(true);
    send(on);
  };
  const risk = tr(
    'root only gets in from private networks such as your home network. Anyone with the app in your home network can turn SSH on and set the password. The password goes to the mower unencrypted over MQTT in your home network, the app does not keep it.',
  );
  const save = () => {
    const problem = sshPasswordProblem(password, again);
    if (problem) return setError(problem);
    send(true, password);
  };

  return (
    <section className={styles.card} data-ssh={ssh.enabled ? 'on' : 'off'}>
      <label className={styles.check}>
        <input type="checkbox" role="switch" checked={ssh.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        {tr('Log in as root over SSH')}
      </label>
      {ssh.enabled && (
        <>
          <p className={styles.dim}>{tr('From a computer in your home network:')}</p>
          <CopyCommand command={login ?? `ssh -4 root@${tr('<mower>')}.local`} />
          {!login && <p className={styles.dim}>{tr("Put in the mower's name or address in your network for {name}.", {name: tr('<mower>')})}</p>}
        </>
      )}
      {form ? (
        <>
          {!ssh.password && <p className={styles.dim}>{tr('Set a password for root to turn SSH on.')}</p>}
          <p className={sheet.warn}>{risk}</p>
          <label className={styles.field}>
            {tr('New password')}
            <input name="ssh-password" type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className={styles.field}>
            {tr('New password again')}
            <input name="ssh-password-again" type="password" value={again} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
          </label>
          <div className={local.buttons}>
            <button type="button" className={styles.pillButton} data-primary disabled={busy} onClick={save}>
              {ssh.enabled ? tr('Save password') : tr('Turn on')}
            </button>
            <button type="button" className={styles.pillButton} disabled={busy} onClick={close}>
              {tr('Cancel')}
            </button>
          </div>
        </>
      ) : (
        ssh.enabled && (
          <>
            <div className={local.buttons}>
              <button type="button" className={styles.pillButton} disabled={busy} onClick={() => setForm(true)}>
                {tr('Change password')}
              </button>
            </div>
            <p className={styles.dim}>{tr('Forgot the password? Just set a new one, the old one is not needed.')}</p>
          </>
        )
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!form && <p className={styles.dim}>{risk}</p>}
    </section>
  );
}
