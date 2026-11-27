'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {tr} from '@/lib/i18n';
import {PORT_LISTEN_S, RPC} from '@/lib/openmower';
import {answerError} from '@/lib/rpcText';
import {listenPort, listenText, loadPorts, portDevice, portHolder, portIds, type Ports, type SerialPort} from '@/lib/setup';
import {useState} from 'react';
import sheet from './Sheet.module.css';
import step from './SetupStep.module.css';
import styles from './SetupPorts.module.css';

type Heard = {text: string; bad?: boolean};

// the mower's serial ports, folded until opened: who holds each, and what comes at a free one, listened to only on a tap
// after the note on DTR; one listen at a time
export function SetupPorts() {
  const methods = useRpcMethods();
  const [open, setOpen] = useState(false);
  const [ports, setPorts] = useState<Ports | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [listening, setListening] = useState<string | null>(null);
  const [heard, setHeard] = useState<Record<string, Heard>>({});
  if (!methods?.has(RPC.setupPorts)) return null;

  const load = () => {
    setLoading(true);
    setError(null);
    loadPorts()
      .then(setPorts, (e) => setError(answerError(e)))
      .finally(() => setLoading(false));
  };
  const toggle = () => {
    if (!open) load();
    setOpen(!open);
  };
  const listen = (path: string) => {
    const done = (h: Heard) => setHeard((all) => ({...all, [path]: h}));
    setAsking(null);
    setListening(path);
    listenPort(path)
      .then(
        (r) => done({text: listenText(r)}),
        (e) => done({text: answerError(e), bad: true}),
      )
      .finally(() => setListening(null));
  };

  const row = (p: SerialPort) => {
    const device = portDevice(p);
    const ids = portIds(p);
    const holder = portHolder(p);
    const h = heard[p.path];
    return (
      <li key={p.path} className={styles.port} data-port={p.path} data-free={p.free}>
        <div className={styles.line}>
          <b>{p.path}</b>
          <span>{p.free ? tr('free') : holder ? tr('used by {holder}', {holder}) : tr('used by another program')}</span>
        </div>
        {device && <span className={styles.dim}>{device}</span>}
        {ids.length > 0 && <span className={styles.ids}>{ids.join(', ')}</span>}
        {listening === p.path && (
          <span className={styles.dim} data-listening>
            {tr('Listening, up to {s} s…', {s: PORT_LISTEN_S})}
          </span>
        )}
        {h && listening !== p.path && (
          <p className={step.note} data-tone={h.bad ? 'bad' : undefined} data-heard>
            {h.text}
          </p>
        )}
        {p.free &&
          (asking === p.path ? (
            <div className={styles.ask}>
              <p className={sheet.warn}>
                {tr('Listening only reads what comes. Opening the port can still switch its DTR line, which restarts some devices on it.')}
              </p>
              <div className={sheet.buttons}>
                <button type="button" className={sheet.button} onClick={() => setAsking(null)}>
                  {tr('Cancel')}
                </button>
                <button type="button" className={sheet.button} data-primary onClick={() => listen(p.path)}>
                  {tr('Listen in')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.listen} disabled={!!listening} onClick={() => setAsking(p.path)}>
              {tr('Listen in')}
            </button>
          ))}
      </li>
    );
  };

  return (
    <section className={styles.card} data-ports>
      <button type="button" className={styles.head} aria-expanded={open} onClick={toggle}>
        <span>
          <b>{tr('Serial ports')}</b>
          <span>{tr('What is plugged in and what it sends')}</span>
        </span>
        <span className={styles.fold} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <>
          {ports && !ports.resting && <p className={step.note}>{tr('Listening works only while the mower stands idle and no step runs.')}</p>}
          {ports?.listening && !listening && <p className={step.note}>{tr('Another device is listening at a port right now.')}</p>}
          {error && (
            <p className={step.note} data-tone="bad" role="alert">
              {error}
            </p>
          )}
          {ports && (ports.ports.length ? <ul className={styles.ports}>{ports.ports.map(row)}</ul> : <p className={styles.dim}>{tr('The mower has no serial ports.')}</p>)}
          <button type="button" className={styles.reload} disabled={loading || !!listening} onClick={load}>
            {loading ? tr('connecting…') : tr('Read the ports again')}
          </button>
        </>
      )}
    </section>
  );
}
