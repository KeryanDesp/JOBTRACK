import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination';

describe('Pagination', () => {
  it('affiche la navigation avec les libelles francais attendus', () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#" isActive>
              1
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Page précédente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Page suivante' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });
});
