import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CvDropzone } from './cv-dropzone';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('CvDropzone', () => {
  it('refuse un format non pris en charge avant tout envoi', () => {
    const onSelect = vi.fn();
    render(<CvDropzone isUploading={false} progress={0} onSelect={onSelect} />);

    const input = screen.getByLabelText('Choisir un fichier CV');
    // `userEvent.upload` filtre lui-même selon l'attribut `accept` de l'input (comme un
    // vrai sélecteur de fichiers ne proposerait pas un `.txt` avec cet `accept`) : il ne
    // déclencherait donc jamais le changement pour ce cas précis. `fireEvent.change`
    // pose directement `files` et déclenche l'événement, sans ce filtrage — c'est
    // justement notre propre validation cliente qu'on veut exercer ici.
    fireEvent.change(input, { target: { files: [makeFile('cv.txt', 'text/plain', 100)] } });

    expect(screen.getByText('Format non pris en charge : PDF ou DOCX uniquement.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyser mon CV' })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('refuse un fichier de plus de 10 Mo', async () => {
    const onSelect = vi.fn();
    render(<CvDropzone isUploading={false} progress={0} onSelect={onSelect} />);

    const input = screen.getByLabelText('Choisir un fichier CV');
    await userEvent.upload(input, makeFile('cv.pdf', 'application/pdf', 11 * 1024 * 1024));

    expect(await screen.findByText('Fichier trop volumineux (10 Mo maximum).')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepte un pdf valide et declenche l_analyse au clic sur le bouton', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CvDropzone isUploading={false} progress={0} onSelect={onSelect} />);

    const input = screen.getByLabelText('Choisir un fichier CV');
    const file = makeFile('cv.pdf', 'application/pdf', 1024);
    await userEvent.upload(input, file);

    expect(await screen.findByText('cv.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Analyser mon CV' }));

    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('affiche la progression et le bouton annuler pendant l_envoi', () => {
    render(<CvDropzone isUploading progress={0.42} onSelect={vi.fn()} onCancelUpload={vi.fn()} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });
});
