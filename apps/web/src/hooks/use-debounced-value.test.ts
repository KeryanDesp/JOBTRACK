import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedValue', () => {
  it('renvoie la valeur initiale immediatement', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 250));
    expect(result.current).toBe('a');
  });

  it('ne met pas a jour la valeur avant le delai', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    void act(() => vi.advanceTimersByTime(100));

    expect(result.current).toBe('a');
  });

  it('met a jour la valeur une fois le delai ecoule', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    void act(() => vi.advanceTimersByTime(250));

    expect(result.current).toBe('ab');
  });

  it('ne garde que la derniere valeur quand plusieurs changements se succedent avant le delai', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    void act(() => vi.advanceTimersByTime(100));
    rerender({ value: 'abc' });
    void act(() => vi.advanceTimersByTime(100));

    expect(result.current).toBe('a');

    void act(() => vi.advanceTimersByTime(150));

    expect(result.current).toBe('abc');
  });
});
