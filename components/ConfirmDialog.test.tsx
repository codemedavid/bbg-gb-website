// The shared "warn before deleting" dialog. Admin destructive actions gate on
// this, so the promise it hands back must resolve true only on an explicit
// confirm click and false on cancel, backdrop, or Escape.
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';

// A tiny harness: clicking the trigger opens the dialog and records the result.
function Harness() {
  const confirm = useConfirm();
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({ title: 'Delete "GCash"?', message: 'This cannot be undone.', confirmLabel: 'Delete' });
          const out = document.querySelector('[data-testid="result"]');
          if (out) out.textContent = ok ? 'confirmed' : 'cancelled';
        }}
      >
        trigger
      </button>
      <span data-testid="result" />
    </div>
  );
}

function renderHarness() {
  return render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
}

describe('ConfirmDialog', () => {
  it('does not render until a confirm is requested', () => {
    renderHarness();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the title and message when triggered', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'trigger' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete "GCash"?');
    expect(dialog).toHaveTextContent('This cannot be undone.');
  });

  it('resolves true when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirmed'));
  });

  it('resolves false when cancelled', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('cancelled'));
  });

  it('resolves false on Escape', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('cancelled'));
  });

  it('closes the dialog after a decision', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'trigger' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
