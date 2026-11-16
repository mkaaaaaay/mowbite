'use client';

import {useIdle} from '@/hooks/useMowerState';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {tr, useLang} from '@/lib/i18n';
import {deleteNtrip, loadNtrip, loginDropped, ntripForm, ntripProblem, saveNtrip, withoutLogin, type NtripAccess, type NtripForm} from '@/lib/ntrip';
import {RPC} from '@/lib/openmower';
import {answerError} from '@/lib/rpcText';
import {useEffect, useState} from 'react';
import local from './LightSettings.module.css';

// the access to the caster for corrections on a mower with MowBite OS: shown without user and password, set and
// deleted where the mower takes that over rpc
export function NtripSettings({styles}: {styles: Record<string, string>}) {
  useLang();
  const methods = useRpcMethods();
  const idle = useIdle();
  const {sure, confirm} = useSure();
  // undefined: loading, null: it didn't answer
  const [access, setAccess] = useState<NtripAccess | null>();
  // the open form, user and password in it only until it is sent or closed
  const [form, setForm] = useState<NtripForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{text: string; error?: boolean} | null>(null);
  useEffect(() => {
    let stop = false;
    loadNtrip().then(
      (a) => !stop && setAccess(a),
      () => !stop && setAccess(null),
    );
    return () => {
      stop = true;
    };
  }, []);
  if (access === undefined) return <p className={styles.dim}>{tr('loading…')}</p>;
  if (access === null) return <p className={styles.error}>{tr('The mower did not answer.')}</p>;

  const canSet = !!methods?.has(RPC.ntripSet);
  const canDelete = !!methods?.has(RPC.ntripDelete);
  const save = async (f: NtripForm) => {
    const problem = ntripProblem(f);
    if (problem) return setNote({text: tr(problem), error: true});
    setBusy(true);
    setNote(null);
    try {
      setAccess(await saveNtrip(f));
      setForm(null);
      setNote({text: tr('Saved on the mower.')});
    } catch (e) {
      setNote({text: withoutLogin(answerError(e), f), error: true});
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    setBusy(true);
    setNote(null);
    deleteNtrip()
      .then(
        (a) => {
          setAccess(a);
          setForm(null);
        },
        (e) => setNote({text: answerError(e), error: true}),
      )
      .finally(() => setBusy(false));
  };
  const login = access.has_user
    ? access.has_password
      ? tr('user and password are set')
      : tr('user is set, no password')
    : access.has_password
      ? tr('password is set, no user')
      : tr('no user, no password');
  const set = (change: Partial<NtripForm>) => setForm((f) => f && {...f, ...change});

  return (
    <section className={styles.card}>
      <p className={styles.dim}>
        {tr(
          'For a position to the centimeter the mower needs corrections from a service like SAPOS. The caster is the server of that service, the mountpoint the stream it sends from there. Host, port, mountpoint and login come with your access to the service.',
        )}
      </p>
      {access.error && <p className={styles.error}>{tr('The mower cannot use the stored access: {error}', {error: access.error})}</p>}
      {!access.configured ? (
        <p data-ntrip="none">{tr('No access stored. Without corrections the mower gets no RTK fix.')}</p>
      ) : (
        <p className={styles.dim} data-ntrip="stored">
          {tr('Caster: {host}, port {port}', {host: access.host ?? '–', port: access.port ?? '–'})}
          <br />
          {tr('Mountpoint: {name}', {name: access.mountpoint ?? '–'})}
          <br />
          {tr('NTRIP version {n}', {n: access.version ?? '–'})}
          <br />
          {tr('Login: {what}', {what: login})}
        </p>
      )}
      {!canSet && <p className={styles.dim}>{tr("The access is set on the mower itself, this mower doesn't take it from the app.")}</p>}
      {(canSet || (canDelete && access.configured)) && !idle && <p className={styles.dim}>{tr('Only possible while the mower is idle.')}</p>}
      {form && (
        <>
          <label className={styles.field}>
            {tr('Host of the caster')}
            <input value={form.host} placeholder="caster.example" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => set({host: e.target.value})} />
          </label>
          <label className={styles.field}>
            {tr('Port')}
            <input value={form.port} inputMode="numeric" onChange={(e) => set({port: e.target.value})} />
          </label>
          <label className={styles.field}>
            {tr('Mountpoint')}
            <input value={form.mountpoint} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => set({mountpoint: e.target.value})} />
          </label>
          <div className={styles.segment}>
            <span>{tr('NTRIP version')}</span>
            {([2, 1] as const).map((v) => (
              <button key={v} type="button" className={form.version === v ? styles.segmentOn : undefined} aria-pressed={form.version === v} onClick={() => set({version: v})}>
                {v}
              </button>
            ))}
          </div>
          <p className={styles.dim}>{tr('Version 2 fits nearly every service. Take 1 only if yours says so.')}</p>
          <label className={styles.field}>
            {tr('User')}
            <input
              name="ntrip-user"
              value={form.user}
              placeholder={access.has_user ? tr('set, stays if left empty') : ''}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => set({user: e.target.value})}
            />
          </label>
          <label className={styles.field}>
            {tr('Password')}
            <input
              name="ntrip-password"
              type="password"
              value={form.password}
              placeholder={access.has_password ? tr('set, stays if left empty') : ''}
              autoComplete="new-password"
              onChange={(e) => set({password: e.target.value})}
            />
          </label>
          <p className={styles.dim}>{tr('User and password only go to the mower. It never shows them again, the app does not keep them.')}</p>
          {loginDropped(access, form) && (
            <p className={styles.error}>{tr('The stored login only counts for the host and port it was saved with: enter user and password again.')}</p>
          )}
        </>
      )}
      <div className={local.soundButtons}>
        {form ? (
          <>
            <button type="button" className={styles.pillButton} disabled={busy || !idle} onClick={() => void save(form)}>
              {tr('Save')}
            </button>
            <button
              type="button"
              className={styles.pillButton}
              disabled={busy}
              onClick={() => {
                setForm(null);
                setNote(null);
              }}
            >
              {tr('Cancel')}
            </button>
          </>
        ) : (
          <>
            {canSet && (
              <button
                type="button"
                className={styles.pillButton}
                disabled={busy || !idle}
                onClick={() => {
                  setForm(ntripForm(access));
                  setNote(null);
                }}
              >
                {access.configured ? tr('Change') : tr('Set up')}
              </button>
            )}
            {canDelete && access.configured && (
              <button type="button" className={styles.pillButton} disabled={busy || !idle} onClick={() => confirm('delete', remove)}>
                {sure === 'delete' ? tr('Really delete the access?') : tr('Delete')}
              </button>
            )}
          </>
        )}
      </div>
      {note && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
    </section>
  );
}
