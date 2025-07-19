import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';

// A simple component to test
const Welcome = ({ name }: { name?: string }) => {
  return <h1>Welcome, {name || 'Guest'}!</h1>;
};

describe('Welcome Component', () => {
  it('renders a welcome message for a guest', () => {
    render(<Welcome />);
    expect(screen.getByRole('heading', { name: /Welcome, Guest!/i })).toBeInTheDocument();
  });

  it('renders a welcome message for a user', () => {
    const userName = 'John';
    render(<Welcome name={userName} />);
    expect(screen.getByRole('heading', { name: `Welcome, ${userName}!` })).toBeInTheDocument();
  });
});
