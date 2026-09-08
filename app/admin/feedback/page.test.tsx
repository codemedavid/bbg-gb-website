// Admin → Feedback.
//
// The screen an admin uses to file customer screenshots into folders. Two of
// its behaviours are safety, not convenience, and are what these tests are
// mostly about.
//
// Deleting a folder deletes every screenshot in it (the cascade in migration
// 0032), so the confirm dialog has to say how many — an admin who thinks they
// are tidying up a label must not silently destroy forty testimonials.
//
// And these are screenshots of real conversations, so the upload form has to
// say out loud that names and numbers reach a public page. That warning is the
// only thing standing between a careless upload and a customer's phone number
// on the open internet.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const makeFolders = () => [
  { id: 'f1', name: 'Batch 6 Reviews', description: 'August batch', itemCount: 2, coverUrl: null, isActive: true, sortOrder: 0 },
  { id: 'f2', name: 'Pulled Folder', description: null, itemCount: 0, coverUrl: null, isActive: false, sortOrder: 1 },
] as unknown[];

const folders = { current: makeFolders() };

const detail = {
  current: {
    id: 'f1', name: 'Batch 6 Reviews', description: 'August batch', itemCount: 2, coverUrl: null,
    isActive: true, sortOrder: 0,
    items: [
      { id: 'i1', folderId: 'f1', imageUrl: '/api/files/feedback/a.png', caption: 'Sobrang bilis!', customerName: 'Ate Jen', isActive: true, sortOrder: 0 },
      { id: 'i2', folderId: 'f1', imageUrl: '/api/files/feedback/b.png', caption: null, customerName: null, isActive: false, sortOrder: 1 },
    ],
  } as unknown,
};

// Typed so the assertions below can read the arguments back without casts.
const saveFolder = vi.fn(async (_v: { id?: string; body: Record<string, unknown> }) => ({}));
const deleteFolder = vi.fn((_id: string) => {});
const saveItem = vi.fn(async (_v: { id?: string; body: FormData }) => ({}));
const deleteItem = vi.fn((_id: string) => {});

vi.mock('@/lib/admin-api', () => ({
  useAdminFeedbackFolders: () => ({ data: folders.current, isLoading: false }),
  useAdminFeedbackFolder: (id: string | null) => ({ data: id ? detail.current : undefined, isLoading: false }),
  useMutate: () => ({
    saveFeedbackFolder: { mutateAsync: saveFolder, isPending: false },
    deleteFeedbackFolder: { mutate: deleteFolder },
    saveFeedbackItem: { mutateAsync: saveItem, isPending: false },
    deleteFeedbackItem: { mutate: deleteItem },
  }),
}));

const confirmResult = { current: true };
const confirmArgs = { current: null as any };
vi.mock('@/components/ConfirmDialog', () => ({
  useConfirm: () => async (args: unknown) => { confirmArgs.current = args; return confirmResult.current; },
}));

const AdminFeedbackPage = (await import('./page')).default;

const setup = () => render(<AdminFeedbackPage />);

const pngFile = () => new File([Buffer.from('bytes')], 'shot.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  confirmResult.current = true;
  // Rebuilt per test: one case empties the list, and a leaked [] would silently
  // gut every case that ran after it.
  folders.current = makeFolders();
});

describe('Admin feedback folders', () => {
  it('lists the folders with how much is filed in each', () => {
    setup();

    const list = within(screen.getByRole('list', { name: /Feedback folders/i }));
    expect(list.getByText('Batch 6 Reviews')).toBeInTheDocument();
    expect(list.getByText(/2 feedbacks/)).toBeInTheDocument();
  });

  it('marks a folder that is hidden from the storefront', () => {
    setup();

    // Scoped to the folder list: a hidden SCREENSHOT carries the same badge,
    // and the two must not be able to satisfy each other's assertion.
    const list = within(screen.getByRole('list', { name: /Feedback folders/i }));
    expect(list.getByText('Hidden')).toBeInTheDocument();
  });

  it('creates a folder', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: /New folder/i }));
    await userEvent.type(screen.getByLabelText(/Folder name/i), 'Batch 7 Reviews');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(saveFolder).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ name: 'Batch 7 Reviews' }) }),
    );
  });

  it('refuses to save a folder with no name', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: /New folder/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(saveFolder).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i);
  });

  it('names the number of screenshots a folder delete will destroy', async () => {
    setup();

    await userEvent.click(screen.getAllByRole('button', { name: /Delete folder/i })[0]);

    expect(confirmArgs.current.message).toMatch(/2 feedback/i);
    expect(deleteFolder).toHaveBeenCalledWith('f1');
  });

  it('does not delete when the admin backs out', async () => {
    confirmResult.current = false;
    setup();

    await userEvent.click(screen.getAllByRole('button', { name: /Delete folder/i })[0]);

    expect(deleteFolder).not.toHaveBeenCalled();
  });
});

describe('Admin feedback uploads', () => {
  it('shows the selected folder’s screenshots, hidden ones included', () => {
    setup();

    expect(screen.getByText('Sobrang bilis!')).toBeInTheDocument();
    // The hidden one is listed so an admin can put it back.
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('warns that screenshots reach a public page before anything is uploaded', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: /Upload feedback/i }));

    expect(screen.getByText(/public/i)).toBeInTheDocument();
  });

  it('refuses to upload without a screenshot — the image IS the feedback', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: /Upload feedback/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(saveItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/screenshot/i);
  });

  it('uploads a screenshot into the selected folder with its caption', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: /Upload feedback/i }));
    await userEvent.upload(screen.getByLabelText(/Screenshot/i), pngFile());
    await userEvent.type(screen.getByLabelText(/What they said/i), 'Ang bilis!');
    await userEvent.type(screen.getByLabelText(/Credit/i), 'Ate Jen, Cavite');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(saveItem).toHaveBeenCalledTimes(1);
    const body = saveItem.mock.calls[0][0].body;
    expect(body.get('folderId')).toBe('f1');
    expect(body.get('caption')).toBe('Ang bilis!');
    expect(body.get('customerName')).toBe('Ate Jen, Cavite');
    expect(body.get('image')).toBeInstanceOf(File);
  });

  it('lets an edit go through without re-uploading the screenshot', async () => {
    setup();

    await userEvent.click(screen.getAllByRole('button', { name: /Edit feedback/i })[0]);
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(saveItem).toHaveBeenCalledTimes(1);
    const call = saveItem.mock.calls[0][0];
    expect(call.id).toBe('i1');
    expect(call.body.get('image')).toBeNull();
  });

  it('deletes a single screenshot after confirming', async () => {
    setup();

    await userEvent.click(screen.getAllByRole('button', { name: /Delete feedback/i })[0]);

    expect(deleteItem).toHaveBeenCalledWith('i1');
  });

  it('tells an admin to make a folder first when there are none', () => {
    folders.current = [];
    setup();

    expect(screen.getByText(/Gumawa muna ng folder/i)).toBeInTheDocument();
  });
});
