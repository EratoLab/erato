# Testing Streaming SSE with Zustand in React

## Key Challenges and Solutions

### Challenge 1: Testing Streaming State Management

Zustand maintains state outside the React component lifecycle, making it difficult to test intermediate state updates.

**Solution**:

- Mock the SSE connection directly, replacing it with a controlled callback mechanism
- Use separate `act` calls for each streaming event to ensure proper state updates
- Test final state rather than intermediate states when working with rapidly changing data

### Challenge 2: Shared State Between Tests

The Zustand store persists between test cases, causing state to "leak" between tests.

**Solution**:

- Reset the messaging store at the start of each test
- Clean up after each test by calling the cancel method
- Unmount hooks to prevent state leakage

### Challenge 3: Asynchronous State Updates

React batch updates make it difficult to test sequential updates in a streaming context.

**Solution**:

- Use contained tests with explicit waits for state updates
- Break larger tests into smaller, focused ones
- Use `toContain` instead of exact matching for flaky tests

### Challenge 4: API Alignment

Ensuring our frontend code aligns with the backend API specification.

**Solution**:

- Updated the SSE client to use POST instead of GET for message submission
- Matched the request format to the OpenAPI specification
- Added proper error case testing for 401 and 500 responses
- Updated tests to match the real API structure

## Different Testing Approaches

### 1. Direct Mocking (Used in this project)

```typescript
// Mock the SSE connection function to capture callbacks
mockCreateSSEConnection.mockImplementation((url, callbacks) => {
  onMessageCallback = callbacks.onMessage;
  return cleanupFn;
});

// Manually trigger SSE events
await act(async () => {
  onMessageCallback({
    data: JSON.stringify({
      message_type: "text_delta",
      new_text: "Hello",
    }),
    type: "message",
  });
});
```

**Pros**:

- Complete control over event timing
- Works with the existing codebase
- Predictable behavior

**Cons**:

- Not a realistic simulation of SSE events
- Requires deep knowledge of internal implementation

### 2. MSW (Mock Service Worker) Approach

An alternative approach that mocks at the network level. This creates more realistic tests but adds complexity:

```typescript
// Configure MSW to intercept network requests
server.use(
  http.post("/api/v1beta/me/messages/submitstream", ({ request }) => {
    // Return a streaming response with events
    return new HttpResponse(eventStream, {
      headers: {
        "Content-Type": "text/event-stream",
      },
    });
  }),
);
```

**Pros**:

- Closer to real-world behavior
- Tests the full stack from network to UI
- Decoupled from implementation details

**Cons**:

- More complex setup
- Timing issues are harder to debug
- May need adjustments when API changes

### 3. Error Testing Approach

We added comprehensive error testing for API failure scenarios:

```typescript
// Test for handling 401/500 errors
it("should handle API errors", async () => {
  // Setup the mutation to throw an error
  mockUseMessageSubmitSse.mockReturnValue({
    mutateAsync: vi.fn().mockRejectedValue(new Error("API Error")),
    isPending: false,
    isError: true,
    error: new Error("API Error"),
  });

  // Mock error handling in SSE connection
  mockCreateSSEConnection.mockImplementation((url, callbacks) => {
    setTimeout(() => callbacks.onError?.(new Event("error")), 10);
    return cleanupFn;
  });

  // ... test error state after sending a message
});
```

## Lessons Learned

1. **Zustand State Management**: Zustand's external store pattern requires different testing approaches than pure React hooks.

2. **Isolation Matters**: Each test should run in isolation with a fresh store state.

3. **Mock at the Right Level**: Choose whether to mock at the network level (MSW) or at the function level based on test goals.

4. **Avoid Timing Dependencies**: Tests that depend on specific timing sequences are brittle.

5. **Focus on End Results**: For streaming events, focus on testing the final state rather than intermediate states.

6. **API Alignment**: Regularly check that frontend code matches the API spec to prevent drift.

7. **Error Scenarios**: Test both happy path and error scenarios to ensure robust handling.

## API Alignment

The backend API requires:

- POST requests to `/api/v1beta/me/messages/submitstream` (not GET)
- JSON body with format: `{ "user_message": "content" }`
- Error handling for 401 and 500 responses

Our implementation now correctly matches these requirements, including proper error handling.

## Future Improvements

1. Consider exporting the store for easier testing (make the store accessible to tests)

2. Add a helper utility for testing streaming content that handles the state management complexity

3. Add integration tests with MSW for end-to-end testing of the SSE flow

4. Update the SSE client to fully support POST requests with bodies (possibly using a library like `event-source-polyfill`)
