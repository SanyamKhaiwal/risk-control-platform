import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PostedNumber } from './Posted';
import { RiskMatrix } from './RiskMatrix';

const grid = (cells: Record<string, number>) =>
  Array.from({ length: 5 }, (_, l) => Array.from({ length: 5 }, (_, i) => cells[`${l + 1},${i + 1}`] ?? 0));

describe('RiskMatrix', () => {
  it('puts each count in its likelihood × impact cell, labelled with score and rating', () => {
    render(<RiskMatrix label="Residual" grid={grid({ '4,5': 2, '1,1': 1 })} />);

    expect(screen.getByRole('img', { name: /likelihood 4, impact 5, score 20 critical: 2 risks/i })).toHaveTextContent('2');
    expect(screen.getByRole('img', { name: /likelihood 1, impact 1, score 1 low: 1 risk$/i })).toHaveTextContent('1');
    expect(screen.getByRole('img', { name: /likelihood 3, impact 3, score 9 medium: 0 risks/i })).not.toHaveTextContent(/^0$/);
  });

  it('draws likelihood 5 in the top row, as risk committees read it', () => {
    render(<RiskMatrix label="Inherent" grid={grid({})} />);

    const cells = screen.getAllByRole('img').filter((el) => el.classList.contains('cell'));
    expect(cells[0]).toHaveAccessibleName(/likelihood 5, impact 1/i);
    expect(cells[24]).toHaveAccessibleName(/likelihood 1, impact 5/i);
  });

  it('lets the user select and clear a cell that has risks', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RiskMatrix label="Residual" grid={grid({ '2,5': 1 })} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole('button', { name: /likelihood 2, impact 5/i }));
    expect(onSelect).toHaveBeenCalledWith({ likelihood: 2, impact: 5 });

    rerender(<RiskMatrix label="Residual" grid={grid({ '2,5': 1 })} onSelect={onSelect} selected={{ likelihood: 2, impact: 5 }} />);
    const selected = screen.getByRole('button', { name: /likelihood 2, impact 5/i });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(selected);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('marks a cell whose count just changed', () => {
    const { rerender } = render(<RiskMatrix label="Residual" grid={grid({ '2,5': 1 })} />);
    rerender(<RiskMatrix label="Residual" grid={grid({ '4,5': 1 })} />);

    expect(screen.getByRole('img', { name: /likelihood 4, impact 5/i })).toHaveClass('was-posted');
    expect(screen.getByRole('img', { name: /likelihood 2, impact 5/i })).toHaveClass('was-posted');
  });
});

describe('PostedNumber', () => {
  it('strikes through the old figure and posts the new one, then drops the old one', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<PostedNumber value={10} />);
    expect(container).toHaveTextContent('10');

    rerender(<PostedNumber value={20} />);
    expect(container.querySelector('s')).toHaveTextContent('10');
    expect(container.querySelector('.posted__now')).toHaveTextContent('20');
    expect(screen.getByText('(was 10)')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2500));
    expect(container.querySelector('s')).toBeNull();
    expect(container).toHaveTextContent('20');
    vi.useRealTimers();
  });

  it('uses red ink only when the movement is adverse', () => {
    const { container, rerender } = render(<PostedNumber value={10} />);
    rerender(<PostedNumber value={20} />);
    expect(container.querySelector('.posted')).toHaveClass('posted--adverse');

    rerender(<PostedNumber value={5} />);
    expect(container.querySelector('.posted')).not.toHaveClass('posted--adverse');

    const effectiveness = render(<PostedNumber value={100} worse="down" />);
    effectiveness.rerender(<PostedNumber value={0} worse="down" />);
    expect(effectiveness.container.querySelector('.posted')).toHaveClass('posted--adverse');
  });
});
