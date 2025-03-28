# Frontend Testing Approach

This document outlines our approach to testing the frontend codebase, focusing on state management and business logic without relying on UI rendering.

## Test Structure

- Unit tests are located in `__tests__` directories next to the code they test
- The test setup is in `src/test/setup.ts`
- Tests use the following naming convention: `*.test.ts` or `*.test.tsx`

## Tools & Libraries

We use the following tools for testing:

- **Vitest**: Test runner and assertion library
- **React Testing Library**: For testing React hooks and components
- **@testing-library/jest-dom**: For additional DOM-related assertions

## Testing State Management

### Zustand Store Testing

For Zustand stores (`/src/state`), we test:

1. **Actions & State Mutations**: Each state-changing action is tested to ensure it modifies the state correctly
2. **Edge Cases**: Including empty states, error handling, and complex interactions
3. **Business Logic**: Ensuring the business rules are enforced through state transitions

Example:

```typescript
// Basic store testing pattern
it("should update state when action is called", () => {
  // Arrange - Get store and initial state
  const store = useMyStore.getState();

  // Act - Call the action
  store.someAction("param");

  // Assert - Check state was updated correctly
  const newState = useMyStore.getState();
  expect(newState.someValue).toBe("expected value");
});
```

### React Hooks Testing

For custom hooks (`/src/hooks`), we test:

1. **Return Values**: Ensure hooks return the expected values and functions
2. **Function Behavior**: Test that functions returned by hooks behave correctly
3. **State Updates**: Verify that hooks update state correctly
4. **Side Effects**: Check that hooks trigger the right side effects

Example:

```typescript
// Basic hook testing pattern
it("should return the expected functions", () => {
  // Arrange & Act
  const { result } = renderHook(() => useMyHook());

  // Assert
  expect(typeof result.current.someFunction).toBe("function");
});

it("should update state when function is called", async () => {
  // Arrange
  const { result } = renderHook(() => useMyHook());

  // Act
  await act(async () => {
    await result.current.someFunction();
  });

  // Assert
  expect(result.current.someValue).toBe("expected value");
});
```

## Test Mocking Strategy

When testing state logic, we often need to mock:

1. **API Calls**: Use `vi.mock()` to mock fetch, axios, or other HTTP clients
2. **External Services**: Mock services like authentication, analytics, etc.
3. **Utility Functions**: Mock utility functions that aren't part of the test
4. **Context Providers**: Mock React contexts that the code under test may consume

Example:

```typescript
// Mock example
vi.mock("@/api/someApi", () => ({
  fetchData: vi.fn().mockResolvedValue({ data: "mock data" }),
}));
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run with UI
pnpm test:ui

# Run with coverage
pnpm coverage
```

## Best Practices

1. **Isolation**: Each test should be isolated and not depend on the state of other tests
2. **Arrange-Act-Assert**: Follow the AAA pattern for clarity
3. **Test Business Logic**: Focus on testing business rules and state changes
4. **Avoid Implementation Details**: Test behavior, not implementation when possible
5. **Reset State**: Always reset state between tests, especially with global stores

## Example Tests

See examples in:

- `/src/state/messaging/__tests__/store.test.ts`: Testing Zustand store
- `/src/hooks/__tests__/useChatActions.test.ts`: Testing React hooks

## Adding New Tests

When adding new tests:

1. Create `__tests__` directory next to the code you're testing
2. Add `.test.ts` or `.test.tsx` files
3. Follow existing patterns for similar code
4. Run tests to ensure they pass
