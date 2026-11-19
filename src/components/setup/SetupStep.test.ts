import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {demoSetup} from '@/lib/demo/setup';
import {RPC} from '@/lib/openmower';
import type {Setup} from '@/lib/setup';
import {SetupStep} from './SetupStep';

vi.mock('next/navigation', () => ({useRouter: () => ({push: () => {}, replace: () => {}})}));

describe('a running step', () => {
  it('can be cancelled while another call of the page is still out', () => {
    const demo = demoSetup(() => {}, () => false, () => {});
    const get = () => demo.methods[RPC.setupGet]({}) as Setup;
    demo.methods[RPC.setupStart]({step: 'board', version: get().version});
    const setup = get();
    const step = setup.steps.find((s) => s.id === 'board')!;
    expect(step.state).toBe('running');
    const act = {start: () => {}, answer: () => {}, skip: () => {}, abort: () => {}};
    const html = renderToStaticMarkup(createElement(SetupStep, {setup, step, lang: 'en', sizes: null, busy: true, error: null, act}));
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)?.[0];
    expect(cancel).toBeDefined();
    expect(cancel).not.toContain('disabled');
  });
});
