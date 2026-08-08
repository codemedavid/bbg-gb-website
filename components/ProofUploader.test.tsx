// Up to five proofs of payment, with previews and a way to take one back out.
//
// A customer who hit their bank's transfer limit made two or three payments and
// holds a screenshot of each. The old control had one slot and "tap to replace",
// which quietly discarded the first one. This is what §10 and §11 ask for: five
// numbered slots, a thumbnail per upload so the customer can see WHICH file
// landed, and a remove button for the one they picked by mistake.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProofUploader } from './ProofUploader';
import { MAX_PROOFS } from '@/lib/proof';

// jsdom has no object URLs; the component only needs a string back.
beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

const image = (name: string) => new File([Buffer.from('bytes')], name, { type: 'image/png' });

const files = (n: number) => Array.from({ length: n }, (_, i) => image(`proof-${i + 1}.png`));

/** The hidden <input type="file"> behind the "add" affordance. */
const fileInput = (): HTMLInputElement =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

const attach = (added: File[]) =>
  fireEvent.change(fileInput(), { target: { files: added } });

describe('ProofUploader', () => {
  it('says how many files may be attached', () => {
    render(<ProofUploader files={[]} onChange={vi.fn()} />);

    expect(screen.getByText(new RegExp(`up to ${MAX_PROOFS}`, 'i'))).toBeInTheDocument();
  });

  it('accepts a first proof', () => {
    const onChange = vi.fn();
    render(<ProofUploader files={[]} onChange={onChange} />);

    attach([image('receipt.png')]);

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'receipt.png' })]);
  });

  it('adds to what is already attached instead of replacing it', () => {
    // The bug this whole control exists to fix: the old input replaced, so a
    // customer with three transfers could evidence exactly one.
    const onChange = vi.fn();
    const existing = files(1);
    render(<ProofUploader files={existing} onChange={onChange} />);

    attach([image('second.png')]);

    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });

  it('accepts several files chosen in one go', () => {
    const onChange = vi.fn();
    render(<ProofUploader files={[]} onChange={onChange} />);

    attach(files(3));

    expect(onChange.mock.calls[0][0]).toHaveLength(3);
  });

  it('numbers each attached proof for the customer', () => {
    render(<ProofUploader files={files(3)} onChange={vi.fn()} />);

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
    expect(screen.getByText('Proof #3')).toBeInTheDocument();
  });

  it('shows a thumbnail of each image so the customer can see which file landed', () => {
    render(<ProofUploader files={files(2)} onChange={vi.fn()} />);

    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('shows a document icon for a PDF rather than a broken image', () => {
    const pdf = new File([Buffer.from('%PDF')], 'receipt.pdf', { type: 'application/pdf' });
    render(<ProofUploader files={[pdf]} onChange={vi.fn()} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
  });

  it('reports how many of the five are used', () => {
    render(<ProofUploader files={files(2)} onChange={vi.fn()} />);

    expect(screen.getByText(`2 of ${MAX_PROOFS} attached`)).toBeInTheDocument();
  });

  it('lets the customer remove one before submitting', () => {
    const onChange = vi.fn();
    const attached = files(3);
    render(<ProofUploader files={attached} onChange={onChange} />);

    const second = screen.getByText('Proof #2').closest('li')!;
    fireEvent.click(within(second).getByRole('button', { name: /remove/i }));

    expect(onChange).toHaveBeenCalledWith([attached[0], attached[2]]);
  });

  it('renumbers what is left after a removal', () => {
    // The numbering is positional. If it were baked in at upload time, removing
    // #2 would leave the customer looking at #1 and #3.
    const { rerender } = render(<ProofUploader files={files(3)} onChange={vi.fn()} />);
    rerender(<ProofUploader files={[image('a.png'), image('c.png')]} onChange={vi.fn()} />);

    expect(screen.getByText('Proof #1')).toBeInTheDocument();
    expect(screen.getByText('Proof #2')).toBeInTheDocument();
    expect(screen.queryByText('Proof #3')).not.toBeInTheDocument();
  });

  it('stops offering the add control once five are attached', () => {
    render(<ProofUploader files={files(MAX_PROOFS)} onChange={vi.fn()} />);

    expect(fileInput()).toBeNull();
  });

  it('says the limit is reached rather than leaving a blank space', () => {
    render(<ProofUploader files={files(MAX_PROOFS)} onChange={vi.fn()} />);

    expect(screen.getByText(new RegExp(`maximum of ${MAX_PROOFS}`, 'i'))).toBeInTheDocument();
  });

  it('refuses a sixth even if a file dialog somehow supplies one', () => {
    // The hidden input is gone at five, but a `multiple` selection of six in one
    // go reaches onChange as a batch. Truncating silently would tell the
    // customer their sixth transfer was evidenced when it was not.
    const onChange = vi.fn();
    render(<ProofUploader files={[]} onChange={onChange} />);

    attach(files(6));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(new RegExp(`${MAX_PROOFS}`));
  });

  it('refuses a batch that would push an existing set past five', () => {
    const onChange = vi.fn();
    render(<ProofUploader files={files(4)} onChange={onChange} />);

    attach(files(2));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers the add control again after a removal frees a slot', () => {
    const { rerender } = render(<ProofUploader files={files(MAX_PROOFS)} onChange={vi.fn()} />);
    rerender(<ProofUploader files={files(MAX_PROOFS - 1)} onChange={vi.fn()} />);

    expect(fileInput()).not.toBeNull();
  });
});
