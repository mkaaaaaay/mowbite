import {describe, expect, it, vi} from 'vitest';

const net = vi.hoisted(() => ({status: 200}));
vi.mock('./mowers', () => ({
  apiBase: () => '',
  isDemo: () => false,
  mowerFetch: async () => new Response('', {status: net.status}),
}));

const {backupFirst, deleteBackup} = await import('./backups');
const {forget} = await import('./fresh');

describe('deleteBackup', () => {
  it('is done when the container says so', async () => {
    net.status = 200;
    await expect(deleteBackup('a')).resolves.toBeUndefined();
  });

  it('fails when the container refuses it', async () => {
    net.status = 500;
    await expect(deleteBackup('a')).rejects.toThrow('error 500');
  });
});

describe('backupFirst', () => {
  const map = {areas: [], docking_stations: []} as never;

  it('goes without one where no container keeps backups', async () => {
    forget('backups');
    net.status = 404;
    await expect(backupFirst(map, 'before saving')).resolves.toBe(false);
  });

  it('fails when the container did not take it', async () => {
    forget('backups');
    net.status = 500;
    await expect(backupFirst(map, 'before saving')).rejects.toThrow('error 500');
  });
});
