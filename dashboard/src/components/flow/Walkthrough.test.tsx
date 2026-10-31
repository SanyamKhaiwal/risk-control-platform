import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from './flowData';
import { Walkthrough } from './Walkthrough';

const story = SCENARIOS[0];

describe('Walkthrough', () => {
  it('opens on the full story, starting with Alice recording a risk', () => {
    const { container } = render(<Walkthrough />);
    expect(story.steps[0].actor).toBe('alice');
    expect(screen.getByRole('heading', { name: 'Alice records a risk' })).toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).toHaveTextContent('Step 1 of 9, Alice: Alice records a risk.');
    // The diagram names who is acting and shows the example score.
    expect(container.querySelector('svg')).toHaveTextContent('Alice is using it');
    expect(container.querySelector('.flow-score')).toHaveTextContent('20 Critical');
    // Other captions are laid out (to keep the height fixed) but hidden from assistive tech.
    expect(screen.queryByRole('heading', { name: 'Bob adds a safeguard' })).toBeNull();
  });

  it('steps forward and back with the buttons and the arrow keys', async () => {
    render(<Walkthrough />);
    await userEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByRole('heading', { name: 'Bob adds a safeguard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('heading', { name: 'Carol tests it: it works' })).toBeInTheDocument();

    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByRole('heading', { name: 'Alice records a risk' })).toBeInTheDocument();
  });

  it('shows the score coming down when the tested control is linked', async () => {
    const { container } = render(<Walkthrough />);
    await userEvent.click(screen.getByRole('button', { name: 'Step 5: The score comes down' }));
    const badge = container.querySelector('.flow-score');
    expect(badge).toHaveClass('flow-score--LOW');
    expect(badge?.querySelector('.flow-score__was')).toHaveTextContent('20');
    expect(badge).toHaveTextContent('5 Low');
  });

  it('shows containers starting in order until all eight are healthy', async () => {
    const { container } = render(<Walkthrough />);
    await userEvent.click(screen.getByRole('button', { name: /Starting it up/ }));
    expect(container.querySelector('.flow-frame')).toHaveClass('is-active');
    expect(container.querySelectorAll('.flow-node.is-off')).toHaveLength(8);

    await userEvent.click(screen.getByRole('button', { name: 'The Control Service starts' }));
    expect(container.querySelectorAll('.flow-node.is-healthy')).toHaveLength(4);
    expect(container.querySelectorAll('.flow-node.is-off')).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Ready to use' }));
    expect(container.querySelectorAll('.flow-node.is-healthy')).toHaveLength(8);
    expect(container.querySelectorAll('.flow-node.is-off')).toHaveLength(0);
  });

  it('switches walkthroughs, marks stopped services and lights the boxes a step touches', async () => {
    const { container } = render(<Walkthrough />);
    await userEvent.click(screen.getByRole('button', { name: /When something breaks/ }));
    expect(screen.getByRole('button', { name: /When something breaks/ })).toHaveAttribute('aria-pressed', 'true');

    const stopped = container.querySelectorAll('.flow-node.is-down');
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toHaveTextContent('Risk Service');
    expect(container.querySelector('#flow-e-control-kafka')).toHaveClass('is-active');

    await userEvent.click(screen.getByRole('button', { name: 'It restarts and catches up' }));
    expect(screen.getByRole('heading', { name: 'It restarts and catches up' })).toBeInTheDocument();
    expect(container.querySelectorAll('.flow-node.is-down')).toHaveLength(0);
  });
});
