// The dialog service (ARCHITECTURE.md 2.7, 3.12.4, 4.4.5; W3 acceptance: "message boxes return the
// pressed button", "a modal dialog opened in Simulator mode holds the controller and releases it").

import { describe, expect, it } from 'vitest';
import type { AppState, MessageBoxRequest, Mode } from '../contracts';
import { defaultSettings } from '../core/settings/defaults';
import { MESSAGE_DIALOG_ID, createDialogService } from './dialogs';
import { createStore, initialAppState } from './store';
import { createInertController } from './stub-services';

const QUESTION: MessageBoxRequest = {
  title: 'Caution',
  text: 'A program is running.',
  icon: 'confirmation',
  buttons: ['Yes', 'No'],
};

function setup(mode: Mode = 'editor', options: { controller?: boolean } = {}) {
  const store = createStore<AppState>(initialAppState(defaultSettings(), mode));
  const controller = createInertController();
  const service = createDialogService({
    store,
    controller: () => (options.controller === false ? null : controller),
    hasDialog: (id) => id === 'sim.find' || id === 'options.editor',
  });
  return { store, controller, service };
}

describe('message boxes', () => {
  it('resolve to the caption of the pressed button', async () => {
    const { service, store } = setup();
    const answer = service.messageBox(QUESTION);
    const [box] = store.getState().dialogs.stack;
    expect(box).toMatchObject({ id: MESSAGE_DIALOG_ID, modal: true, props: QUESTION });
    service.close(box?.key ?? -1, 'No');
    await expect(answer).resolves.toBe('No');
    expect(store.getState().dialogs.stack).toEqual([]);
  });

  it('stack: the second box is answered first, each with its own button', async () => {
    const { service, store } = setup();
    const first = service.messageBox({ ...QUESTION, buttons: ['OK'] });
    const second = service.messageBox({ ...QUESTION, buttons: ['Replace', 'Append', 'Cancel'] });
    const [a, b] = store.getState().dialogs.stack;
    expect(store.getState().dialogs.stack).toHaveLength(2);
    service.close(b?.key ?? -1, 'Append');
    await expect(second).resolves.toBe('Append');
    expect(store.getState().dialogs.stack.map((dialog) => dialog.key)).toEqual([a?.key]);
    service.close(a?.key ?? -1, 'OK');
    await expect(first).resolves.toBe('OK');
  });

  it('ignores a second close of the same dialog', async () => {
    const { service, store } = setup();
    const answer = service.messageBox(QUESTION);
    const key = store.getState().dialogs.stack[0]?.key ?? -1;
    service.close(key, 'Yes');
    service.close(key, 'No');
    await expect(answer).resolves.toBe('Yes');
  });
});

describe('isModalOpen', () => {
  it('is true from the moment a modal dialog is opened until it closes', () => {
    const { service, store } = setup();
    expect(service.isModalOpen()).toBe(false);
    void service.messageBox(QUESTION);
    expect(service.isModalOpen()).toBe(true);
    service.close(store.getState().dialogs.stack[0]?.key ?? -1, 'Yes');
    expect(service.isModalOpen()).toBe(false);
  });

  it('is false for modeless dialogs (Find, Log Output): they do not block commands', () => {
    const { service, store } = setup('simulator');
    void service.open('sim.find', {}, { modal: false });
    expect(store.getState().dialogs.stack[0]).toMatchObject({ id: 'sim.find', modal: false });
    expect(service.isModalOpen()).toBe(false);
  });
});

describe('open', () => {
  it('resolves with the result the dialog component passes to close', async () => {
    const { service, store } = setup();
    const result = service.open<{ size: number }, { ok: boolean }>('options.editor', { size: 10 });
    const dialog = store.getState().dialogs.stack[0];
    expect(dialog).toMatchObject({ id: 'options.editor', props: { size: 10 }, modal: true });
    service.close(dialog?.key ?? -1, { ok: true });
    await expect(result).resolves.toEqual({ ok: true });
  });

  it('rejects for a dialog id that no feature has registered', async () => {
    const { service, store } = setup();
    await expect(service.open('no.such.dialog', {})).rejects.toThrow(
      /No dialog is registered for the id "no.such.dialog"/,
    );
    expect(store.getState().dialogs.stack).toEqual([]);
    expect(service.isModalOpen()).toBe(false);
  });

  it('gives every dialog a new key', () => {
    const { service, store } = setup();
    void service.messageBox(QUESTION);
    void service.messageBox(QUESTION);
    const keys = store.getState().dialogs.stack.map((dialog) => dialog.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('holding the program (4.4.5)', () => {
  it('a modal dialog opened in Simulator mode holds the controller and releases it on close', async () => {
    const { service, store, controller } = setup('simulator');
    expect(controller.held).toBe(false);
    const answer = service.messageBox(QUESTION);
    expect(controller.held).toBe(true);
    service.close(store.getState().dialogs.stack[0]?.key ?? -1, 'Yes');
    expect(controller.held).toBe(false);
    await answer;
  });

  it('two dialogs hold twice: the program continues only after both are closed', () => {
    const { service, store, controller } = setup('simulator');
    void service.open('options.editor', {});
    void service.messageBox(QUESTION);
    const [first, second] = store.getState().dialogs.stack;
    service.close(second?.key ?? -1, 'Yes');
    expect(controller.held).toBe(true);
    service.close(first?.key ?? -1, null);
    expect(controller.held).toBe(false);
  });

  it('stays held when the mode changes while the dialog is open, and is released by the close', () => {
    const { service, store, controller } = setup('simulator');
    void service.messageBox(QUESTION);
    store.setState((state) => ({ ...state, mode: 'editor' }));
    expect(controller.held).toBe(true);
    service.close(store.getState().dialogs.stack[0]?.key ?? -1, 'No');
    expect(controller.held).toBe(false);
  });

  it('does not hold for a modeless dialog, nor for the dialogs of Editor mode', () => {
    const sim = setup('simulator');
    void sim.service.open('sim.find', {}, { modal: false });
    expect(sim.controller.held).toBe(false);

    const editor = setup('editor');
    void editor.service.messageBox(QUESTION);
    void editor.service.open('options.editor', {});
    expect(editor.controller.held).toBe(false);
  });

  it('follows holdsProgram when the caller says so', () => {
    const editor = setup('editor');
    void editor.service.messageBox(QUESTION, { holdsProgram: true });
    expect(editor.controller.held).toBe(true);

    const sim = setup('simulator');
    void sim.service.messageBox(QUESTION, { holdsProgram: false });
    expect(sim.controller.held).toBe(false);
    void sim.service.open('sim.find', {}, { modal: false, holdsProgram: true });
    expect(sim.controller.held).toBe(true);
  });

  it('works before the simulator session exists', async () => {
    const { service, store } = setup('simulator', { controller: false });
    const answer = service.messageBox(QUESTION);
    service.close(store.getState().dialogs.stack[0]?.key ?? -1, 'Yes');
    await expect(answer).resolves.toBe('Yes');
  });
});

describe('toasts', () => {
  it('are listed oldest first and can be dismissed', () => {
    const { service } = setup();
    let ran = 0;
    service.toast('The program is waiting for keyboard input', { label: 'Simulator', run: () => ran++ });
    service.toast('Press Ctrl+V to paste');
    const list = service.toasts.getState();
    expect(list.map((toast) => toast.text)).toEqual([
      'The program is waiting for keyboard input',
      'Press Ctrl+V to paste',
    ]);
    list[0]?.action?.run();
    expect(ran).toBe(1);
    expect(list[1]?.action).toBeUndefined();
    service.dismissToast(list[0]?.id ?? -1);
    expect(service.toasts.getState().map((toast) => toast.text)).toEqual(['Press Ctrl+V to paste']);
    // Toasts never block commands.
    expect(service.isModalOpen()).toBe(false);
  });
});
