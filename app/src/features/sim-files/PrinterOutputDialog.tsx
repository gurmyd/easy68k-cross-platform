// The Printer Output dialog, `sim.printerOutput` (ARCHITECTURE.md 3.8.4, 1.4 note 2): the print jobs
// of TRAP #15 task 10 that wait to be printed. Print... hands the selected job to the system print
// dialog (Platform.print), where the printer is chosen; Discard drops it. A job leaves the list
// either way.
//
// Owner: SH6.

import { useEffect, useReducer, useState } from 'react';
import type { DialogProps, PrintJob } from '../../contracts';
import { useAppContext } from '../../state/context';
import { Button, Dialog, ListBox } from '../../ui/components';
import { PRINTER_OUTPUT_TITLE, jobHtml, jobLabel, jobText, jobTitle } from './logic';
import { printerStateOf, type PrinterOutputProps } from './printer-state';
import './sim-files.css';

export const NO_JOBS_TEXT = 'Nothing is waiting to be printed.';
export const PRINTER_NOTE =
  'TRAP #15 task 10 prints here. A form feed (12) ends a page. Print... opens the system print dialog, where the printer is chosen.';

export function PrinterOutputDialog({ props, close }: DialogProps<PrinterOutputProps, void>) {
  const ctx = useAppContext();
  const state = printerStateOf(ctx);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // New jobs appear while the dialog is open.
  useEffect(() => ctx.sim.onPrintJob?.(() => refresh()), [ctx]);
  // Whoever opens the dialog again (Printer Setup...) can close this one.
  useEffect(() => {
    const own = () => close(undefined);
    state.close = own;
    return () => {
      if (state.close === own) state.close = null;
    };
  }, [state, close]);

  const jobs = state.list.waiting();
  const value = (job: PrintJob) => String(state.list.numberOf(job));
  const job = jobs.find((each) => value(each) === selected) ?? jobs[jobs.length - 1] ?? null;

  const settle = (done: PrintJob) => {
    state.list.settle(done);
    setSelected(null);
    refresh();
  };
  const print = async () => {
    if (!job) return;
    const number = state.list.numberOf(job);
    setPrinting(true);
    try {
      await ctx.platform.print(jobHtml(job, jobTitle(number)), jobTitle(number));
      settle(job);
    } catch (error) {
      ctx.dialogs.toast(`The page could not be printed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog
      title={PRINTER_OUTPUT_TITLE}
      modal={props.modal}
      width={600}
      onCancel={() => close(undefined)}
      footer={
        <>
          <Button caption="&Print..." isDefault disabled={!job || printing} onClick={() => void print()} />
          <Button caption="&Discard" disabled={!job || printing} onClick={() => job && settle(job)} />
          <Button caption="&Close" onClick={() => close(undefined)} />
        </>
      }
    >
      <div className="e68-printer-output">
        {jobs.length === 0 ? (
          <p className="e68-printer-output__empty">{NO_JOBS_TEXT}</p>
        ) : (
          <>
            <ListBox
              label="Print jobs"
              items={jobs.map((each) => ({ value: value(each), label: jobLabel(each, state.list.numberOf(each)) }))}
              value={job ? value(job) : null}
              onChange={setSelected}
              onActivate={() => void print()}
              rows={Math.min(5, Math.max(2, jobs.length))}
            />
            <pre className="e68-printer-output__page" aria-label="The selected page" tabIndex={0}>
              {job ? jobText(job) : ''}
            </pre>
          </>
        )}
        <p className="e68-printer-output__note">{PRINTER_NOTE}</p>
      </div>
    </Dialog>
  );
}
