let calls = 0;

// Module state survives between calls, so the second output differs from the first.
export default () => ({ layers: [], audio: [], envelopes: { incoming: { opacity: (calls += 1) % 2 } } });
