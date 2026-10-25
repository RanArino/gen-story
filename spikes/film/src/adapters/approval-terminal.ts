// Kept separate so the refusal can be tested without invoking the approval command.
export function requireApprovalTerminal(inputIsTTY: boolean | undefined, outputIsTTY: boolean | undefined): void {
  if (!inputIsTTY || !outputIsTTY) {
    throw new Error("approve requires an interactive terminal; approvals cannot be scripted or delegated.");
  }
}
