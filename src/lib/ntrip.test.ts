import {beforeEach, describe, expect, it, vi} from 'vitest';
import {demoNtrip} from './demo/ntrip';
import {RPC} from './openmower';

const sent: {method: string; params: unknown}[] = [];
const mower: {methods: Record<string, (params: unknown) => unknown>} = {methods: {}};
vi.mock('./rpc', () => ({
  callRpc: async (method: string, params: unknown) => {
    sent.push({method, params});
    return mower.methods[method](params);
  },
}));

import {deleteNtrip, loadNtrip, loginDropped, ntripForm, ntripParams, ntripProblem, saveNtrip, withoutLogin, type NtripForm} from './ntrip';

const PASSWORD = 'geheim-4711';
const USER = 'gartenfreund';
const STORED = {configured: true, host: 'caster.example', port: 2101, has_user: true, has_password: true};
const form = (change: Partial<NtripForm> = {}): NtripForm => ({host: 'caster.example', port: '2101', mountpoint: 'VRS_3_4G', version: 2, user: '', password: '', ...change});

describe('ntrip', () => {
  let state = 'IDLE';
  beforeEach(() => {
    sent.length = 0;
    state = 'IDLE';
    mower.methods = demoNtrip(() => state);
  });

  it('leaves an empty user and password out for the same caster, so the mower keeps them, and sends none for another', () => {
    expect(ntripParams(form({host: ' caster.example ', version: 1}), STORED)).toEqual({host: 'caster.example', port: 2101, mountpoint: 'VRS_3_4G', version: 1});
    expect(ntripParams(form({user: ` ${USER} `, password: ' p w '}), STORED)).toMatchObject({user: USER, password: ' p w '});
    expect(ntripParams(form({password: PASSWORD}), STORED)).not.toHaveProperty('user');
    expect(ntripParams(form({port: ' 2102 '}), STORED)).toMatchObject({port: 2102, user: '', password: ''});
    expect(ntripParams(form({password: PASSWORD}), null)).toMatchObject({user: '', password: PASSWORD});
  });

  it('opens the form with what is stored, port 2101 and version 2 without one, never with a login', () => {
    expect(ntripForm(null)).toEqual({host: '', port: '2101', mountpoint: '', version: 2, user: '', password: ''});
    expect(ntripForm({configured: true, host: 'h', port: 2102, mountpoint: 'M', version: 1, has_user: true, has_password: true})).toEqual({
      host: 'h',
      port: '2102',
      mountpoint: 'M',
      version: 1,
      user: '',
      password: '',
    });
  });

  it('says what keeps a form from being sent', () => {
    expect(ntripProblem(form())).toBeNull();
    expect(ntripProblem(form({host: ''}))).toBe('Enter the host of the caster.');
    for (const host of ['http://caster.example', 'caster.example:2101', 'me@caster.example', 'caster.example/VRS']) expect(ntripProblem(form({host}))).toContain('without http://');
    for (const port of ['', '0', '65536', '21o1', '2101.5']) expect(ntripProblem(form({port}))).toContain('1 to 65535');
    expect(ntripProblem(form({mountpoint: ' '}))).toBe('Enter the mountpoint.');
    expect(ntripProblem(form({mountpoint: '/VRS'}))).toContain('no slash');
  });

  it('warns that the stored login goes with another host or port', () => {
    expect(loginDropped(STORED, form())).toBe(false);
    expect(loginDropped(STORED, form({mountpoint: 'OTHER', version: 1}))).toBe(false);
    expect(loginDropped(STORED, form({host: 'other.example'}))).toBe(true);
    expect(loginDropped(STORED, form({port: '2102'}))).toBe(true);
    expect(loginDropped(STORED, form({port: '2102', user: USER}))).toBe(true);
    expect(loginDropped(STORED, form({port: '2102', user: USER, password: PASSWORD}))).toBe(false);
    expect(loginDropped({...STORED, has_user: false, has_password: false}, form({host: 'other.example'}))).toBe(false);
    expect(loginDropped({configured: false}, form())).toBe(false);
  });

  it('keeps user and password out of everything but the call to the mower', async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {setItem: (k: string, v: string) => (store[k] = v), getItem: (k: string) => store[k] ?? null});
    const said: unknown[] = [];
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => void said.push(a)));

    const before = await loadNtrip();
    sent.length = 0;
    const saved = await saveNtrip(form({user: USER, password: PASSWORD}), before);
    const read = await loadNtrip();
    logs.forEach((l) => l.mockRestore());
    vi.unstubAllGlobals();

    expect(sent[0]).toEqual({method: RPC.ntripSet, params: {host: 'caster.example', port: 2101, mountpoint: 'VRS_3_4G', version: 2, user: USER, password: PASSWORD}});
    expect(saved).toEqual({configured: true, host: 'caster.example', port: 2101, mountpoint: 'VRS_3_4G', version: 2, has_user: true, has_password: true, error: undefined});
    const kept = JSON.stringify([saved, read, store, said]);
    expect(kept).not.toContain(PASSWORD);
    expect(kept).not.toContain(USER);
    // get and delete carry nothing
    await deleteNtrip();
    expect(sent.slice(1).map((s) => s.params)).toEqual([{}, {}]);
  });

  it('takes only the fields of the contract from an answer', async () => {
    mower.methods[RPC.ntripGet] = () => ({configured: true, host: 'h', has_user: true, user: USER, password: PASSWORD});
    expect(JSON.stringify(await loadNtrip())).not.toMatch(new RegExp(`${USER}|${PASSWORD}`));
  });

  it('shows an error without the login just typed', () => {
    expect(withoutLogin(`bad login ${USER}:${PASSWORD}@caster.example`, {user: USER, password: PASSWORD})).toBe('bad login ***:***@caster.example');
    expect(withoutLogin('ntrip.set only in IDLE', {user: '', password: ''})).toBe('ntrip.set only in IDLE');
  });

  it('the demo keeps a login for the same host and port only, and changes nothing outside IDLE', async () => {
    expect(await loadNtrip()).toMatchObject({configured: true, has_user: true, has_password: true});
    expect(await saveNtrip(form({mountpoint: 'OTHER'}), await loadNtrip())).toMatchObject({mountpoint: 'OTHER', has_user: true, has_password: true});
    expect(await saveNtrip(form({port: '2102'}), await loadNtrip())).toMatchObject({port: 2102, has_user: false, has_password: false});
    state = 'MOWING';
    await expect(saveNtrip(form(), await loadNtrip())).rejects.toMatchObject({code: -32600});
    await expect(deleteNtrip()).rejects.toMatchObject({code: -32600});
    state = 'IDLE';
    expect(await deleteNtrip()).toMatchObject({configured: false, has_user: false});
  });
});
