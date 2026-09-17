import type { ResumeContent } from '@jobtrack/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadPdfButton } from './download-pdf-button';

const pdfMock = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@react-pdf/renderer', () => ({ pdf: pdfMock }));
vi.mock('../templates/classic/template.pdf', () => ({ Pdf: () => null }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

const sampleContent: ResumeContent = {
  schemaVersion: 1,
  identity: { firstName: 'Alice', lastName: 'Martin', title: null },
  summary: '',
  experiences: [],
  educations: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
};

afterEach(() => {
  pdfMock.mockReset();
  toastError.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DownloadPdfButton', () => {
  it('genere le PDF et declenche un telechargement avec le nom de fichier fourni', async () => {
    pdfMock.mockReturnValue({ toBlob: () => Promise.resolve(new Blob(['contenu-pdf'])) });
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<DownloadPdfButton content={sampleContent} template="CLASSIC" fileName="CV-Alice-Martin.pdf" />);

    await user.click(screen.getByRole('button', { name: /télécharger le pdf/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('affiche « Generation... » pendant l appel puis revient a l etat normal', async () => {
    let resolveToBlob: (blob: Blob) => void = () => {};
    pdfMock.mockReturnValue({
      toBlob: () => new Promise<Blob>((resolve) => (resolveToBlob = resolve)),
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:mock-url'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<DownloadPdfButton content={sampleContent} template="CLASSIC" fileName="CV-Alice-Martin.pdf" />);

    await user.click(screen.getByRole('button', { name: /télécharger le pdf/i }));
    expect(await screen.findByRole('button', { name: /génération/i })).toBeDisabled();

    resolveToBlob(new Blob(['x']));
    expect(await screen.findByRole('button', { name: /télécharger le pdf/i })).not.toBeDisabled();
  });

  it("affiche une erreur en toast quand la generation echoue", async () => {
    pdfMock.mockImplementation(() => {
      throw new Error('boom');
    });

    const user = userEvent.setup();
    render(<DownloadPdfButton content={sampleContent} template="CLASSIC" fileName="CV-Alice-Martin.pdf" />);

    await user.click(screen.getByRole('button', { name: /télécharger le pdf/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('La génération du PDF a échoué.'));
  });
});
