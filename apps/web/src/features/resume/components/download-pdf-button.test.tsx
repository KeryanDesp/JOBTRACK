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
    let downloadedFileName: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(this: HTMLAnchorElement) {
      downloadedFileName = this.download;
    });

    const user = userEvent.setup();
    render(<DownloadPdfButton content={sampleContent} template="CLASSIC" fileName="CV-Alice-Martin.pdf" />);

    await user.click(screen.getByRole('button', { name: /télécharger le pdf/i }));

    // La revocation est differee (`setTimeout(…, 0)`, voir download-pdf-button.tsx) :
    // attendre son appel plutot que celui du clic, deja synchrone a ce stade.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url'));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadedFileName).toBe('CV-Alice-Martin.pdf');
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

  it('affiche une erreur en toast quand la generation echoue, apres l avoir journalisee', async () => {
    const boom = new Error('boom');
    pdfMock.mockImplementation(() => {
      throw boom;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    render(<DownloadPdfButton content={sampleContent} template="CLASSIC" fileName="CV-Alice-Martin.pdf" />);

    await user.click(screen.getByRole('button', { name: /télécharger le pdf/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('La génération du PDF a échoué.'));
    expect(consoleError).toHaveBeenCalledWith(boom);

    const [consoleCallOrder] = consoleError.mock.invocationCallOrder;
    const [toastCallOrder] = toastError.mock.invocationCallOrder;
    if (consoleCallOrder === undefined || toastCallOrder === undefined) {
      throw new Error('Ordre d appel manquant : console.error ou toast.error n a pas ete appele.');
    }
    expect(consoleCallOrder).toBeLessThan(toastCallOrder);
  });
});
