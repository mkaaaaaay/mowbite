import {describe, expect, it, vi} from 'vitest';

const net = vi.hoisted(() => ({status: 200}));
vi.mock('./mowers', () => ({
  apiBase: () => '',
  isDemo: () => false,
  mowerFetch: async () => new Response('', {status: net.status}),
}));

const {deleteBackup} = await import('./backups');

describe('deleteBackup', () => {
  it('is done when the container says so', async () => {
    net.status = 200;
    await expect(deleteBackup('a')).resolves.toBeUndefined();
  });

  it('fails when the container refuses it', async () => {
    net.status = 500;
    await expect(deleteBackup('a')).rejects.toThrow('backup 500');
  });
});
